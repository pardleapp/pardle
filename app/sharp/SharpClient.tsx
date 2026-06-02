"use client";

/**
 * SharpClient — redesigned /sharp surface matching the design-
 * handoff prototype's <Sharp>:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │                  72                          │
 *   │            YOUR SHARP SCORE                  │
 *   │  #3 in The Lads · top 9% on Pardle · ▲4      │
 *   └──────────────────────────────────────────────┘
 *
 *   PUTT-IQ · THE LADS VOTE
 *   ┌──────────────────────────────────────────────┐
 *   │ Does Henley hold on for the win?             │
 *   │ ▓▓▓▓▓▓▓░░░ Yes — Henley closes it out  61%   │
 *   │ ▓▓▓░░░░░░░ No — the field reels him in 39%   │
 *   │              Tap to lock your read           │
 *   └──────────────────────────────────────────────┘
 *
 *   YOUR CALLS · OPEN
 *   ┌──────────────────────────────────────────────┐
 *   │ Does Henley hold on for the win? · PENDING   │
 *   │ Your pick: Yes — Henley closes it out        │
 *   └──────────────────────────────────────────────┘
 *
 *   YOUR CALLS · SETTLED
 *   …
 *
 * Mock data drives the first cut; real wiring (sharp-score module
 * + putt-iq feed) is a follow-up. Copy guardrails: no third-party
 * data source names, no latency / refresh figures.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MOCK_SHARP_STATS,
  MOCK_SHARP_POLL,
  MOCK_SHARP_OPEN_CALLS,
  MOCK_SHARP_SETTLED_CALLS,
  type MockSharpCall,
} from "./mock-sharp";

function CallRow({ call }: { call: MockSharpCall }) {
  const statusClass =
    call.status === "right"
      ? "sh-call-status sh-call-status-right"
      : call.status === "wrong"
        ? "sh-call-status sh-call-status-wrong"
        : "sh-call-status sh-call-status-pending";
  const statusLabel =
    call.status === "right"
      ? "RIGHT"
      : call.status === "wrong"
        ? "WRONG"
        : "PENDING";
  return (
    <li className="sh-call">
      <div className="sh-call-head">
        <span className="sh-call-q">{call.question}</span>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="sh-call-sub">
        <span className="sh-call-pick">Your pick · {call.myPick}</span>
        <span className="sh-call-meta">
          {call.context} · {call.time}
        </span>
      </div>
    </li>
  );
}

export default function SharpClient() {
  const [voted, setVoted] = useState<number | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  const stats = MOCK_SHARP_STATS;
  const poll = MOCK_SHARP_POLL;
  const deltaPositive = !stats.delta.startsWith("−");
  const accPct = Math.round(
    (stats.correctCalls / Math.max(1, stats.totalCalls)) * 100,
  );

  return (
    <section className="sh-pv">
      <div className="sh-pv-body">
        {/* Hero gauge */}
        <div className="sh-gauge">
          <div className="sh-gauge-num">{stats.score}</div>
          <div className="sh-gauge-lbl">Your Sharp Score</div>
          <div className="sh-gauge-sub">
            {stats.rankLabel} · {stats.percentileLabel} ·{" "}
            <span
              className={
                deltaPositive ? "sh-gauge-delta-up" : "sh-gauge-delta-down"
              }
            >
              {deltaPositive ? "▲" : "▼"} {stats.delta.replace(/[+−]/g, "")}
            </span>
          </div>
          <div className="sh-gauge-stats">
            <span>
              <b>{accPct}%</b> accuracy
            </span>
            <span className="sh-gauge-sep" aria-hidden="true">
              ·
            </span>
            <span>
              <b>
                {stats.correctCalls}/{stats.totalCalls}
              </b>{" "}
              calls
            </span>
            {stats.currentStreak >= 2 && (
              <>
                <span className="sh-gauge-sep" aria-hidden="true">
                  ·
                </span>
                <span>
                  🔥 <b>{stats.currentStreak}</b> in a row
                </span>
              </>
            )}
          </div>
        </div>

        {/* Open Putt-IQ poll */}
        <section className="sh-section">
          <div className="sh-section-label">{poll.eyebrow}</div>
          <div className="sh-poll">
            <div className="sh-poll-q">{poll.question}</div>
            <div className="sh-poll-opts">
              {poll.options.map((o, i) => (
                <button
                  type="button"
                  key={i}
                  className={`sh-poll-opt${voted !== null ? " sh-poll-opt-voted" : ""}${voted === i ? " sh-poll-opt-mine" : ""}`}
                  style={{
                    ["--pct" as string]: `${o.pct}%`,
                  } as React.CSSProperties}
                  onClick={() => setVoted(i)}
                >
                  <span className="sh-poll-fill" aria-hidden="true" />
                  <span className="sh-poll-lab">{o.label}</span>
                  <span className="sh-poll-pct">
                    {voted !== null ? `${o.pct}%` : ""}
                  </span>
                </button>
              ))}
            </div>
            <div className="sh-poll-foot">
              {voted !== null ? poll.postVoteSub : poll.preVoteSub}
            </div>
          </div>
        </section>

        {/* Open calls */}
        {MOCK_SHARP_OPEN_CALLS.length > 0 && (
          <section className="sh-section">
            <div className="sh-section-label">
              Your calls · open
              <span className="sh-section-count">
                {MOCK_SHARP_OPEN_CALLS.length}
              </span>
            </div>
            <ul className="sh-call-list">
              {MOCK_SHARP_OPEN_CALLS.map((c) => (
                <CallRow key={c.id} call={c} />
              ))}
            </ul>
          </section>
        )}

        {/* Settled calls */}
        {MOCK_SHARP_SETTLED_CALLS.length > 0 && (
          <section className="sh-section">
            <div className="sh-section-label">
              Your calls · settled
              <span className="sh-section-count">
                {MOCK_SHARP_SETTLED_CALLS.length}
              </span>
            </div>
            <ul className="sh-call-list">
              {MOCK_SHARP_SETTLED_CALLS.map((c) => (
                <CallRow key={c.id} call={c} />
              ))}
            </ul>
          </section>
        )}

        <p className="sh-foot">
          <Link href="/leaderboard/polls" className="sh-foot-link">
            See the Putt-IQ leaderboard →
          </Link>
        </p>
      </div>
    </section>
  );
}
