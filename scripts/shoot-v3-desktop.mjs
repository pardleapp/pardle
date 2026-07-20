// One-shot screenshotter for verifying the v3 desktop feed at the
// user's ask (1537×900). Full-page shot so we capture the layout
// beyond the fold too.
import { webkit } from "playwright";

const URL = process.argv[2] || "https://pardle.app/?v=3";
const OUT = process.argv[3] || "v3-desktop-1537.png";

const browser = await webkit.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1537, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  // Wait for the feed to hydrate + first poll to return so we
  // capture the ranked cards, not the skeleton.
  await new Promise((r) => setTimeout(r, 4500));
  // fullPage crashes on very long feed pages (>32767 px). Cap to
  // the first ~2500 px of the visible feed via a clip — enough to
  // see the header, ribbon, filter tabs and ~30 cards.
  await page.screenshot({
    path: OUT,
    clip: { x: 0, y: 0, width: 1537, height: 2400 },
  });
  console.log(OUT, "written");
  await ctx.close();
} finally {
  await browser.close();
}
