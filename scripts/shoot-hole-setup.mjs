// Render the HoleSetup table in isolation against real cell + pin
// data and screenshot it.
//
//   node scripts/shoot-hole-setup.mjs <cells.json> <pins.json> <meta.json> <round> <out.png> [widthPx]
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const [cellsPath, pinsPath, metaPath, round, out, widthArg] =
  process.argv.slice(2);
if (!cellsPath || !pinsPath || !metaPath || !round || !out) {
  console.error(
    "usage: node scripts/shoot-hole-setup.mjs <cells.json> <pins.json> <meta.json> <round> <out.png> [widthPx]",
  );
  process.exit(2);
}
const width = Number(widthArg ?? 900);

const heat = JSON.parse(await readFile(cellsPath, "utf-8"));
const pins = JSON.parse(await readFile(pinsPath, "utf-8"));
const meta = JSON.parse(await readFile(metaPath, "utf-8"));

const entry = resolve(ROOT, ".tmp-holesetup-entry.jsx");
await writeFile(
  entry,
  `import React from "react";
import { createRoot } from "react-dom/client";
import HoleSetup from "./app/analysis/hole-scoring/HoleSetup";
const heat = ${JSON.stringify(heat)};
const pins = ${JSON.stringify(pins)};
const pinsByHole = new Map(pins.holes.map((h) => [h.holeNumber, h]));
createRoot(document.getElementById("root")).render(
  React.createElement(HoleSetup, {
    cells: heat.cells,
    round: ${Number(round)},
    pinsByHole,
    holeBearings: ${JSON.stringify(meta.holeBearings ?? null)},
    weatherByRound: heat.weatherByRound ?? null,
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
<style>body{margin:0;padding:18px;background:oklch(0.972 0.009 95);font-family:system-ui,sans-serif}</style>
<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 1000 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(400);
await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
const el = await page.$("#root > div");
await (el ?? page).screenshot({ path: resolve(ROOT, out) });
await browser.close();
await rm(entry, { force: true });
console.log(`wrote ${out}`);
