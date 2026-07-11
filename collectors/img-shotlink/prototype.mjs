/**
 * IMG ShotLink collector — Phase 1 prototype.
 *
 * Loads the DraftKings-hosted IMG Arena widget for a specific event
 * in headless Chromium, watches the leaderboard's play-by-play cell
 * for each player, and streams a JSON shot event to stdout every
 * time a player's cell changes. The widget's JS handles Sportradar's
 * proprietary UTF-16 compression on the WebSocket; we just tap the
 * decoded, rendered result on the DOM.
 *
 * Selectors (validated by inspect-dom.mjs against Scottish Open 2026):
 *   Row:             [data-testid="leaderboard-entry-v2"]
 *   Play-by-play:    [data-testid="play-by-play-row"]
 *   Player hole:     [data-testid="player-hole"]
 *   Row name cell:   [data-testid="player-name"]  (fallback: first text-holding child)
 *
 * Play-by-play cell text format:
 *   "Hole 18, Shot 1: 324ydsFairway, 163yds to pin"
 *   "Hole 3, Shot 2Green (approx lie)"     ← no distance
 *   "Round Complete"                         ← end-of-round
 *   "At Tee"                                 ← awaiting first shot
 *
 * Output — one JSON per line to stdout:
 *   { "kind":"shot", "ts":..., "player":"...", "hole":..., "shotNum":..., ... }
 *   { "kind":"ws-frame", "ts":..., "bytes":..., "direction":"in|out" }
 *   { "kind":"heartbeat", "ts":..., "activeShots":N }
 *
 * Usage:
 *   node prototype.mjs --event=1427
 */

import { chromium } from "playwright";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    event: { type: "string", default: "1427" },
    operator: { type: "string", default: "draftkings" },
    "widget-base": {
      type: "string",
      default: "https://draftkings.apps.imgarena.com/golf/6.x/full/",
    },
    "run-ms": { type: "string", default: "0" },
    verbose: { type: "boolean", default: false },
  },
});

const EVENT_ID = values.event;
const OPERATOR = values.operator;
const WIDGET_URL =
  `${values["widget-base"]}?eventId=${EVENT_ID}&operator=${OPERATOR}` +
  `&theme=default&language=en&env=prod&targetModule=full#/leaderboard`;
const RUN_MS = Number(values["run-ms"]) || 0;
const VERBOSE = values.verbose;

function emit(kind, data) {
  process.stdout.write(
    JSON.stringify({ kind, ts: Date.now(), ...data }) + "\n",
  );
}

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

// ── WebSocket frame observer — for latency accounting ────────────────
page.on("websocket", (ws) => {
  emit("ws-open", { url: ws.url() });
  ws.on("close", () => emit("ws-close", { url: ws.url() }));
  if (VERBOSE) {
    ws.on("framereceived", (f) => {
      const bytes =
        typeof f.payload === "string"
          ? Buffer.byteLength(f.payload)
          : Buffer.from(f.payload).length;
      emit("ws-frame", { direction: "in", bytes });
    });
  }
});

