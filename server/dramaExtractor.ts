import { chromium, type Browser, type Page } from "playwright-core";
import * as XLSX from "xlsx";

const DRAMABOX_HOST = "dramabox.dramafren.org";
const IDRAMA_HOST = "idrama.dramafren.org";
const SHORTWAVE_HOST = "shortwave.dramafren.org";
const DRAMAFREN_HOST = "dramafren.org";
const ANCHOR_API_BASE = "https://api.anchorbrowser.io/v1";

export type StreamProvider = "dramabox" | "idrama";

export type CompatibleSeries = {
  provider: StreamProvider;
  detailUrl: string;
  dramaId: string;
  lang: string;
  server: number;
  initialEpisode: number;
};

export type EpisodeResult = {
  episode: number;
  streamUrl: string;
  qualityLabel: string;
  playerApiUrl: string;
  status: string;
};

export type ExtractionSummary = {
  verified: number;
  unavailable: number;
};

export type SeriesConnection = {
  sessionId: string;
  browser: Browser;
  page: Page;
  series: CompatibleSeries;
  total: number;
  initialVideoSource?: string;
};

type AnchorSession = {
  id: string;
  cdp_url: string;
};

type PlayerPayload = {
  ok?: boolean;
  videoUrl?: string;
  sourceLabel?: string;
  error?: string;
  qualities?: Array<{ quality?: string; url?: string }>;
};

const DRAMABOX_MAX_ATTEMPTS = 3;
const DRAMABOX_REQUEST_TIMEOUT_MS = 20_000;

export function parseCompatibleSeriesUrl(rawUrl: string): CompatibleSeries {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid DramaBox/DramaFren series-detail URL.");
  }

  const dramaId = url.searchParams.get("id")?.trim();
  const hasNumericId = Boolean(dramaId && /^\d+$/.test(dramaId));
  const lang = url.searchParams.get("lang")?.trim() || "en";

  if (url.protocol === "https:" && url.hostname === SHORTWAVE_HOST && url.searchParams.get("id")) {
    throw new Error(
      "ShortWave requires watching at least one minute of each previous episode before the next episode unlocks. This tool cannot automate full-series extraction without bypassing that source-site restriction.",
    );
  }

  if (url.protocol === "https:" && url.hostname === DRAMAFREN_HOST && url.pathname.startsWith("/watch/")) {
    throw new Error(
      "This DramaFren watch page contains one third-party player embed rather than a supported series episode endpoint. The supplied page exposes only Episode 1, so it cannot create a full episode workbook.",
    );
  }

  if (
    url.protocol === "https:" &&
    url.hostname === DRAMABOX_HOST &&
    url.pathname === "/index.php" &&
    url.searchParams.get("page") === "detail" &&
    hasNumericId &&
    dramaId
  ) {
    return { provider: "dramabox", detailUrl: url.toString(), dramaId, lang, server: 1, initialEpisode: 1 };
  }

  if (
    url.protocol === "https:" &&
    url.hostname === IDRAMA_HOST &&
    url.pathname === "/index.php" &&
    url.searchParams.get("page") === "watch" &&
    hasNumericId &&
    dramaId
  ) {
    const server = Number.parseInt(url.searchParams.get("server") || "1", 10);
    const initialEpisode = Number.parseInt(url.searchParams.get("ep") || "1", 10);
    return {
      provider: "idrama",
      detailUrl: url.toString(),
      dramaId,
      lang,
      server: Number.isInteger(server) && server > 0 ? server : 1,
      initialEpisode: Number.isInteger(initialEpisode) && initialEpisode > 0 ? initialEpisode : 1,
    };
  }

  throw new Error("Use a DramaBox series-detail URL or an iDrama watch URL with a numeric id parameter.");
}

export function parseEpisodeCount(pageText: string): number {
  const match = pageText.match(/Total:\s*(\d+)\s*Eps/i);
  const count = match ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new Error("The episode count could not be detected from this series page.");
  }
  return count;
}

export function buildPlayerApiUrl(series: CompatibleSeries, episode: number): string {
  const endpoint = new URL(`https://${series.provider === "idrama" ? IDRAMA_HOST : DRAMABOX_HOST}/index.php`);
  if (series.provider === "idrama") {
    endpoint.searchParams.set("page", "watch");
    endpoint.searchParams.set("id", series.dramaId);
    endpoint.searchParams.set("ep", String(episode));
    endpoint.searchParams.set("server", String(series.server));
    endpoint.searchParams.set("lang", series.lang);
    return endpoint.toString();
  }
  endpoint.searchParams.set("action", "get_video");
  endpoint.searchParams.set("id", series.dramaId);
  endpoint.searchParams.set("ep", String(episode));
  endpoint.searchParams.set("lang", series.lang);
  endpoint.searchParams.set("sv", "1");
  return endpoint.toString();
}

