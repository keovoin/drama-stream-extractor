import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
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

const sourceUrl = "https://dramabox.dramafren.org/index.php?page=detail&id=42000023494&lang=en&slug=the-godfather-s-guardian-angel";

function createPublicContext(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function episodeResult(episode: number): EpisodeResult {
  return {
    episode,
    streamUrl: `https://cdn.example.com/sample-${episode}.mp4`,
    subtitleTracks: "",
    qualityLabel: "Server 1",
    playerApiUrl: `https://player.example.com/?ep=${episode}`,
    status: "Verified",
  };
}

describe("extract.start quick test mode", () => {
  beforeEach(() => {
    extractorMocks.closeSeriesConnection.mockReset().mockResolvedValue(undefined);
    extractorMocks.openSeriesConnection.mockReset().mockResolvedValue({
      sessionId: "sample-session",
      browser: {},
      page: {},
      series: {},
      title: "Sample Drama",
      metadata: {
        title: "Sample Drama",
        description: "Sample source description.",
        coverImageUrl: "https://images.example.com/sample.jpg",
        sourcePageUrl: sourceUrl,
      },
      total: 60,
    } as SeriesConnection);
    extractorMocks.fetchEpisodeFromConnection.mockReset().mockImplementation(async (_connection: SeriesConnection, episode: number) => episodeResult(episode));
  });

  it("limits a quick test to the requested first episodes and exports only that sample", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const started = await caller.extract.start({ url: sourceUrl, sampleEpisodes: 3 });
    expect(started).toMatchObject({ total: 3, runTotal: 3, sourceTotal: 60, sampleEpisodeLimit: 3 });

    await caller.extract.advance({ jobId: started.jobId });
    await caller.extract.advance({ jobId: started.jobId });
    const completed = await caller.extract.advance({ jobId: started.jobId });
    expect(completed).toMatchObject({ state: "completed", completed: 3, total: 3, sourceTotal: 60, sampleEpisodeLimit: 3 });
    expect(extractorMocks.fetchEpisodeFromConnection.mock.calls.map(call => call[1])).toEqual([1, 2, 3]);

    const workbook = await caller.extract.download({ jobId: started.jobId });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(XLSX.read(workbook.base64, { type: "base64" }).Sheets["Stream URLs"], { header: 1 });
    expect(rows).toHaveLength(4);
  });
});
