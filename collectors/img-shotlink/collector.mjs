/**
 * IMG ShotLink production collector.
 *
 * Same DOM tap as prototype.mjs, but wired to the Redis publisher so
 * shot events land directly in the main app's `feed:events:{tournamentId}`
 * key. This is the entry point Fly.io runs.
 *
 * Env vars (required):
 *   TOURNAMENT_ID        Pardle-side tournament id (e.g. "R2026030")
 *   IMG_EVENT_ID         IMG Arena's numeric event id for the tournament
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Env vars (optional):
 *   TOURNAMENT_NAME      Display name to bake onto every published event
 *   OPERATOR             DraftKings-branded widget by default
 *   HEARTBEAT_MS         Default 10_000
 *   SHUTDOWN_ON_IDLE_MS  Auto-stop if no shots in this window. Default 0 = never
 */

import { chromium } from "playwright";
import { createPublisher } from "./publisher.mjs";

const REQUIRED_ENV = [
  "TOURNAMENT_ID",
  "IMG_EVENT_ID",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    console.error(`[collector] missing required env: ${k}`);
    process.exit(2);
  }
}

const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME || null;
const IMG_EVENT_ID = process.env.IMG_EVENT_ID;
const OPERATOR = process.env.OPERATOR || "draftkings";
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 10_000;
const SHUTDOWN_ON_IDLE_MS = Number(process.env.SHUTDOWN_ON_IDLE_MS) || 0;
// Shadow mode = publish to feed:img-events:{tournamentId} instead of the
// live feed:events:{tournamentId}. Default TRUE so a fresh Fly deploy
// can't corrupt the live feed until we explicitly flip it.
const SHADOW_MODE =
  process.env.SHADOW_MODE == null
    ? true
    : /^(1|true|yes)$/i.test(process.env.SHADOW_MODE);

const WIDGET_URL =
  `https://draftkings.apps.imgarena.com/golf/6.x/full/` +
  `?eventId=${IMG_EVENT_ID}&operator=${OPERATOR}` +
  `&theme=default&language=en&env=prod&targetModule=full#/leaderboard`;

function log(kind, data = {}) {
  process.stdout.write(
    JSON.stringify({ kind, ts: Date.now(), ...data }) + "\n",
  );
}

const publisher = createPublisher({
  tournamentId: TOURNAMENT_ID,
  tournamentName: TOURNAMENT_NAME,
  redisUrl: process.env.UPSTASH_REDIS_REST_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  shadowMode: SHADOW_MODE,
});

log("boot", {
  tournamentId: TOURNAMENT_ID,
  imgEventId: IMG_EVENT_ID,
  operator: OPERATOR,
  widget: WIDGET_URL,
  shadowMode: SHADOW_MODE,
});

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-gpu", "--no-sandbox"],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});
const page = await ctx.newPage();

let lastShotTs = Date.now();
let totalPublished = 0;
let totalOrphan = 0;
let totalSkipped = 0;

page.on("console", async (msg) => {
  const text = msg.text();
  if (!text.startsWith("__pardle__")) return;
  try {
    const obj = JSON.parse(text.slice("__pardle__".length));
    if (obj.kind !== "shot") {
      log(obj.kind, obj);
      return;
    }
    const published = await publisher.publishShot(obj);
    if (published?.orphan) {
      totalOrphan++;
      log("orphan-shot", {
        player: obj.player,
        reason: published.reason,
        hole: obj.hole,
        shotNum: obj.shotNum,
      });
      return;
    }
    if (!published) {
      totalSkipped++;
      return;
    }
    totalPublished++;
    lastShotTs = Date.now();
    log("published", {
      eventId: published.id,
      type: published.type,
      player: published.playerName,
      hole: published.hole,
      headline: published.headline,
    });
  } catch (err) {
    log("relay-error", { message: err.message });
  }
});
page.on("pageerror", (err) => log("page-error", { message: err.message }));
page.on("websocket", (ws) => {
  log("ws-open", { url: ws.url() });
  ws.on("close", () => log("ws-close", { url: ws.url() }));
});

