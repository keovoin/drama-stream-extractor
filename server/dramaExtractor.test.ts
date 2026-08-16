import { describe, expect, it } from "vitest";
import {
  buildPlayerApiUrl,
  createWorkbookBase64,
  extractIdramaVideoSource,
  idramaRetryMessage,
  normalizeEpisodePayload,
  parseCompatibleSeriesUrl,
  parseEpisodeCount,
  parseIdramaEpisodeCount,
  shouldRetryDramaBoxPayload,
  summarizeEpisodeResults,
} from "./dramaExtractor";

describe("DramaBox/DramaFren extractor helpers", () => {
  const series = parseCompatibleSeriesUrl(
    "https://dramabox.dramafren.org/index.php?page=detail&id=42000023494&lang=en&slug=the-godfather-s-guardian-angel",
  );

  it("accepts a compatible series-detail URL and builds the player API URL", () => {
    expect(series.dramaId).toBe("42000023494");
    expect(buildPlayerApiUrl(series, 7)).toBe(
      "https://dramabox.dramafren.org/index.php?action=get_video&id=42000023494&ep=7&lang=en&sv=1",
    );
  });

  it("accepts iDrama watch pages and extracts page-provided HLS sources", () => {
    const idrama = parseCompatibleSeriesUrl(
      "https://idrama.dramafren.org/index.php?page=watch&id=100000643262&ep=1&lang=en",
    );
    expect(idrama.provider).toBe("idrama");
    expect(buildPlayerApiUrl(idrama, 2)).toBe(
      "https://idrama.dramafren.org/index.php?page=watch&id=100000643262&ep=2&server=1&lang=en",
    );
    expect(
      parseIdramaEpisodeCount([
        "index.php?page=watch&id=100000643262&ep=1&server=1&lang=en",
        "index.php?page=watch&id=100000643262&ep=33&server=1&lang=en",
      ]),
    ).toBe(33);
    expect(extractIdramaVideoSource('var videoSrc = "https:\\/\\/v-a.idrama.video\\/episode.m3u8?token=abc";')).toBe(
      "https://v-a.idrama.video/episode.m3u8?token=abc",
    );
    expect(idramaRetryMessage("Performing security verification\nJust a moment...")).toContain("iDrama beta");
    expect(idramaRetryMessage("The episode selector is ready")).toBeNull();
  });

  it("rejects unsupported or incomplete detail URLs", () => {
    expect(() => parseCompatibleSeriesUrl("https://example.com/video")).toThrow("Use a DramaBox series-detail URL or an iDrama watch URL");
    expect(() => parseCompatibleSeriesUrl("https://shortwave.dramafren.org/?id=6a7c0db4f0cf754ca9d95c7e")).toThrow(
      "ShortWave requires watching at least one minute",
    );
    expect(() => parseCompatibleSeriesUrl("https://dramafren.org/watch/a-lock-to-find-my-daughter/#/")).toThrow(
      "one third-party player embed",
    );
    expect(() => parseCompatibleSeriesUrl("not-a-url")).toThrow("Enter a valid");
  });

  it("detects a valid episode count and rejects absent counts", () => {
    expect(parseEpisodeCount("The Godfather's Guardian Angel\nTotal: 60 Eps")).toBe(60);
    expect(() => parseEpisodeCount("No episode information")).toThrow("episode count");
  });

  it("preserves failed episode rows and generates an Excel workbook", () => {
    const apiUrl = buildPlayerApiUrl(series, 1);
    const verified = normalizeEpisodePayload(1, apiUrl, {
      ok: true,
      videoUrl: "https://cdn.example.com/episode-1.mp4",
      qualities: [{ quality: "Server 1 720p", url: "https://cdn.example.com/episode-1.mp4" }],
    });
    const failed = normalizeEpisodePayload(2, buildPlayerApiUrl(series, 2), {
      ok: false,
      error: "Video unavailable",
    });

    expect(verified.status).toBe("Verified");
    expect(verified.qualityLabel).toBe("Server 1 720p");
    expect(failed.status).toBe("Video unavailable");
    expect(createWorkbookBase64([verified, failed])).toMatch(/^UEsDB/);
  });

  it("retries only empty DramaBox player responses and summarizes partial results", () => {
    expect(shouldRetryDramaBoxPayload({ ok: true, videoUrl: "https://cdn.example.com/episode-1.mp4" })).toBe(false);
    expect(shouldRetryDramaBoxPayload({ ok: true, videoUrl: "" })).toBe(true);
    expect(shouldRetryDramaBoxPayload({ ok: false, error: "Player request timed out" })).toBe(true);

    const summary = summarizeEpisodeResults([
      { episode: 1, streamUrl: "https://cdn.example.com/episode-1.mp4", qualityLabel: "Server 1", playerApiUrl: "https://api.example.com/1", status: "Verified" },
      { episode: 2, streamUrl: "", qualityLabel: "Server 1", playerApiUrl: "https://api.example.com/2", status: "Unavailable after 3 attempts: Player request timed out" },
    ]);
    expect(summary).toEqual({ verified: 1, unavailable: 1 });
  });
});
