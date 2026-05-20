"use client";

/**
 * /demo/polls — Putt prediction poll widget showcase. Every state
 * rendered side-by-side against the same row chrome the feed uses,
 * so we can eyeball the copy + visuals without waiting for Charles
 * Schwab.
 *
 * Each row mocks one PuttPoll scenario; the buttons are wired to a
 * local optimistic state so click-feedback works for screenshots.
 * No network, no auth.
 */

import { useState } from "react";
import PuttPollWidget, {
  type PuttPollServerState,
} from "@/app/live/PuttPollWidget";

interface Scenario {
  title: string;
  headline: string;
  emoji: string;
  meta: string;
  state: PuttPollServerState;
  /** Distance feeds the tour-baseline anchor line. */
  distanceFt?: number;
  /** Player name pulled from the headline for the SG sentence. */
  playerName?: string;
}

const SCENARIOS: Scenario[] = [
  {
    title: "Open · pre-vote (community hidden, baseline shown)",
    headline:
      "Joaquin Niemann has 18 ft for birdie on the 14th — will it drop?",
    emoji: "🎯",
    meta: "R3 · just now",
    distanceFt: 18,
    playerName: "Niemann",
    state: {
      counts: { yes: 92, no: 41 },
      closedAt: null,
      made: null,
      myVote: null,
      polledAtStroke: 2,
      playerPuttSg: 1.4,
    },
  },
  {
    title: "Open · post-vote · community revealed",
    headline:
      "Scottie Scheffler has 24 ft for birdie on the 17th — will it drop?",
    emoji: "🎯",
    meta: "R4 · 12s ago",
    distanceFt: 24,
    playerName: "Scheffler",
    state: {
      counts: { yes: 87, no: 49 },
      closedAt: null,
      made: null,
      myVote: "yes",
      polledAtStroke: 2,
      playerPuttSg: 0.8,
    },
  },
  {
    title: "Open · you voted no, cold putter",
    headline:
      "Justin Thomas has 38 ft for par save on the 7th — will it drop?",
    emoji: "🎯",
    meta: "R2 · 22s ago",
    distanceFt: 38,
    playerName: "Thomas",
    state: {
      counts: { yes: 14, no: 71 },
      closedAt: null,
      made: null,
      myVote: "no",
      polledAtStroke: 4,
      playerPuttSg: -1.2,
    },
  },
  {
    title: "Closed · made, you called yes",
    headline:
      "Rory McIlroy has 14 ft for birdie on the 12th — will it drop?",
    emoji: "🎯",
    meta: "R3 · 1m ago",
    state: {
      counts: { yes: 78, no: 41 },
      closedAt: Date.now(),
      made: true,
      myVote: "yes",
      polledAtStroke: 2,
    },
  },
  {
    title: "Closed · made, you called no",
    headline:
      "Hideki Matsuyama has 28 ft for birdie on the 6th — will it drop?",
    emoji: "🎯",
    meta: "R2 · 3m ago",
    state: {
      counts: { yes: 35, no: 92 },
      closedAt: Date.now(),
      made: true,
      myVote: "no",
      polledAtStroke: 2,
    },
  },
  {
    title: "Closed · missed, you called yes",
    headline:
      "Patrick Cantlay has 21 ft for birdie on the 9th — will it drop?",
    emoji: "🎯",
    meta: "R3 · 2m ago",
    state: {
      counts: { yes: 64, no: 38 },
      closedAt: Date.now(),
      made: false,
      myVote: "yes",
      polledAtStroke: 2,
    },
  },
  {
    title: "Closed · missed, you called no",
    headline:
      "Wyndham Clark has 33 ft for eagle on the 18th — will it drop?",
    emoji: "🎯",
    meta: "R4 · 4m ago",
    state: {
      counts: { yes: 19, no: 88 },
      closedAt: Date.now(),
      made: false,
      myVote: "no",
      polledAtStroke: 2,
    },
  },
  {
    title: "Closed · crowd was wrong (said yes, missed)",
    headline:
      "Sahith Theegala has 26 ft for birdie on the 8th — will it drop?",
    emoji: "🎯",
    meta: "R3 · 1m ago",
    state: {
      counts: { yes: 81, no: 18 },
      closedAt: Date.now(),
      made: false,
      myVote: "no",
      polledAtStroke: 2,
      crowdWasWrong: true,
    },
  },
  {
    title: "Closed · crowd was wrong (said no, dropped)",
    headline:
      "Min Woo Lee has 34 ft for eagle on the 15th — will it drop?",
    emoji: "🎯",
    meta: "R4 · 30s ago",
    state: {
      counts: { yes: 12, no: 67 },
      closedAt: Date.now(),
      made: true,
      myVote: "yes",
      polledAtStroke: 2,
      crowdWasWrong: true,
    },
  },
  {
    title: "Closed · you didn't vote",
    headline:
      "Brian Harman has 16 ft for birdie on the 4th — will it drop?",
    emoji: "🎯",
    meta: "R1 · 6m ago",
    state: {
      counts: { yes: 45, no: 28 },
      closedAt: Date.now(),
      made: true,
      myVote: null,
      polledAtStroke: 2,
    },
  },
];

function Row({ scenario, index }: { scenario: Scenario; index: number }) {
  // Local optimistic state so click feedback works in the demo.
  const [optimisticVote, setOptimisticVote] = useState<
    "yes" | "no" | undefined
  >(undefined);
  const [optimisticCounts, setOptimisticCounts] = useState<
    { yes: number; no: number } | undefined
  >(undefined);

  function handleVote(v: "yes" | "no") {
    const base =
      optimisticCounts ?? scenario.state.counts;
    const prev = optimisticVote ?? scenario.state.myVote ?? null;
    if (prev === v) return;
    const c = { ...base };
    if (prev === "yes") c.yes = Math.max(0, c.yes - 1);
    if (prev === "no") c.no = Math.max(0, c.no - 1);
    c[v] += 1;
    setOptimisticVote(v);
    setOptimisticCounts(c);
  }

  const pollId = `demo-${index}`;
  return (
    <li className="feed-row-wrap">
      <div className="feed-row feed-row-shot feed-row-shot-good">
        <span className="feed-emoji" aria-hidden="true">
          {scenario.emoji}
        </span>
        <div className="feed-body">
          <p className="feed-headline">{scenario.headline}</p>
          <p className="feed-meta">{scenario.meta}</p>
        </div>
        <PuttPollWidget
          pollId={pollId}
          puttDistanceFt={scenario.distanceFt}
          playerName={scenario.playerName}
          serverState={scenario.state}
          optimisticVote={optimisticVote}
          optimisticCounts={optimisticCounts}
          onVote={handleVote}
        />
      </div>
    </li>
  );
}

export default function PollsDemoPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 60px" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>
        Putt poll · widget showcase
      </h1>
      <p style={{ margin: "0 0 24px", color: "var(--muted)", fontSize: 13 }}>
        Every visible state of the putt-prediction poll, rendered in the
        feed-row chrome it actually uses. Vote buttons are wired to local
        optimistic state — click them, you&apos;ll see the feedback. No
        network calls. Throwaway route — delete after Charles Schwab.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {SCENARIOS.map((s, i) => (
          <section key={i}>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 13,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--muted)",
              }}
            >
              {s.title}
            </h2>
            <ul className="feed-list" style={{ listStyle: "none", padding: 0 }}>
              <Row scenario={s} index={i} />
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
