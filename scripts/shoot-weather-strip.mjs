// Render WeatherStrip in isolation against a real ingested round and
// screenshot it, so the panel can be eyeballed without standing up the
// whole tee-time page (whose API needs live services).
//
//   node scripts/shoot-weather-strip.mjs <slug> <year> <round> <out.png> [widthPx]
//
// Compiles the component with esbuild, mounts it into a bare page, and
// shoots just the strip element.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const [slug, year, round, out, widthArg] = process.argv.slice(2);
if (!slug || !year || !round || !out) {
  console.error(
    "usage: node scripts/shoot-weather-strip.mjs <slug> <year> <round> <out.png> [widthPx]",
  );
  process.exit(2);
}
const width = Number(widthArg ?? 1280);

const payload = JSON.parse(
  await readFile(resolve(ROOT, "data/historical", `${slug}-${year}.json`), "utf-8"),
);
const day = payload.weatherByRound?.[String(round)];
if (!day) {
  console.error(`no weather for ${slug} ${year} R${round}`);
  process.exit(1);
}

const entry = resolve(ROOT, ".tmp-weather-entry.jsx");
await writeFile(
  entry,
  `import React from "react";
import { createRoot } from "react-dom/client";
import WeatherStrip from "./app/analysis/_components/WeatherStrip";
const day = ${JSON.stringify(day)};
createRoot(document.getElementById("root")).render(
  React.createElement(WeatherStrip, { day, roundLabel: "R${round} weather" }),
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
const js = bundle.outputFiles[0].text;

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:20px; background:oklch(0.972 0.009 95);
         font-family: system-ui, sans-serif; }
</style>
<div id="root"></div><script>${js}</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 700 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(400);
await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
if (width < 600) {
  // Phone: shoot the VIEWPORT, not the element — the strip scrolls
  // horizontally, so what matters is what fits before the scroll.
  await page.screenshot({ path: resolve(ROOT, out) });
} else {
  const el = await page.$("#root > div");
  await (el ?? page).screenshot({ path: resolve(ROOT, out) });
}
await browser.close();
await rm(entry, { force: true });
console.log(`wrote ${out} (${width}px wide)`);
