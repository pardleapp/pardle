// Render the course Heatmap in isolation against real cell + pin data
// and screenshot it, so layout changes can be eyeballed without
// standing up the tee-time page (whose API needs live services).
//
//   node scripts/shoot-heatmap.mjs <cells.json> <pins.json> <out.png> [widthPx]
//
// cells.json  = /api/analysis/course-heatmap response
// pins.json   = the `pins` object from /api/course-pins
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const [cellsPath, pinsPath, out, widthArg, roundArg, metaPath] = process.argv.slice(2);
if (!cellsPath || !pinsPath || !out) {
  console.error(
    "usage: node scripts/shoot-heatmap.mjs <cells.json> <pins.json> <out.png> [widthPx]",
  );
  process.exit(2);
}
const width = Number(widthArg ?? 1400);

const heat = JSON.parse(await readFile(cellsPath, "utf-8"));
const pins = JSON.parse(await readFile(pinsPath, "utf-8"));
const meta = metaPath
  ? JSON.parse(await readFile(metaPath, "utf-8"))
  : null;
const holeBearings = meta?.holeBearings ?? null;

const entry = resolve(ROOT, ".tmp-heatmap-entry.jsx");
await writeFile(
  entry,
  `import React from "react";
import { createRoot } from "react-dom/client";
import Heatmap from "./app/analysis/course-heatmap/Heatmap";
const heat = ${JSON.stringify(heat)};
const pins = ${JSON.stringify(pins)};
const pinsByHole = new Map(pins.holes.map((h) => [h.holeNumber, h]));
createRoot(document.getElementById("root")).render(
  React.createElement(Heatmap, {
    cells: heat.cells,
    bucketMinutes: heat.bucketMinutes ?? 15,
    weatherByRound: heat.weatherByRound ?? null,
    pinsByHole,
    pinsAvailable: true,
    holeBearings: ${JSON.stringify(holeBearings)},
  }),
);
`,
);

const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "iife",
  loader: { ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  absWorkingDir: ROOT,
});

const html = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;padding:20px;background:oklch(0.972 0.009 95);font-family:system-ui,sans-serif}</style>
<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 900 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(400);
const wantRound = roundArg ? String(roundArg) : null;
if (wantRound) {
  // Round tabs are plain buttons labelled R1..R4.
  const btn = page.locator(`button:text-is("R${wantRound}")`).first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(350);
  }
}
await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
// Clip to the top of the component — the course-length panel and the
// first rows are what we're checking, not the whole grid.
await page.screenshot({
  path: resolve(ROOT, out),
  clip: { x: 0, y: 0, width, height: width < 600 ? 420 : 560 },
});
await browser.close();
await rm(entry, { force: true });
console.log(`wrote ${out} (${width}px wide)`);
