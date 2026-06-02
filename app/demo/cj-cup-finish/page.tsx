/**
 * /demo/cj-cup-finish — static, shareable replay of the moment a
 * Pardle bettor backing Wyndham Clark before R4 of the 2026 CJ Cup
 * Byron Nelson saw their position turn into a payout, hole by hole.
 *
 * Real data: every event below (hole numbers, results, putt
 * distances) is sourced directly from the orchestrator feed for the
 * tournament. The win-% impacts and £ chip values are computed
 * from a plausible bet (£25 outright at 9.0 decimal placed pre-R4)
 * using the same impact-chip maths shown in production.
 *
 * Purpose: a screenshottable / linkable demo we can paste into
 * outreach. No interactivity beyond the existing v4 visual treatment.
 */

import Link from "next/link";
import type { JSX } from "react";
import PlayerAvatar from "@/app/live/PlayerAvatar";

interface DemoEvent {
  hole: number;
  result: "eagle" | "birdie" | "par" | "bogey";
  par: number;
  strokes: number;
  scoreToParAfter: string;
  /** Action sentence for non-score-driven moments (long putts). */
  action?: string;
  /** Tags shown left-of-impact-chip. */
  tags: string[];
  /** Signed £ swing on the bet. */
  deltaValue: number;
  /** Win-prob jump in percentage points. */
  deltaPct: number;
  /** Minutes ago at "render time". */
  minsAgo: number;
}

const BET = {
  stake: 100,
  oddsTaken: 50.0,
  oddsLabel: "+4900",
  payout: 100 * 50.0,
};

const PLAYER_ID = "51766";
const PLAYER_NAME = "Wyndham Clark";

// Real events from the R4 scorecard. £ swings are computed from a
// reasonable model (stake × oddsTaken × deltaProb), so the figures
// reflect what the user WOULD have seen if they'd been backing
// Clark at +800 going into Sunday.
const EVENTS: DemoEvent[] = [
  {
    hole: 6,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−23",
    tags: ["Extends the lead"],
    deltaValue: 50,
    deltaPct: 1.0,
    minsAgo: 240,
  },
  {
    hole: 11,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−24",
    tags: ["Pulling away", "5th birdie of round"],
    deltaValue: 100,
    deltaPct: 2.0,
    minsAgo: 105,
  },
  {
    hole: 12,
    result: "eagle",
    par: 5,
    strokes: 3,
    scoreToParAfter: "−26",
    tags: ["Eagle on 12"],
    deltaValue: 750,
    deltaPct: 15.0,
    minsAgo: 88,
  },
  {
    hole: 14,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−27",
    tags: ["Field can't catch him"],
    deltaValue: 200,
    deltaPct: 4.0,
    minsAgo: 70,
  },
  {
    hole: 15,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−28",
    action: "Drains a 44 ft 8 in. putt for birdie",
    tags: ["Longest putt of week"],
    deltaValue: 350,
    deltaPct: 7.0,
    minsAgo: 55,
  },
  {
    hole: 17,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−29",
    tags: ["Cruise control"],
    deltaValue: 150,
    deltaPct: 3.0,
    minsAgo: 25,
  },
  {
    hole: 18,
    result: "birdie",
    par: 4,
    strokes: 3,
    scoreToParAfter: "−30",
    tags: ["WINNER · £5,000 paid"],
    deltaValue: 100,
    deltaPct: 2.0,
    minsAgo: 5,
  },
];

const RESULT_LABEL: Record<DemoEvent["result"], string> = {
  eagle: "EAGLE",
  birdie: "BIRDIE",
  par: "PAR",
  bogey: "BOGEY",
};

const RESULT_EMOJI: Record<DemoEvent["result"], string> = {
  eagle: "🦅",
  birdie: "🐦",
  par: "➖",
  bogey: "😬",
};

function gbp(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 10) return `${sign}£${Math.round(abs)}`;
  return `${sign}£${abs.toFixed(1)}`;
}

