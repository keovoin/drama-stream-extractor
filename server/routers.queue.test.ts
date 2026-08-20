import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { EpisodeResult, SeriesConnection } from "./dramaExtractor";

const extractorMocks = vi.hoisted(() => ({
  closeSeriesConnection: vi.fn(),
  fetchEpisodeFromConnection: vi.fn(),
  openSeriesConnection: vi.fn(),
}));

vi.mock("./dramaExtractor", async importOriginal => {
  const actual = await importOriginal<typeof import("./dramaExtractor")>();
  return {
    ...actual,
    closeSeriesConnection: extractorMocks.closeSeriesConnection,
    fetchEpisodeFromConnection: extractorMocks.fetchEpisodeFromConnection,
    openSeriesConnection: extractorMocks.openSeriesConnection,
  };
});

import { appRouter } from "./routers";

const firstUrl = "https://dramabox.dramafren.org/index.php?page=detail&id=42000011111&lang=en&slug=first-queue-drama";
const secondUrl = "https://dramabox.dramafren.org/index.php?page=detail&id=42000022222&lang=en&slug=second-queue-drama";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function episodeResult(episode: number, streamUrl: string, status: string): EpisodeResult {
  return {
    episode,
    streamUrl,
    subtitleTracks: streamUrl ? `en: ${streamUrl.replace(".mp4", ".srt")}` : "",
    qualityLabel: "Server 1",
    playerApiUrl: `https://player.example.test/?ep=${episode}`,
    status,
  };
}

describe("sequential multi-series job retention", () => {
  beforeEach(() => {
    extractorMocks.closeSeriesConnection.mockReset().mockResolvedValue(undefined);
    extractorMocks.openSeriesConnection.mockReset().mockImplementation(async (url: string) => {
      const first = url.includes("42000011111");
      return {
        sessionId: first ? "first-session" : "second-session",
        browser: {},
        page: {},
        series: { dramaId: first ? "42000011111" : "42000022222" },
        title: first ? "First Queue Drama" : "Second Queue Drama",
        total: first ? 1 : 2,
      } as SeriesConnection;
    });
    extractorMocks.fetchEpisodeFromConnection.mockReset().mockImplementation(async (connection: SeriesConnection, episode: number) => {
      if (connection.sessionId === "first-session") {
        return episodeResult(episode, "https://cdn.example.test/first-episode-1.mp4", "Verified");
      }
      if (episode === 1) return episodeResult(1, "https://cdn.example.test/second-episode-1.mp4", "Verified");
      const wasRetried = extractorMocks.openSeriesConnection.mock.calls.filter(([url]) => url === secondUrl).length > 1;
      return wasRetried
        ? episodeResult(2, "https://cdn.example.test/second-episode-2.mp4", "Verified after retry")
        : episodeResult(2, "", "Unavailable after 3 attempts");
    });
  });

  it("keeps the first completed workbook available while the next series completes and is retried", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    const first = await caller.extract.start({ url: firstUrl });
    const firstCompleted = await caller.extract.advance({ jobId: first.jobId });
    expect(firstCompleted).toMatchObject({ state: "completed", title: "First Queue Drama", verified: 1, unavailable: 0 });

    const second = await caller.extract.start({ url: secondUrl });
    await caller.extract.advance({ jobId: second.jobId });
    const secondCompleted = await caller.extract.advance({ jobId: second.jobId });
    expect(secondCompleted).toMatchObject({ state: "completed", title: "Second Queue Drama", verified: 1, unavailable: 1 });

    const firstWorkbookWhileSecondExists = await caller.extract.download({ jobId: first.jobId });
    const secondPartialWorkbook = await caller.extract.download({ jobId: second.jobId });
    expect(firstWorkbookWhileSecondExists.fileName).toBe("first-queue-drama-stream-urls.xlsx");
    expect(secondPartialWorkbook.fileName).toBe("second-queue-drama-stream-urls.xlsx");

    const retryStarted = await caller.extract.retryFailed({ jobId: second.jobId });
    expect(retryStarted).toMatchObject({ state: "processing", mode: "retry", runTotal: 1, revision: 1 });
    const retryCompleted = await caller.extract.advance({ jobId: second.jobId });
    expect(retryCompleted).toMatchObject({ state: "completed", verified: 2, unavailable: 0, revision: 1 });

    const firstWorkbookAfterRetry = await caller.extract.download({ jobId: first.jobId });
    const secondWorkbookAfterRetry = await caller.extract.download({ jobId: second.jobId, revision: 1 });
    expect(firstWorkbookAfterRetry.fileName).toBe("first-queue-drama-stream-urls.xlsx");
    expect(secondWorkbookAfterRetry.fileName).toBe("second-queue-drama-stream-urls.xlsx");
  });
});
