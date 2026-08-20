import { chromium, type Browser, type Page } from "playwright-core";
import * as XLSX from "xlsx";

const DRAMABOX_HOST = "dramabox.dramafren.org";
const IDRAMA_HOST = "idrama.dramafren.org";
const DRAMAWAVE_HOST = "dramawave.dramafren.org";
const SHORTWAVE_HOST = "shortwave.dramafren.org";
const DRAMAFREN_HOST = "dramafren.org";
const ANCHOR_API_BASE = "https://api.anchorbrowser.io/v1";

export type StreamProvider = "dramabox" | "idrama" | "dramawave";

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
  subtitleTracks: string;
  qualityLabel: string;
  playerApiUrl: string;
  status: string;
};

export type ExtractionSummary = {
  verified: number;
  unavailable: number;
};

export type SeriesMetadata = {
  title: string;
  description: string;
  coverImageUrl: string;
  sourcePageUrl: string;
};

export type SeriesConnection = {
  sessionId: string;
  browser: Browser;
  page: Page;
  series: CompatibleSeries;
  title: string;
  metadata: SeriesMetadata;
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
  subtitles?: Array<{ subtitleLanguage?: string; language?: string; label?: string; url?: string; src?: string }>;
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
  const hasDramaWaveId = Boolean(dramaId && /^[A-Za-z0-9_-]+$/.test(dramaId));
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
    url.hostname === DRAMAWAVE_HOST &&
    url.pathname === "/index.php" &&
    url.searchParams.get("page") === "detail" &&
    hasDramaWaveId &&
    dramaId
  ) {
    return { provider: "dramawave", detailUrl: url.toString(), dramaId, lang, server: 1, initialEpisode: 1 };
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

  throw new Error("Use a DramaBox or DramaWave series-detail URL, or an iDrama watch URL with a supported id parameter.");
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
  const host = series.provider === "idrama" ? IDRAMA_HOST : series.provider === "dramawave" ? DRAMAWAVE_HOST : DRAMABOX_HOST;
  const endpoint = new URL(`https://${host}/index.php`);
  if (series.provider === "idrama") {
    endpoint.searchParams.set("page", "watch");
    endpoint.searchParams.set("id", series.dramaId);
    endpoint.searchParams.set("ep", String(episode));
    endpoint.searchParams.set("server", String(series.server));
    endpoint.searchParams.set("lang", series.lang);
    return endpoint.toString();
  }
  if (series.provider === "dramawave") {
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

function extractInlineJsonArray(scriptText: string, variableName: string): unknown[] {
  const match = scriptText.match(new RegExp(`(?:const|let|var)\\s+${variableName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, "i"));
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function extractDramaWavePlayerPayload(scriptText: string, watchUrl: string): PlayerPayload {
  const qualities = extractInlineJsonArray(scriptText, "qualityOptions")
    .map(item => ({
      quality: typeof item === "object" && item ? String((item as Record<string, unknown>).label || "HLS") : "HLS",
      url: typeof item === "object" && item ? String((item as Record<string, unknown>).url || "") : "",
    }))
    .filter(item => Boolean(item.url));
  const subtitles = extractInlineJsonArray(scriptText, "subtitleOptions")
    .map(item => {
      const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
      const relativeUrl = String(record.url || "");
      return {
        subtitleLanguage: String(record.label || record.lang_code || "Subtitle"),
        url: relativeUrl ? new URL(relativeUrl, watchUrl).toString() : "",
      };
    })
    .filter(item => Boolean(item.url));
  const videoUrl = qualities[0]?.url || "";
  return {
    ok: Boolean(videoUrl),
    videoUrl,
    sourceLabel: qualities[0]?.quality || "HLS",
    qualities,
    subtitles,
    error: videoUrl ? undefined : "The DramaWave watch page did not expose an HLS quality source.",
  };
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
  const subtitleTracks = formatSubtitleTracks(payload.subtitles);

  if (!payload.ok || !streamUrl) {
    return { episode, streamUrl: "", subtitleTracks, qualityLabel, playerApiUrl, status: payload.error?.trim() || "Stream URL unavailable" };
  }

  return { episode, streamUrl, subtitleTracks, qualityLabel, playerApiUrl, status: "Verified" };
}

export function formatSubtitleTracks(subtitles?: PlayerPayload["subtitles"]): string {
  if (!subtitles?.length) return "";
  return subtitles
    .map(track => {
      const url = track.url?.trim() || track.src?.trim() || "";
      const language = track.subtitleLanguage?.trim() || track.language?.trim() || track.label?.trim() || "Subtitle";
      return url ? `${language}: ${url}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function shouldRetryDramaBoxPayload(payload: PlayerPayload): boolean {
  return !payload.ok || !payload.videoUrl?.trim();
}

export function summarizeEpisodeResults(episodes: EpisodeResult[]): ExtractionSummary {
  const verified = episodes.filter(episode => Boolean(episode.streamUrl) && episode.status.startsWith("Verified")).length;
  return { verified, unavailable: episodes.length - verified };
}

export function replaceEpisodeResult(episodes: EpisodeResult[], replacement: EpisodeResult): EpisodeResult[] {
  return episodes.map(episode => (episode.episode === replacement.episode ? replacement : episode));
}

export function createWorkbookBase64(episodes: EpisodeResult[], metadata?: Partial<SeriesMetadata>): string {
  const workbook = XLSX.utils.book_new();
  const informationSheet = XLSX.utils.aoa_to_sheet([
    ["Series information", "Value"],
    ["Title", metadata?.title?.trim() || "Drama"],
    ["Description", metadata?.description?.trim() || ""],
    ["Cover image URL", metadata?.coverImageUrl?.trim() || ""],
    ["Source page URL", metadata?.sourcePageUrl?.trim() || ""],
  ]);
  informationSheet["!cols"] = [{ wch: 24 }, { wch: 110 }];
  informationSheet["!autofilter"] = { ref: "A1:B5" };
  XLSX.utils.book_append_sheet(workbook, informationSheet, "Series Info");

  const sheet = XLSX.utils.aoa_to_sheet([
    ["Episode", "Stream URL", "Subtitle Tracks", "Quality / Server", "Player API URL", "Status"],
    ...episodes.map(item => [item.episode, item.streamUrl, item.subtitleTracks, item.qualityLabel, item.playerApiUrl, item.status]),
  ]);

  sheet["!cols"] = [{ wch: 10 }, { wch: 90 }, { wch: 74 }, { wch: 26 }, { wch: 78 }, { wch: 28 }];
  sheet["!autofilter"] = { ref: `A1:F${episodes.length + 1}` };
  XLSX.utils.book_append_sheet(workbook, sheet, "Stream URLs");
  return XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
}

export function makeWorkbookFileName(seriesTitle?: string): string {
  const safeTitle = (seriesTitle || "drama")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 96);
  return `${safeTitle || "drama"}-stream-urls.xlsx`;
}

export function titleFromSlug(series: CompatibleSeries): string {
  const slug = new URL(series.detailUrl).searchParams.get("slug")?.trim();
  if (!slug) return "Drama";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function readSeriesTitle(page: Page, series: CompatibleSeries): Promise<string> {
  const heading = await page.locator("h1").first().innerText().catch(() => "");
  const pageTitle = await page.title().catch(() => "");
  const candidate = (heading || pageTitle || "").replace(/\s+/g, " ").replace(/\s*[|–-]\s*(DramaBox|iDrama|DramaWave).*$/i, "").trim();
  if (candidate && !/^(dramabox|idrama|dramawave|dramabox\.dramafren\.org|idrama\.dramafren\.org|dramawave\.dramafren\.org)$/i.test(candidate)) return candidate;
  return titleFromSlug(series);
}

export async function readSeriesMetadata(page: Page, series: CompatibleSeries): Promise<SeriesMetadata> {
  const title = await readSeriesTitle(page, series);
  const readAttribute = async (selector: string, attribute: string) =>
    (await page.locator(selector).first().getAttribute(attribute).catch(() => null))?.trim() || "";
  const readText = async (selector: string) =>
    (await page.locator(selector).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();

  const description =
    (await readAttribute('meta[property="og:description"]', "content"))
    || (await readAttribute('meta[name="description"]', "content"))
    || (await readAttribute('meta[name="twitter:description"]', "content"))
    || (await readText('[itemprop="description"]'))
    || (await readText('.drama-description'))
    || (await readText('.series-description'))
    || (await readText('.description'))
    || (await readText('.synopsis'))
    || (await readText('#description'))
    || (await readText('main p'))
    || (await readText('article p'));
  const coverImageUrl =
    (await readAttribute('meta[property="og:image"]', "content"))
    || (await readAttribute('meta[name="twitter:image"]', "content"))
    || (await readAttribute('[itemprop="image"]', "src"))
    || (await readAttribute('.drama-poster img', "src"))
    || (await readAttribute('.series-poster img', "src"))
    || (await readAttribute('.poster img', "src"))
    || (await readAttribute('.cover img', "src"))
    || (await readAttribute('img[src*="/uploads/"]', "src"))
    || (await readAttribute('main img', "src"))
    || (await readAttribute('article img', "src"));

  return {
    title,
    description: description.replace(/\s+/g, " ").trim() || "No description was published in the accessible source page.",
    coverImageUrl: coverImageUrl ? new URL(coverImageUrl, series.detailUrl).toString() : "",
    sourcePageUrl: series.detailUrl,
  };
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
      const metadata = await readSeriesMetadata(page, series);
      return {
        sessionId: session.id,
        browser,
        page,
        series,
        title: metadata.title,
        metadata,
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

    const metadata = await readSeriesMetadata(page, series);
    return { sessionId: session.id, browser, page, series, title: metadata.title, metadata, total: parseEpisodeCount(pageText) };
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
          subtitleTracks: "",
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
        subtitleTracks: "",
        qualityLabel: `Server ${connection.series.server} - iDrama`,
        playerApiUrl,
        status: "Verified",
      };
    }

    if (connection.series.provider === "dramawave") {
      const pageHtml = await connection.page.evaluate(async endpoint => {
        const response = await fetch(endpoint, { credentials: "same-origin" });
        const body = await response.text();
        if (!response.ok) throw new Error(`DramaWave watch page returned HTTP ${response.status}`);
        return body;
      }, playerApiUrl);
      return normalizeEpisodePayload(episode, playerApiUrl, extractDramaWavePlayerPayload(pageHtml, playerApiUrl));
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
          subtitleTracks: "",
          qualityLabel: "Server 1",
          playerApiUrl,
          status: error instanceof Error ? error.message : "Episode request failed",
        };
      }

      if (attempt < DRAMABOX_MAX_ATTEMPTS) await connection.page.waitForTimeout(650 * attempt);
    }

    return {
      ...(lastResult ?? { episode, streamUrl: "", subtitleTracks: "", qualityLabel: "Server 1", playerApiUrl, status: "Episode request failed" }),
      status: `Unavailable after ${DRAMABOX_MAX_ATTEMPTS} attempts: ${lastResult?.status ?? "Episode request failed"}`,
    };
  } catch (error) {
    return {
      episode,
      streamUrl: "",
      subtitleTracks: "",
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
