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

const sourceUrl = "https://dramabox.dramafren.org/index.php?page=detail&id=42000023494&lang=en";

function episodeResult(episode: number, streamUrl: string, status: string): EpisodeResult {
  return {
    episode,
    streamUrl,
    qualityLabel: "Server 1",
    playerApiUrl: `https://dramabox.dramafren.org/index.php?action=get_video&id=42000023494&ep=${episode}&lang=en&sv=1`,
    status,
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("extract.retryFailed", () => {
  beforeEach(() => {
    extractorMocks.closeSeriesConnection.mockReset().mockResolvedValue(undefined);
    extractorMocks.fetchEpisodeFromConnection.mockReset();
    extractorMocks.openSeriesConnection.mockReset();
  });

  it("retries only unavailable rows and regenerates the workbook without replacing successful URLs", async () => {
    const connection = { sessionId: "test-session", browser: {}, page: {}, series: {}, total: 2 } as SeriesConnection;
    let openedSessions = 0;
    extractorMocks.openSeriesConnection.mockImplementation(async () => {
      openedSessions += 1;
      return connection;
    });
    extractorMocks.fetchEpisodeFromConnection.mockImplementation(async (_connection: SeriesConnection, episode: number) => {
      if (episode === 1) return episodeResult(1, "https://cdn.example.com/episode-1.mp4", "Verified");
      return openedSessions === 1
        ? episodeResult(2, "", "Unavailable after 3 attempts: Player request timed out")
        : episodeResult(2, "https://cdn.example.com/episode-2.mp4", "Verified after 2 attempts");
    });

    const caller = appRouter.createCaller(createPublicContext());
    const started = await caller.extract.start({ url: sourceUrl });
    await caller.extract.advance({ jobId: started.jobId });
    const partial = await caller.extract.advance({ jobId: started.jobId });

    expect(partial).toMatchObject({ state: "completed", verified: 1, unavailable: 1, revision: 0 });

    const retryStarted = await caller.extract.retryFailed({ jobId: started.jobId });
    expect(retryStarted).toMatchObject({ state: "processing", mode: "retry", runCompleted: 0, runTotal: 1, revision: 1 });

    const retried = await caller.extract.advance({ jobId: started.jobId });
    const workbook = await caller.extract.download({ jobId: started.jobId, revision: 1 });

    expect(retried).toMatchObject({ state: "completed", verified: 2, unavailable: 0, revision: 1 });
    expect(extractorMocks.fetchEpisodeFromConnection.mock.calls.map(call => call[1])).toEqual([1, 2, 2]);
    expect(workbook.base64).toMatch(/^UEsDB/);
  });
});
