"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeedRow } from "@/lib/feed/types";

const LAST_SEEN_KEY = "pardle_feed_last_seen";
const MIN_GAP_MS = 4 * 60 * 1000; // 4 min — don't pop if you were just here
const MIN_EVENTS = 3;
const MAX_TOP = 5;

interface Props {
  rows: FeedRow[];
}

interface Summary {
  total: number;
  eagles: number;
  birdies: number;
  blowups: number;
  topEvents: FeedRow[];
  oldestTs: number;
}

function summariseSince(rows: FeedRow[], since: number): Summary {
  const sinceRows = rows.filter((r) => r.event.ts > since);
  let eagles = 0;
  let birdies = 0;
  let blowups = 0;
  for (const r of sinceRows) {
    const e = r.event;
    if (e.ace || e.result === "eagle" || e.result === "albatross") eagles++;
    else if (e.result === "birdie") birdies++;
    else if (e.result === "double" || e.result === "triple-plus") blowups++;
  }
  const topEvents = sinceRows
    .filter((r) => r.event.ace || r.event.reelGreat || r.event.reelWorthy)
    .slice(0, MAX_TOP);
  const oldestTs =
    sinceRows.length > 0
      ? Math.min(...sinceRows.map((r) => r.event.ts))
      : since;
  return {
    total: sinceRows.length,
    eagles,
    birdies,
    blowups,
    topEvents,
    oldestTs,
  };
}

function gapLabel(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export default function CatchMeUp({ rows }: Props) {
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        setLastSeen(n);
        return;
      }
    }
    // First visit ever — record now so we don't pop the banner on
    // someone's very first /live load.
    const now = Date.now();
    window.localStorage.setItem(LAST_SEEN_KEY, String(now));
    setLastSeen(now);
  }, []);

  const summary = useMemo<Summary | null>(() => {
    if (lastSeen === null) return null;
    if (Date.now() - lastSeen < MIN_GAP_MS) return null;
    const s = summariseSince(rows, lastSeen);
    if (s.total < MIN_EVENTS) return null;
    return s;
  }, [lastSeen, rows]);

  if (hidden || !summary) return null;

  function markSeen() {
    const now = Date.now();
    window.localStorage.setItem(LAST_SEEN_KEY, String(now));
    setHidden(true);
    setOpen(false);
  }

  function dismissBanner() {
    // Slide the banner away without claiming the user actually read
    // the catch-up. Still bump lastSeen to suppress for this session.
    markSeen();
  }

  return (
    <>
      <button
        type="button"
        className="catchup-banner"
        onClick={() => setOpen(true)}
        aria-label="Catch up on what you missed"
      >
        <span className="catchup-banner-emoji" aria-hidden="true">
          🔥
        </span>
        <span className="catchup-banner-body">
          <strong>{summary.total} new</strong> since you were last here ·
          tap to catch up
        </span>
        <span
          className="catchup-banner-x"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            dismissBanner();
          }}
        >
          ✕
        </span>
      </button>

      {open && (
        <div
          className="catchup-overlay"
          onClick={markSeen}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="catchup-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="catchup-since">
              While you were away · {gapLabel(Date.now() - summary.oldestTs)}
            </p>
            <h3 className="catchup-title">
              {summary.total} events you missed
            </h3>

            <ul className="catchup-stats">
              {summary.eagles > 0 && (
                <li>
                  <span className="catchup-stat-num">{summary.eagles}</span>
                  <span className="catchup-stat-lbl">
                    🦅 {summary.eagles === 1 ? "eagle" : "eagles"}
                  </span>
                </li>
              )}
              <li>
                <span className="catchup-stat-num">{summary.birdies}</span>
                <span className="catchup-stat-lbl">
                  🐦 {summary.birdies === 1 ? "birdie" : "birdies"}
                </span>
              </li>
              {summary.blowups > 0 && (
                <li>
                  <span className="catchup-stat-num">{summary.blowups}</span>
                  <span className="catchup-stat-lbl">
                    💥 {summary.blowups === 1 ? "blow-up" : "blow-ups"}
                  </span>
                </li>
              )}
            </ul>

            {summary.topEvents.length > 0 && (
              <>
                <p className="catchup-section">Top moments</p>
                <ul className="catchup-list">
                  {summary.topEvents.map((r) => (
                    <li key={r.event.id}>
                      <span
                        className="catchup-emoji"
                        aria-hidden="true"
                      >
                        {r.event.emoji}
                      </span>
                      <span className="catchup-headline">
                        {r.event.headline}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              type="button"
              className="catchup-close"
              onClick={markSeen}
            >
              Got it →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