export function parseIdramaEpisodeCount(episodeLinks: string[]): number {
  const episodes = episodeLinks
    .map(href => Number.parseInt(new URL(href, `https://${IDRAMA_HOST}`).searchParams.get("ep") || "", 10))
    .filter(episode => Number.isInteger(episode) && episode > 0 && episode <= 500);
  const total = episodes.length > 0 ? Math.max(...episodes) : Number.NaN;
  if (!Number.isInteger(total)) throw new Error("The iDrama episode selector could not be detected from this watch page.");
  return total;
}

export function extractIdramaVideoSource(scriptText: string): string {
  const match = scriptText.match(/var\s+videoSrc\s*=\s*["']([^"']+)["']/i);
  if (!match?.[1]) throw new Error("The iDrama watch page did not expose a playable HLS source.");
  return match[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

export function idramaRetryMessage(pageText: string): string | null {
  if (/just a moment|performing security verification|cloudflare/i.test(pageText)) {
    return "iDrama beta is temporarily blocked by the source site's verification page. Please wait a moment and retry the same link.";
  }
  return null;
}

async function readIdramaVideoSource(page: Page): Promise<string> {
  const scriptText = (await page.locator("script:not([src])").allTextContents()).join("\n");
  try {
    return extractIdramaVideoSource(scriptText);
  } catch {
    const mediaSource = await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      return video?.currentSrc || video?.src || "";
    });
    if (mediaSource) return mediaSource;
    throw new Error("The iDrama watch page did not expose a playable HLS source.");
  }
}

async function waitForIdramaVideoSource(page: Page): Promise<string> {
  const deadline = Date.now() + 30_000;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      return await readIdramaVideoSource(page);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await page.waitForTimeout(1_500);
    }
  }
  throw lastError ?? new Error("The iDrama watch page did not expose a playable HLS source.");
}

export function normalizeEpisodePayload(
  episode: number,
  playerApiUrl: string,
  payload: PlayerPayload,
): EpisodeResult {
  const streamUrl = payload.videoUrl?.trim() ?? "";
  const matchingQuality = payload.qualities?.find(item => item.url === streamUrl)?.quality?.trim();
  const qualityLabel = matchingQuality || payload.sourceLabel?.trim() || "Server 1";

  if (!payload.ok || !streamUrl) {
    return { episode, streamUrl: "", qualityLabel, playerApiUrl, status: payload.error?.trim() || "Stream URL unavailable" };
  }

  return { episode, streamUrl, qualityLabel, playerApiUrl, status: "Verified" };
}

export function shouldRetryDramaBoxPayload(payload: PlayerPayload): boolean {
  return !payload.ok || !payload.videoUrl?.trim();
}

export function summarizeEpisodeResults(episodes: EpisodeResult[]): ExtractionSummary {
  const verified = episodes.filter(episode => Boolean(episode.streamUrl) && episode.status.startsWith("Verified")).length;
  return { verified, unavailable: episodes.length - verified };
}

export function createWorkbookBase64(episodes: EpisodeResult[]): string {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Episode", "Stream URL", "Quality / Server", "Player API URL", "Status"],
    ...episodes.map(item => [item.episode, item.streamUrl, item.qualityLabel, item.playerApiUrl, item.status]),
  ]);

  sheet["!cols"] = [{ wch: 10 }, { wch: 90 }, { wch: 26 }, { wch: 78 }, { wch: 28 }];
  sheet["!autofilter"] = { ref: `A1:E${episodes.length + 1}` };
  XLSX.utils.book_append_sheet(workbook, sheet, "Stream URLs");
  return XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
}

