"use client";

/**
 * /demo/shot-aware — dev-only preview of the shot-aware round-score
 * bet model. Renders a real BetPost card + real ShotPost rows wired
 * to the actual model code (currentProbForBet from bet-shared). No
 * mocks — the numbers you see are what a real user sees on Thursday.
 *
 * A "Next shot" button walks through a scripted par-4 sequence
 * (tee → approach → putt → holed) so you can watch the % on the
 * BetPost card and the impact chip on each ShotPost move in real
 * time — before we have a live tournament to test against.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import BetPost from "@/app/live/BetPost";
import ShotPost from "@/app/live/ShotPost";
import {
  currentProbForBet,
  type PlayerRoundState,
  type RoundScoreBet,
  type RoundSnapshot,
} from "@/app/live/bet-shared";
import { headlineImpactForEvent } from "@/app/live/bet-impact";
import type { FeedRow, FeedEvent, ReactionCounts } from "@/lib/feed/types";

const PLAYER_ID = "demo-1";
const PLAYER_NAME = "Demo Player";
const ROUND = 1;
const T = 1_720_000_000_000;
const REACTIONS: ReactionCounts = { up: 0, down: 0 };

function row(ev: Partial<FeedEvent> & { id: string }): FeedRow {
  return {
    event: {
      tournamentId: "T",
      ts: T,
      type: "shot",
      playerId: PLAYER_ID,
      playerName: PLAYER_NAME,
      round: ROUND,
      headline: "",
      emoji: "",
      ...ev,
    } as FeedEvent,
    reactions: REACTIONS,
    commentCount: 0,
  };
}

function scoreRow(hole: number, par: number, strokes: number): FeedRow {
  return row({
    id: `score-${hole}`,
    type: "score",
    hole,
    par,
    strokes,
    ts: T + hole,
  });
}

function shotRow(opts: {
  hole: number;
  par: number;
  shotNum: number;
  surface: string;
  toPin: string;
  headline: string;
  ts: number;
}): FeedRow {
  return row({
    id: `shot-${opts.hole}-${opts.shotNum}`,
    type: "shot",
    imgSourced: true,
    hole: opts.hole,
    par: opts.par,
    imgShotNum: opts.shotNum,
    imgSurface: opts.surface,
    imgToPin: opts.toPin,
    headline: opts.headline,
    ts: opts.ts,
  });
}

const COMPLETED_ROWS: FeedRow[] = [
  scoreRow(1, 4, 4),
  scoreRow(2, 4, 3),
  scoreRow(3, 4, 4),
  scoreRow(4, 3, 3),
  scoreRow(5, 5, 4),
  scoreRow(6, 4, 4),
  scoreRow(7, 4, 4),
  scoreRow(8, 3, 2),
  scoreRow(9, 4, 4),
  scoreRow(10, 5, 4),
  scoreRow(11, 4, 4),
  scoreRow(12, 3, 4),
];

const H = 13;
const PAR = 4;
const t = (n: number) => T + 1_000 + n;

interface ShotStep {
  label: string;
  shot: FeedRow;
}

const GOOD_SEQUENCE: ShotStep[] = [
  {
    label: "Tee shot → fairway, 155 yds",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 1,
      surface: "Fairway",
      toPin: "155yds",
      headline: `${PLAYER_NAME} finds the fairway on 13`,
      ts: t(1),
    }),
  },
  {
    label: "Approach → green, 22 ft",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 2,
      surface: "Green",
      toPin: "22ft. 0in.",
      headline: `${PLAYER_NAME} finds the green — 22 ft for birdie`,
      ts: t(2),
    }),
  },
  {
    label: "Lag putt → 2 ft",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 3,
      surface: "Green",
      toPin: "2ft. 0in.",
      headline: `${PLAYER_NAME} lags to 2 feet`,
      ts: t(3),
    }),
  },
  {
    label: "Tap-in for par",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 4,
      surface: "Ball Holed",
      toPin: "0ft. 0in.",
      headline: `${PLAYER_NAME} taps in for par on 13`,
      ts: t(4),
    }),
  },
];

const BAD_SEQUENCE: ShotStep[] = [
  {
    label: "Tee shot → deep rough, 180 yds",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 1,
      surface: "Deep Rough",
      toPin: "180yds",
      headline: `${PLAYER_NAME} pulled it — deep rough off the tee`,
      ts: t(1),
    }),
  },
  {
    label: "Bail-out → bunker, 35 yds",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 2,
      surface: "Bunker",
      toPin: "35yds",
      headline: `${PLAYER_NAME} lays up into greenside sand`,
      ts: t(2),
    }),
  },
  {
    label: "Splash out → green, 12 ft",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 3,
      surface: "Green",
      toPin: "12ft. 0in.",
      headline: `${PLAYER_NAME} splashes out to 12 ft`,
      ts: t(3),
    }),
  },
  {
    label: "First putt → 1 ft (bogey coming)",
    shot: shotRow({
      hole: H,
      par: PAR,
      shotNum: 4,
      surface: "Green",
      toPin: "1ft. 0in.",
      headline: `${PLAYER_NAME} misses — tap in for bogey`,
      ts: t(4),
    }),
  },
];

function makeSnap(): RoundSnapshot {
  return {
    holesPlayed: 12,
    holesRemaining: 6,
    strokes: 44,
    parPlayed: 46,
    parRemaining: 26,
    roundPar: 72,
    toPar: -2,
    status: "in-progress",
    expectedRemaining: 26.4,
    variance: 6 * 0.9,
  };
}

function makeState(): PlayerRoundState {
  const rs = makeSnap();
  return {
    currentRound: ROUND,
    holesPlayed: rs.holesPlayed,
    holesRemaining: rs.holesRemaining,
    strokes: rs.strokes,
    parPlayed: rs.parPlayed,
    parRemaining: rs.parRemaining,
    roundPar: rs.roundPar,
    toPar: rs.toPar,
    ttdPacePerHole: 0,
    ttdHoles: 24,
    rounds: { [ROUND]: rs },
  };
}

const BET: RoundScoreBet = {
  id: "demo-bet-1",
  kind: "round-score",
  playerId: PLAYER_ID,
  playerName: PLAYER_NAME,
  round: ROUND,
  line: 69.5,
  side: "under",
  oddsTaken: 2.0,
  oddsTakenLabel: "2.00",
  stake: 10,
  placedAt: T,
  currency: "GBP",
  placement: {
    holesPlayed: 12,
    strokes: 44,
    parPlayed: 46,
    roundPar: 72,
    ttdPacePerHole: 0,
    probAtPlacement: 0.35,
    round: ROUND,
  },
};

interface TrajectoryPoint {
  step: number;
  label: string;
  prob: number;
}

function computeTrajectory(
  sequence: ShotStep[],
  states: Record<string, PlayerRoundState>,
): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let i = 0; i <= sequence.length; i++) {
    const shots = sequence.slice(0, i).map((s) => s.shot);
    const rows = [...COMPLETED_ROWS, ...shots];
    const prob = currentProbForBet(BET, states, rows) ?? 0;
    const label = i === 0 ? "baseline" : sequence[i - 1].label;
    points.push({ step: i, label, prob });
  }
  return points;
}

interface ChartProps {
  points: TrajectoryPoint[];
  currentStep: number;
}

function ProbChart({ points, currentStep }: ChartProps) {
  const w = 560;
  const h = 220;
  const padL = 42;
  const padR = 18;
  const padT = 16;
  const padB = 40;
  const iw = w - padL - padR;
  const ih = h - padT - padB;

  const xFor = (step: number) =>
    padL + (points.length <= 1 ? 0 : (step / (points.length - 1)) * iw);
  const yFor = (prob: number) => padT + (1 - prob) * ih;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.step)} ${yFor(p.prob)}`)
    .join(" ");

  const current = points[currentStep];
  const trendUp = currentStep > 0 && current.prob >= points[currentStep - 1].prob;
  const areaColor = trendUp ? "#10b981" : "#ef4444";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        background: "var(--pv-card, #fff)",
        border: "1px solid var(--pv-line, #e5e5e5)",
        borderRadius: 8,
      }}
    >
      {/* Y-axis grid + labels at 0/25/50/75/100 */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={padL}
            x2={w - padR}
            y1={yFor(v)}
            y2={yFor(v)}
            stroke={v === 0.5 ? "#cbd5e1" : "#eef0f2"}
            strokeDasharray={v === 0.5 ? "4 3" : undefined}
            strokeWidth={1}
          />
          <text
            x={padL - 6}
            y={yFor(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill="#94a3b8"
            fontFamily="var(--font-mono, monospace)"
          >
            {(v * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {/* Trajectory line */}
      <path
        d={pathD}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Point markers */}
      {points.map((p) => {
        const isCurrent = p.step === currentStep;
        const isPast = p.step < currentStep;
        return (
          <circle
            key={p.step}
            cx={xFor(p.step)}
            cy={yFor(p.prob)}
            r={isCurrent ? 8 : 4}
            fill={isCurrent ? areaColor : isPast ? "#334155" : "#e2e8f0"}
            stroke={isCurrent ? "white" : "none"}
            strokeWidth={2}
          />
        );
      })}

      {/* Current-step label + prob */}
      <text
        x={xFor(current.step)}
        y={Math.max(padT + 8, yFor(current.prob) - 14)}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill={areaColor}
        fontFamily="var(--font-mono, monospace)"
      >
        {(current.prob * 100).toFixed(1)}%
      </text>

      {/* X-axis step labels — abbreviate */}
      {points.map((p, i) => {
        if (i !== 0 && i !== points.length - 1 && i !== currentStep) return null;
        const label = p.label.length > 14 ? p.label.slice(0, 12) + "…" : p.label;
        return (
          <text
            key={`xl-${p.step}`}
            x={xFor(p.step)}
            y={h - padB + 16}
            textAnchor={
              i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
            }
            fontSize={11}
            fill="#64748b"
          >
            {label}
          </text>
        );
      })}

      {/* Step counter (bottom-left) */}
      <text
        x={padL}
        y={h - 6}
        fontSize={11}
        fill="#94a3b8"
        fontFamily="var(--font-mono, monospace)"
      >
        shot {currentStep} of {points.length - 1}
      </text>
    </svg>
  );
}

export default function ShotAwareDemoPage() {
  const [flavour, setFlavour] = useState<"good" | "bad">("good");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const sequence = flavour === "good" ? GOOD_SEQUENCE : BAD_SEQUENCE;
  const playerRoundStates = useMemo(() => ({ [PLAYER_ID]: makeState() }), []);

  const contextRows = useMemo(() => {
    const shots = sequence.slice(0, step).map((s) => s.shot);
    return [...COMPLETED_ROWS, ...shots];
  }, [sequence, step]);

  const trajectory = useMemo(
    () => computeTrajectory(sequence, playerRoundStates),
    [sequence, playerRoundStates],
  );

  const shotsSoFar = sequence.slice(0, step);

  // Auto-play — advance one shot every 1.5s until end.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (!playing) return;
    if (step >= sequence.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => {
      if (playingRef.current) setStep((s) => Math.min(sequence.length, s + 1));
    }, 1500);
    return () => clearTimeout(id);
  }, [playing, step, sequence.length]);

  return (
    <main
      className="container v4-theme pv-theme"
      style={{ padding: "1rem", maxWidth: 640 }}
    >
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>
        Shot-aware round-score demo
      </h1>
      <p style={{ fontSize: "0.85rem", color: "var(--pv-muted)", marginBottom: "1rem" }}>
        Bet: <strong>UNDER 69.5</strong> on {PLAYER_NAME} · staked £10 at 2.00 ·
        currently mid-round after 12 holes at 44 strokes.
        Watch the <strong>%</strong> on the bet card + the chip on each shot row
        move as the sequence advances.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => {
            setFlavour("good");
            setStep(0);
          }}
          style={{
            padding: "0.4rem 0.8rem",
            background: flavour === "good" ? "var(--pv-ink)" : "transparent",
            color: flavour === "good" ? "var(--pv-bg)" : "var(--pv-ink)",
            border: "1px solid var(--pv-ink)",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Good sequence
        </button>
        <button
          type="button"
          onClick={() => {
            setFlavour("bad");
            setStep(0);
          }}
          style={{
            padding: "0.4rem 0.8rem",
            background: flavour === "bad" ? "var(--pv-ink)" : "transparent",
            color: flavour === "bad" ? "var(--pv-bg)" : "var(--pv-ink)",
            border: "1px solid var(--pv-ink)",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Bad sequence
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => setStep(0)}
          disabled={step === 0}
          style={{
            padding: "0.4rem 0.8rem",
            border: "1px solid var(--pv-line)",
            borderRadius: 6,
            background: "transparent",
            cursor: step === 0 ? "not-allowed" : "pointer",
            opacity: step === 0 ? 0.4 : 1,
          }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(sequence.length, s + 1))}
          disabled={step >= sequence.length}
          style={{
            padding: "0.4rem 0.8rem",
            background: "var(--pv-emerald, #059669)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            cursor: step >= sequence.length ? "not-allowed" : "pointer",
            opacity: step >= sequence.length ? 0.4 : 1,
          }}
        >
          Next shot ({step}/{sequence.length})
        </button>
        <button
          type="button"
          onClick={() => {
            if (step >= sequence.length) setStep(0);
            setPlaying((p) => !p);
          }}
          style={{
            padding: "0.4rem 0.8rem",
            background: playing ? "#ef4444" : "#0284c7",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {playing ? "Pause" : "Auto-play"}
        </button>
      </div>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", color: "var(--pv-muted)" }}>
          Win-probability trajectory
        </h2>
        <ProbChart points={trajectory} currentStep={step} />
        <p style={{ fontSize: "0.75rem", color: "var(--pv-muted)", marginTop: 4 }}>
          Marker shows the bet&apos;s implied win probability at each shot.
          Line shows the full sequence — every point is a fresh
          `currentProbForBet` call against the real model.
        </p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", color: "var(--pv-muted)" }}>
          Your bet card
        </h2>
        <BetPost
          bet={BET}
          currentOdds={{}}
          topFinishCurrent={{}}
          playerRoundStates={playerRoundStates}
          contextRows={contextRows}
          recentRowsForPlayer={shotsSoFar.slice(-3).map((s) => s.shot).reverse()}
        />
      </section>

      <section>
        <h2 style={{ fontSize: "0.9rem", marginBottom: "0.5rem", color: "var(--pv-muted)" }}>
          Shot feed ({shotsSoFar.length} shots played on hole 13)
        </h2>
        {shotsSoFar.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--pv-muted)" }}>
            Press <strong>Next shot</strong> to begin the sequence.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {shotsSoFar
              .slice()
              .reverse()
              .map((s, i) => {
                const idx = shotsSoFar.length - i;
                const priorRows = [
                  ...COMPLETED_ROWS,
                  ...sequence.slice(0, idx - 1).map((x) => x.shot),
                ];
                const impact = headlineImpactForEvent(
                  s.shot.event,
                  [BET],
                  {
                    currentOdds: {},
                    leaderboard: [],
                    contextRows: priorRows,
                  },
                );
                return (
                  <li key={s.shot.event.id}>
                    <ShotPost
                      event={s.shot.event}
                      commentCount={0}
                      impact={impact}
                    />
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </main>
  );
}