// Same DOM scraper as prototype.mjs — inlined here so the collector
// is one self-contained deploy unit. See prototype.mjs for the full
// commentary on selectors + parsing.
await page.addInitScript(() => {
  const prevByRow = new Map();

  function post(kind, data) {
    console.log("__pardle__" + JSON.stringify({ kind, ts: Date.now(), ...data }));
  }

  function parsePbp(raw) {
    if (!raw) return null;
    const t = raw.trim();
    if (/^Round Complete$/i.test(t)) return { state: "round-complete" };
    if (/^At Tee$/i.test(t)) return { state: "at-tee" };
    if (/^Hole (\d+)$/i.test(t))
      return { state: "at-tee", hole: Number(RegExp.$1) };
    const m = t.match(
      /^Hole (\d+), Shot (\d+)(?:: (\d+(?:\.\d+)?)(yds|ft))?([A-Za-z].*)?$/,
    );
    if (!m) return { state: "unknown", raw: t };
    const [, holeStr, shotStr, distStr, distUnit, rest] = m;
    const parsed = {
      state: "shot",
      hole: Number(holeStr),
      shotNum: Number(shotStr),
    };
    if (distStr) {
      parsed.shotDistance = Number(distStr);
      parsed.shotDistanceUnit = distUnit;
    }
    if (rest) {
      const restT = rest.trim();
      if (/^Addressing Ball$/i.test(restT)) {
        parsed.phase = "addressing";
        parsed.state = "addressing";
        return parsed;
      }
      if (/^Hit Ball$/i.test(restT)) {
        parsed.phase = "in-flight";
        parsed.state = "in-flight";
        return parsed;
      }
      if (/^Walking Lie$/i.test(restT) || /^Walked Lie$/i.test(restT)) {
        parsed.phase = "walking";
        parsed.state = "walking";
        return parsed;
      }
      const dm = restT.match(
        /^([A-Za-z ]+?)(?:,\s*([^)]+?)\s+to pin)?(?:\s*\((approx lie)\))?$/,
      );
      if (dm) {
        parsed.surface = dm[1].trim();
        if (dm[2]) parsed.toPin = dm[2].trim();
        if (dm[3]) parsed.approxLie = true;
      } else {
        parsed.surface = restT;
      }
    }
    return parsed;
  }

  function scan() {
    const rows = document.querySelectorAll(
      "[data-testid='leaderboard-entry-v2']",
    );
    for (const row of rows) {
      const nameEl = row.querySelector("[data-testid='translated-name']");
      const player = nameEl?.textContent?.trim() || null;
      if (!player) continue;

      const pbpEl = row.querySelector("[data-testid='play-by-play-row']");
      const pbp = pbpEl?.textContent?.trim() || "";
      const isPlaceholder = pbp === "" || pbp === "-";
      const prev = prevByRow.get(player);
      if (prev === pbp) continue;
      prevByRow.set(player, pbp);
      if (prev === undefined) continue;
      if (isPlaceholder) continue;

      const parsed = parsePbp(pbp);
      if (parsed?.state === "unknown") continue;

      const holeEl = row.querySelector("[data-testid='player-hole']");
      const currentHoleDisplay = holeEl?.textContent?.trim();

      post("shot", {
        player,
        currentHoleDisplay,
        raw: pbp,
        ...parsed,
      });
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    scan();
    setInterval(scan, 250);
    post("dom-observer", { installed: true });
  });
});

log("nav-start", { url: WIDGET_URL });
await page.goto(WIDGET_URL, { waitUntil: "domcontentloaded" });
log("nav-loaded", {});

const heartbeat = setInterval(async () => {
  try {
    const info = await page.evaluate(() => ({
      rows: document.querySelectorAll("[data-testid='leaderboard-entry-v2']")
        .length,
    }));
    log("heartbeat", {
      ...info,
      totalPublished,
      totalOrphan,
      totalSkipped,
      lastShotAgeMs: Date.now() - lastShotTs,
      publisher: publisher.stats(),
    });
    if (
      SHUTDOWN_ON_IDLE_MS > 0 &&
      Date.now() - lastShotTs > SHUTDOWN_ON_IDLE_MS
    ) {
      log("shutdown", { reason: "idle-timeout" });
      await browser.close();
      process.exit(0);
    }
  } catch (err) {
    log("heartbeat-error", { message: err.message });
  }
}, HEARTBEAT_MS);

async function shutdown(reason) {
  log("shutdown", { reason });
  clearInterval(heartbeat);
  await browser.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