// ── DOM scraper installed via init script ────────────────────────────
//
// Snapshot every leaderboard row's play-by-play cell on a 250 ms tick;
// diff against the previous tick; emit a shot event on any change.
// Fast enough to catch every update (widget itself renders at ~1-2 Hz
// on shot changes), slow enough to not burn CPU. Runs entirely in the
// page context; posts events back via console.log("__pardle__…").
await page.addInitScript(() => {
  const prevByRow = new Map(); // playerName → last pbp text
  let lastEmitCount = 0;

  function post(kind, data) {
    console.log("__pardle__" + JSON.stringify({ kind, ts: Date.now(), ...data }));
  }

  // Parse the play-by-play cell text into a structured shot event.
  // Handles the common shapes the widget produces.
  function parsePbp(raw) {
    if (!raw) return null;
    const t = raw.trim();

    // Round-boundary markers.
    if (/^Round Complete$/i.test(t)) return { state: "round-complete" };
    if (/^At Tee$/i.test(t)) return { state: "at-tee" };
    if (/^Hole (\d+)$/i.test(t)) return { state: "at-tee", hole: Number(RegExp.$1) };

    // Common shapes emitted by the widget:
    //   "Hole 18, Shot 1: 324ydsFairway, 163yds to pin"     — landed
    //   "Hole 3, Shot 2Green (approx lie)"                  — landed, no dist
    //   "Hole 10, Shot 1Hit Ball"                            — mid-swing
    //   "Hole 7, Shot 1Addressing Ball"                      — over the ball
    //   "Hole 11, Shot 2: 142ydsGreen, 52ft. 2in. to pin"   — landed on green
    //   "Round Complete"                                     — done
    //   "At Tee"                                             — awaiting
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
      // Pre/mid-shot markers — no landing surface yet.
      if (/^Addressing Ball$/i.test(restT)) {
        parsed.phase = "addressing";
        parsed.state = "addressing"; // upgrade signal: pre-shot
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
      // Surface + distance-to-pin: "Fairway, 163yds to pin"
      //                             "Green, 52ft. 2in. to pin"
      //                             "Semi Rough, 213yds to pin"
      //                             "Green (approx lie)"
      const dm = restT.match(/^([A-Za-z ]+?)(?:,\s*([^)]+?)\s+to pin)?(?:\s*\((approx lie)\))?$/);
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
    let emits = 0;
    for (const row of rows) {
      // Player name — the `translated-name` cell renders as
      // "LASTNAME, First" (last name is the CSS-uppercased ancestor,
      // first-name span is nested). Its .textContent already produces
      // the full "Keefer, Johnny" string.
      const nameEl = row.querySelector("[data-testid='translated-name']");
      const player = nameEl?.textContent?.trim() || null;
      if (!player) continue;

      const pbpEl = row.querySelector("[data-testid='play-by-play-row']");
      const pbp = pbpEl?.textContent?.trim() || "";
      // Placeholder states we don't want to emit — the widget renders
      // "-" while the WS hasn't sent this player's state yet, and ""
      // before the DOM node paints.
      const isPlaceholder = pbp === "" || pbp === "-";
      const prev = prevByRow.get(player);
      if (prev === pbp) continue;
      prevByRow.set(player, pbp);
      // First observation → seed only, no emit (would flood on startup).
      if (prev === undefined) continue;
      // Transitions into or between placeholder states are noise.
      if (isPlaceholder) continue;

      const parsed = parsePbp(pbp);
      // "unknown" state means the parser didn't recognise the text —
      // skip rather than emit an untyped shot. Log at heartbeat time
      // instead so we can debug missing patterns without flooding.
      if (parsed?.state === "unknown") continue;

      const holeEl = row.querySelector("[data-testid='player-hole']");
      const currentHoleDisplay = holeEl?.textContent?.trim();

      post("shot", {
        player,
        currentHoleDisplay,
        raw: pbp,
        prev,
        ...parsed,
      });
      emits++;
    }
    if (emits !== lastEmitCount || emits > 0) {
      lastEmitCount = emits;
    }
  }

  // First scan on DOM ready, then every 250 ms.
  window.addEventListener("DOMContentLoaded", () => {
    // First, emit a one-shot debug snapshot 3 s in so we can see what
    // the DOM extraction is actually seeing (player-name extraction
    // is the fragile part; if it silently fails every downstream
    // shot is dropped).
    setTimeout(() => {
      const rows = document.querySelectorAll("[data-testid='leaderboard-entry-v2']");
      const sample = [];
      for (const row of rows) {
        const nameEl = row.querySelector(
          "[data-testid='player-name'], [class*='playerName'], [class*='PlayerName']",
        );
        const pbpEl = row.querySelector("[data-testid='play-by-play-row']");
        sample.push({
          nameSelectorText: nameEl?.textContent?.trim() || null,
          fallbackFirstMatch: (() => {
            for (const c of row.querySelectorAll(":scope > *")) {
              const tx = c.textContent?.trim() || "";
              if (/^[A-Z][A-Z' -]+,\s+[A-Z]/.test(tx)) return tx;
            }
            return null;
          })(),
          allDataTestIds: Array.from(row.querySelectorAll("[data-testid]"))
            .map((e) => e.getAttribute("data-testid"))
            .slice(0, 10),
          pbp: pbpEl?.textContent?.trim() || null,
        });
        if (sample.length >= 3) break;
      }
      post("dom-debug", { sample });
    }, 3000);

    scan();
    setInterval(scan, 250);
    post("dom-observer", { installed: true, interval: 250 });
  });
});

// Relay page-side messages.
page.on("console", (msg) => {
  const text = msg.text();
  if (!text.startsWith("__pardle__")) return;
  try {
    const obj = JSON.parse(text.slice("__pardle__".length));
    emit(obj.kind, obj);
  } catch {}
});
page.on("pageerror", (err) => emit("page-error", { message: err.message }));

emit("nav-start", { url: WIDGET_URL, event: EVENT_ID });
await page.goto(WIDGET_URL, { waitUntil: "domcontentloaded" });
emit("nav-loaded", {});

const heartbeat = setInterval(() => {
  page
    .evaluate(() => ({
      pageAlive: true,
      rows: document.querySelectorAll("[data-testid='leaderboard-entry-v2']").length,
    }))
    .then((info) => emit("heartbeat", info))
    .catch(() => emit("heartbeat", { pageAlive: false }));
}, 10_000);

async function shutdown(reason) {
  emit("shutdown", { reason });
  clearInterval(heartbeat);
  await browser.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
if (RUN_MS > 0) setTimeout(() => shutdown("run-ms-elapsed"), RUN_MS);
