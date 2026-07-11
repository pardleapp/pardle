/**
 * One-shot DOM inspection — dump the widget's rendered structure so
 * we can pick correct selectors for the collector.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL =
  "https://draftkings.apps.imgarena.com/golf/6.x/full/?eventId=1427&operator=draftkings&theme=default&language=en&env=prod&targetModule=full#/leaderboard";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000); // give the SPA time to render

// Screenshot for visual reference.
await page.screenshot({ path: "./collectors/img-shotlink/widget-screenshot.png", fullPage: true });

// Snapshot the DOM tree with relevant attributes.
const dom = await page.evaluate(() => {
  const digest = (el, depth = 0, maxDepth = 6) => {
    if (depth > maxDepth) return null;
    const rect = el.getBoundingClientRect();
    const info = {
      tag: el.tagName.toLowerCase(),
      class: el.className && typeof el.className === "string" ? el.className.slice(0, 100) : null,
      testId: el.getAttribute("data-testid") || null,
      dataAttrs: Array.from(el.attributes)
        .filter((a) => a.name.startsWith("data-"))
        .map((a) => `${a.name}=${a.value.slice(0, 40)}`),
      textPreview: el.children.length === 0 ? (el.textContent || "").trim().slice(0, 60) : null,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      children: Array.from(el.children).slice(0, 20).map((c) => digest(c, depth + 1, maxDepth)).filter(Boolean),
    };
    return info;
  };
  return digest(document.body);
});
writeFileSync("./collectors/img-shotlink/dom-tree.json", JSON.stringify(dom, null, 2));

// Also grab any elements that look shot/leaderboard-related by keyword.
const candidates = await page.evaluate(() => {
  const all = document.querySelectorAll("*");
  const hits = [];
  const kw = /shot|play-by-play|playbyplay|leaderboard|leader-row|player-row|hole|score-row/i;
  for (const el of all) {
    const cls = typeof el.className === "string" ? el.className : "";
    const tid = el.getAttribute("data-testid") || "";
    if (kw.test(cls) || kw.test(tid)) {
      hits.push({
        tag: el.tagName.toLowerCase(),
        class: cls.slice(0, 120),
        testId: tid,
        text: (el.textContent || "").trim().slice(0, 100),
      });
    }
    if (hits.length >= 50) break;
  }
  return hits;
});
writeFileSync(
  "./collectors/img-shotlink/candidate-selectors.json",
  JSON.stringify(candidates, null, 2),
);

console.log(`inspected. ${candidates.length} candidate selectors, dom tree + screenshot written.`);
await browser.close();