export function makeWorkbookFileName(): string {
  return `drama-stream-urls-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

async function requestAnchor<T>(path: string, init: RequestInit): Promise<T> {
  const apiKey = process.env.ANCHOR_API_KEY;
  if (!apiKey) throw new Error("The server browser-session credential is not configured.");

  const response = await fetch(`${ANCHOR_API_BASE}${path}`, {
    ...init,
    headers: { "anchor-api-key": apiKey, "Content-Type": "application/json", ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("The protected browser session could not be started.");
  return payload as T;
}

async function createAnchorSession(): Promise<AnchorSession> {
  const response = await requestAnchor<{ data?: AnchorSession }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      browser: { extra_stealth: { active: true } },
      session: { proxy: { active: true, country_code: "us" } },
    }),
  });
  if (!response.data?.id || !response.data.cdp_url) {
    throw new Error("The protected browser session returned an incomplete connection.");
  }
  return response.data;
}

async function deleteAnchorSession(sessionId: string): Promise<void> {
  try {
    await requestAnchor(`/sessions/${sessionId}`, { method: "DELETE" });
  } catch {
    // The cloud browser automatically expires if an explicit close ever fails.
  }
}

export async function openSeriesConnection(rawUrl: string): Promise<SeriesConnection> {
  const series = parseCompatibleSeriesUrl(rawUrl);
  const session = await createAnchorSession();
  let browser: Browser | undefined;

  try {
    browser = await chromium.connectOverCDP(session.cdp_url);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(series.detailUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

    if (series.provider === "idrama") {
      try {
        await page.waitForFunction(
          () => document.querySelectorAll('#sheet-episodes a[href*="page=watch"][href*="ep="]').length > 0,
          undefined,
          { timeout: 120_000 },
        );
      } catch (error) {
        const pageText = await page.locator("body").innerText().catch(() => "");
        const retryMessage = idramaRetryMessage(pageText);
        if (retryMessage) throw new Error(retryMessage);
        throw error;
      }
      const episodeLinks = await page.locator('#sheet-episodes a[href*="page=watch"][href*="ep="]').evaluateAll(
        links => links.map(link => (link as HTMLAnchorElement).href),
      );
      const initialVideoSource = await waitForIdramaVideoSource(page).catch(() => undefined);
      return {
        sessionId: session.id,
        browser,
        page,
        series,
        total: parseIdramaEpisodeCount(episodeLinks),
        initialVideoSource,
      };
    }

    const readyBy = Date.now() + 120_000;
    let pageText = "";
    while (Date.now() < readyBy) {
      pageText = await page.locator("body").innerText().catch(() => "");
      const title = await page.title().catch(() => "");
      if (!title.includes("Just a moment") && /Total:\s*\d+\s*Eps/i.test(pageText)) break;
      await page.waitForTimeout(2_500);
    }

    return { sessionId: session.id, browser, page, series, total: parseEpisodeCount(pageText) };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await deleteAnchorSession(session.id);
    throw error;
  }
}

export async function fetchEpisodeFromConnection(
  connection: SeriesConnection,
  episode: number,
): Promise<EpisodeResult> {
  const playerApiUrl = buildPlayerApiUrl(connection.series, episode);
  try {
    if (connection.series.provider === "idrama") {
      if (episode === connection.series.initialEpisode && connection.initialVideoSource) {
        return {
          episode,
          streamUrl: connection.initialVideoSource,
          qualityLabel: `Server ${connection.series.server} - iDrama`,
          playerApiUrl,
          status: "Verified",
        };
      }
      const pageHtml = await connection.page.evaluate(async endpoint => {
        const response = await fetch(endpoint, { credentials: "same-origin" });
        const body = await response.text();
        if (!response.ok) throw new Error(`iDrama watch page returned HTTP ${response.status}`);
        return body;
      }, playerApiUrl);
      return {
        episode,
        streamUrl: extractIdramaVideoSource(pageHtml),
        qualityLabel: `Server ${connection.series.server} - iDrama`,
        playerApiUrl,
        status: "Verified",
      };
    }

    let lastResult: EpisodeResult | undefined;
    for (let attempt = 1; attempt <= DRAMABOX_MAX_ATTEMPTS; attempt += 1) {
      try {
        const payload = await connection.page.evaluate(
          async ({ endpoint, timeoutMs }) => {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetch(endpoint, {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                signal: controller.signal,
              });
              const body = await response.text();
              try {
                return JSON.parse(body) as PlayerPayload;
              } catch {
                return { ok: false, error: `Unexpected response (HTTP ${response.status})` } as PlayerPayload;
              }
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error && error.name === "AbortError" ? "Player request timed out" : "Player request was interrupted",
              } as PlayerPayload;
            } finally {
              window.clearTimeout(timeoutId);
            }
          },
          { endpoint: playerApiUrl, timeoutMs: DRAMABOX_REQUEST_TIMEOUT_MS },
        );
        const normalized = normalizeEpisodePayload(episode, playerApiUrl, payload);
        lastResult = normalized;
        if (!shouldRetryDramaBoxPayload(payload)) {
          return attempt === 1 ? normalized : { ...normalized, status: `Verified after ${attempt} attempts` };
        }
      } catch (error) {
        lastResult = {
          episode,
          streamUrl: "",
          qualityLabel: "Server 1",
          playerApiUrl,
          status: error instanceof Error ? error.message : "Episode request failed",
        };
      }

      if (attempt < DRAMABOX_MAX_ATTEMPTS) await connection.page.waitForTimeout(650 * attempt);
    }

    return {
      ...(lastResult ?? { episode, streamUrl: "", qualityLabel: "Server 1", playerApiUrl, status: "Episode request failed" }),
      status: `Unavailable after ${DRAMABOX_MAX_ATTEMPTS} attempts: ${lastResult?.status ?? "Episode request failed"}`,
    };
  } catch (error) {
    return {
      episode,
      streamUrl: "",
      qualityLabel: "Server 1",
      playerApiUrl,
      status: error instanceof Error ? error.message : "Episode request failed",
    };
  }
}

export async function closeSeriesConnection(connection: SeriesConnection | null): Promise<void> {
  if (!connection) return;
  await connection.browser.close().catch(() => undefined);
  await deleteAnchorSession(connection.sessionId);
}
