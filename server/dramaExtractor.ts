import { chromium, type Browser, type Page } from "playwright-core";
import * as XLSX from "xlsx";

const DETAIL_HOST = "dramabox.dramafren.org";
const ANCHOR_API_BASE = "https://api.anchorbrowser.io/v1";

export type CompatibleSeries = {
  detailUrl: string;
  dramaId: string;
  lang: string;
};

export type EpisodeResult = {
  episode: number;
  streamUrl: string;
  qualityLabel: string;
  playerApiUrl: string;
  status: string;
};

export type SeriesConnection = {
  sessionId: string;
  browser: Browser;
  page: Page;
  series: CompatibleSeries;
  total: number;
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

export function parseCompatibleSeriesUrl(rawUrl: string): CompatibleSeries {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid DramaBox/DramaFren series-detail URL.");
  }

  const dramaId = url.searchParams.get("id");
  const isCompatible =
    url.protocol === "https:" &&
    url.hostname === DETAIL_HOST &&
    url.pathname === "/index.php" &&
    url.searchParams.get("page") === "detail" &&
    Boolean(dramaId && /^\d+$/.test(dramaId));

  if (!isCompatible || !dramaId) {
    throw new Error("Use a DramaBox/DramaFren series-detail URL with page=detail and an id parameter.");
  }

  return {
    detailUrl: url.toString(),
    dramaId,
    lang: url.searchParams.get("lang")?.trim() || "en",
  };
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
  const endpoint = new URL(`https://${DETAIL_HOST}/index.php`);
  endpoint.searchParams.set("action", "get_video");
  endpoint.searchParams.set("id", series.dramaId);
  endpoint.searchParams.set("ep", String(episode));
  endpoint.searchParams.set("lang", series.lang);
  endpoint.searchParams.set("sv", "1");
  return endpoint.toString();
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
  return `dramabox-stream-urls-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    const payload = await connection.page.evaluate(async endpoint => {
      const response = await fetch(endpoint, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.text();
      try {
        return JSON.parse(body) as PlayerPayload;
      } catch {
        return { ok: false, error: `Unexpected response (HTTP ${response.status})` } as PlayerPayload;
      }
    }, playerApiUrl);
    return normalizeEpisodePayload(episode, playerApiUrl, payload);
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