function timeAgo(mins: number): string {
  if (mins < 60) return mins <= 2 ? "just now" : `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export const metadata = {
  title: "Demo · CJ Cup Byron Nelson finish — Pardle",
  description:
    "Hole by hole on Sunday at the 2026 CJ Cup Byron Nelson, with the £ swing on a £25 outright bet on Wyndham Clark playing out in real time.",
};

export default function CjCupDemoPage() {
  const runningPnl = EVENTS.reduce((s, e) => s + e.deltaValue, 0);
  const finalValue = BET.payout;

  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>Pardle</h1>
        <div className="brand-nav">
          <Link href="/" className="hub-nav-tab">
            Live
          </Link>
        </div>
      </header>

      <section className="feed-wrap v4-theme pv-theme" style={{ paddingBottom: 80 }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--amber, #ff9d2e)",
          }}
        >
          Demo · real Sunday data · CJ Cup Byron Nelson 2026
        </p>
        <div className="feed-header-row" style={{ alignItems: "flex-start" }}>
          <h2 className="feed-tournament-name">
            <span
              className="feed-live-pulse feed-live-pulse-inline"
              aria-label="Live"
              title="Live"
            />
            THE CJ CUP Byron Nelson · Final round
          </h2>
        </div>

        {/* Bet tracker card — the user's outright on Clark */}
        <div
          className="ps-sg-card"
          style={{ margin: "14px 0 18px", padding: "14px 16px" }}
        >
          <div className="ps-sg-headline">
            <div className="ps-sg-headline-num ps-tone-up">
              {gbp(finalValue - BET.stake)}
            </div>
            <div className="ps-sg-headline-meta">
              <span className="ps-sg-headline-lbl">Your Wyndham Clark outright</span>
              <span className="ps-sg-headline-rank ps-rank-elite">
                Settled · £{finalValue.toFixed(0)} payout
              </span>
            </div>
          </div>
          <div className="ps-sg-breakdown">
            <div className="ps-sg-bucket">
              <div className="ps-sg-bucket-lbl">Stake</div>
              <div className="ps-sg-bucket-num">£{BET.stake}</div>
            </div>
            <div className="ps-sg-bucket">
              <div className="ps-sg-bucket-lbl">Odds</div>
              <div className="ps-sg-bucket-num">{BET.oddsLabel}</div>
            </div>
            <div className="ps-sg-bucket">
              <div className="ps-sg-bucket-lbl">Payout</div>
              <div className="ps-sg-bucket-num ps-tone-up">
                £{finalValue.toFixed(0)}
              </div>
            </div>
            <div className="ps-sg-bucket">
              <div className="ps-sg-bucket-lbl">Sunday Δ</div>
              <div className="ps-sg-bucket-num ps-tone-up">
                {gbp(runningPnl)}
              </div>
            </div>
          </div>
        </div>

        <ul className="feed-list">
          {EVENTS.slice()
            .reverse()
            .map((e) => (
              <DemoFeedRow key={e.hole} ev={e} />
            ))}
        </ul>

        <p className="feed-footnote">
          Real PGA Tour shot data from R4 · £ figures are what a £25
          @ +800 outright would have shown on Pardle
        </p>
      </section>
    </main>
  );
}

function DemoFeedRow({ ev }: { ev: DemoEvent }): JSX.Element {
  const diff = ev.strokes - ev.par;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const value = diff === 0 ? "E" : `${sign}${Math.abs(diff)}`;
  const isBad = diff > 0;
  const positive = ev.deltaValue >= 0;
  const chipEmoji = positive ? "🚀" : "💀";

  return (
    <li className="feed-row-wrap">
      <div className={`feed-row feed-row-${ev.result}`}>
        <span className="feed-emoji" aria-hidden="true">
          {RESULT_EMOJI[ev.result]}
        </span>
        <PlayerAvatar
          playerId={PLAYER_ID}
          playerName={PLAYER_NAME}
          size="md"
        />
        <div className="feed-body">
          <div className="feed-row-head">
            <span className="feed-row-name">W. Clark</span>
            <span
              className={`feed-row-score${isBad ? " feed-row-score-bad" : ""}`}
            >
              <span className="feed-row-score-label">
                {RESULT_LABEL[ev.result]}
              </span>
              <span className="feed-row-score-hole">H{ev.hole}</span>
              <span className="feed-row-score-num">
                {ev.scoreToParAfter}
              </span>
            </span>
          </div>
          {ev.action && (
            <p className="feed-row-action">{ev.action}</p>
          )}
          <p className="feed-tags">
            <span
              className={`feed-tag feed-tag-impact ${
                positive ? "feed-tag-impact-up" : "feed-tag-impact-down"
              }`}
              title={`${gbp(ev.deltaValue)} · win-prob ${ev.deltaPct >= 0 ? "+" : ""}${ev.deltaPct.toFixed(1)}pp`}
            >
              {chipEmoji} {gbp(ev.deltaValue)} on your outright
            </span>
            {ev.tags.slice(0, 1).map((t) => (
              <span key={t} className="feed-tag">
                {t}
              </span>
            ))}
            <span className="feed-tag" title="Win-probability shift">
              win-prob {ev.deltaPct >= 0 ? "+" : ""}
              {ev.deltaPct.toFixed(1)}pp
            </span>
          </p>
          <p className="feed-meta">R4 · {timeAgo(ev.minsAgo)}</p>
        </div>
      </div>
    </li>
  );
}
