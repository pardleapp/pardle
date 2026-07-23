// Mobile audit shooter — iPhone-sized viewport (390×844) across every
// primary user-facing surface. Emits one PNG per page to the passed
// output directory, plus a "combined" clipped shot per page (top 2600px)
// so we see the fold + a bit below.
import { webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error("usage: node shoot-mobile-audit.mjs <out-dir>");
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });

// Primary user-facing surfaces. Skipping demo/, promo/, share/, r/,
// c/[token] etc since those aren't primary product entry points.
const PAGES = [
  ["home",              "/"],
  ["feed",              "/live"],
  ["bets",              "/bets"],
  ["commentary",        "/commentary"],
  ["groups",            "/groups"],
  ["sharp",             "/sharp"],
  ["games",             "/games"],
  ["tools",             "/analysis"],
  ["notifications",     "/notifications"],
  ["course-heatmap",    "/analysis/course-heatmap"],
  ["tee-time-scoring",  "/analysis/tee-time-scoring"],
  ["tee-shots",         "/analysis/tee-shots"],
  ["players",           "/players"],
  ["leaderboard",       "/leaderboard"],
];

const BASE = process.env.BASE_URL || "https://pardle.app";

const browser = await webkit.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  for (const [name, path] of PAGES) {
    const url = `${BASE}${path}?bust=${Date.now()}`;
    const out = join(OUT_DIR, `${name}.png`);
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    } catch (e) {
      console.log(`${name} nav-warn:`, String(e).slice(0, 80));
    }
    // Let content hydrate + any polling settle.
    await new Promise((r) => setTimeout(r, 3500));
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: 390, height: 2400 },
    });
    console.log(name, "->", out);
    await page.close();
  }
  await ctx.close();
} finally {
  await browser.close();
}
