import { chromium } from "playwright-core";

const apiKey = process.env.ANCHOR_API_KEY;
if (!apiKey) throw new Error("ANCHOR_API_KEY is required to probe protected pages.");

const targets = [
  "https://idrama.dramafren.org/index.php?page=detail&id=100000643589&lang=en",
  "https://shortwave.dramafren.org/?id=6a7abff188333fa88a6207aa&slug=my-grumpy-billionaire-boss",
  "https://dramafren.org/series/a-lock-to-find-my-daughter/",
  "https://reelfren.dramafren.org/drama/wetv/bldjcvtb0dwqpu4-empress-reborn?lang=en",
];

async function request(path, init) {
  const response = await fetch(`https://api.anchorbrowser.io/v1${path}`, {
    ...init,
    headers: {
      "anchor-api-key": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Anchor request failed: ${response.status}`);
  return body;
}

async function probe(target) {
  const sessionResponse = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({
      browser: { extra_stealth: { active: true } },
      session: { proxy: { active: true, country_code: "us" } },
    }),
  });
  const session = sessionResponse.data;
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.cdp_url);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(6_000);
    const details = await page.evaluate(() => ({
      title: document.title,
      href: location.href,
      body: document.body.innerText.slice(0, 8_000),
      links: Array.from(document.querySelectorAll("a"))
        .map(node => ({ text: (node.textContent || "").trim(), href: node.href }))
        .filter(link => /ep\s*\d+|episode|watch|full/i.test(`${link.text} ${link.href}`))
        .slice(0, 80),
      scripts: Array.from(document.scripts)
        .map(script => ({ src: script.src, inline: script.textContent?.slice(0, 2_000) || "" }))
        .filter(script => /api|video|episode|player|drama/i.test(`${script.src} ${script.inline}`))
        .slice(0, 40),
      media: Array.from(document.querySelectorAll("video, source, iframe"))
        .map(node => ({ tag: node.tagName, src: node.getAttribute("src") || "" }))
        .filter(item => item.src),
    }));
    return { target, details };
  } catch (error) {
    return { target, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser?.close().catch(() => undefined);
    await request(`/sessions/${session.id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

const results = [];
for (const target of targets) results.push(await probe(target));
console.log(JSON.stringify(results, null, 2));
