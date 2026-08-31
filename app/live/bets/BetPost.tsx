"use client";

/**
 * BetPost — a synced bet from SharpSports rendered as a Pardle feed
 * post. Mirrors the design-handoff prototype's BetPost:
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ [av]  Tom is sweating              54% ▲ live  │
 *   │       just now · live                          │
 *   │ ┌──────────────────────────────────────────┐   │
 *   │ │ R. McIlroy  [WINNER]         £50 @ +2000 │   │
 *   │ └──────────────────────────────────────────┘   │
 *   │ ░▁▂▄▆▇ ●   (probability sparkline)             │
 *   │ ─────────────────────────────────────────────  │
 *   │ • Birdied 4th             tot −3  (up)         │
 *   │ • Sunday pins holding him at −3                │
 *   │ 👍 12   💬 3    [Tail]     6 on it              │
 *   └────────────────────────────────────────────────┘
 *
 * Class names track social-v2.css exactly (.bpost, .bp-head,
 * .bp-who, .bp-prob, .bp-bet, .bp-thread, .bp-upd, .bp-foot) — pv-
 * theme picks them up. Only the container element needs `pv-theme`
 * on an ancestor.
 *
 * The component is DUMB. Reactions, comments, tail — all wired to
 * callbacks the parent supplies (matching the pattern in
 * `LeaderRow.tsx` in v4). No data fetching here.
 */

import type { PardleBetSlip, PardleBetLeg } from "@/lib/sharpsports/types";
import {
  formatMarket,
  formatOddsAmerican,
  formatStake,
  formatAgo,
  formatSlipResult,
  shortenName,
  impliedProbability,
} from "@/lib/sharpsports/format";

/** Extra live-model context the caller can supply. All optional —
 *  when absent, the card falls back to the implied probability from
 *  the recorded odds and skips the sparkline. */
export interface BetPostLive {
  /** Current model win probability 0..1. Defaults to implied from
   *  recorded odds. */
  probability?: number;
  /** Trailing probability history for the sparkline (0..1 values,
   *  newest last). Rendered only when 2+ points are supplied. */
  probabilityHistory?: number[];
  /** Shot-level updates to render as the thread. Newest first. */
  updates?: BetPostUpdate[];
}

export interface BetPostUpdate {
  id: string;
  /** Body copy — "Birdie on 4", "Approach to 3ft on 8" etc. */
  text: string;
  /** Value stamp — "−3", "18ft", or empty. */
  value: string;
  /** Direction bucket driving the dot colour. */
  direction: "up" | "down" | "flat";
}

interface Props {
  slip: PardleBetSlip;
  live?: BetPostLive;
  /** Currency symbol to render — inferred from the sportsbook's
   *  region hint if you have one; defaults to USD. */
  currency?: "USD" | "GBP" | "EUR";
  /** Whose bet — controls the "Tom / You" copy. Left null when this
   *  is another user's bet in a shared feed context. */
  displayName?: string;
  /** Is the current viewer the bettor. */
  isMine?: boolean;
  /** Optional avatar initials — a rough shortcode ("TB" for
   *  "Tom Burgess"). Falls back to displayName's initials. */
  initials?: string;
  now?: number;
  onOpen?: (slipId: string) => void;
  onReact?: (slipId: string, kind: "up" | "down") => void;
  onComment?: (slipId: string) => void;
  onTail?: (slipId: string) => void;
  reactionCount?: number;
  commentCount?: number;
  showTail?: boolean;
}

export default function BetPost({
  slip,
  live,
  currency = "USD",
  displayName,
  isMine = false,
  initials,
  now = Date.now(),
  onOpen,
  onReact,
  onComment,
  onTail,
  reactionCount = 0,
  commentCount = 0,
  showTail = false,
}: Props) {
  const settled = slip.outcome !== "pending";
  const whoName = isMine ? "You" : (displayName ?? slip.book.name);
  const av = deriveInitials(initials ?? displayName ?? slip.book.name);
  const placedAtMs = Date.parse(slip.placedAt) || now;
  const ago = formatAgo(placedAtMs, now);

  // Header prob chip + direction — settled state re-labels to WON/LOST.
  const winProb = deriveProbability(slip, live);
  const priorProb = live?.probabilityHistory?.[0] ?? null;
  const dir: "up" | "down" =
    priorProb != null && winProb < priorProb ? "down" : "up";

  const stakeLabel = formatStake(slip.atRiskCents, currency);

  // For a settled slip we render a compact end-state variant. The
  // prototype uses `.bp-settled` + a WON/LOST chip in the prob slot.
  if (settled) {
    const result = formatSlipResult(slip);
    const isWin = slip.outcome === "win";
    return (
      <div
        className={`post bpost bp-settled${isWin ? "" : " down"}`}
        onClick={() => onOpen?.(slip.slipId)}
        role="article"
        style={{ cursor: onOpen ? "pointer" : "default" }}
      >
        <div className="bp-head">
          <Avatar initials={av} />
          <div className="bp-who">
            <div className="nm">
              {whoName}
              {isMine && <span className="fdot" />}
            </div>
            <div className="tm">Settled · tap to view</div>
          </div>
          <div className="bp-prob">
            <div className="v" style={{ color: settledColor(isWin) }}>
              {result.amount}
            </div>
            <div className="d" style={{ color: settledColor(isWin), fontWeight: 800 }}>
              {slip.outcome === "cashout"
                ? "CASHED"
                : isWin
                  ? "WON"
                  : slip.outcome === "push"
                    ? "PUSH"
                    : "LOST"}
            </div>
          </div>
        </div>
        {renderLegs(slip.golfLegs, currency, slip.slipOddsAmerican, stakeLabel)}
      </div>
    );
  }

  return (
    <div
      className={`post bpost${dir === "down" ? " down" : ""}`}
      role="article"
      onClick={() => onOpen?.(slip.slipId)}
      style={{ cursor: onOpen ? "pointer" : "default" }}
    >
      <div className="bp-head">
        <Avatar initials={av} />
        <div className="bp-who">
          <div className="nm">
            {whoName}
            {isMine && <span className="fdot" />}
            <span className="verb">is sweating</span>
          </div>
          <div className="tm">
            {ago} ago · live
          </div>
        </div>
        <div className="bp-prob">
          <div
            className="v"
            style={{ color: dir === "down" ? "var(--pv-down)" : "var(--pv-up)" }}
          >
            {Math.round(winProb * 100)}%
          </div>
          <div className={`d ${dir}`}>
            {dir === "up" ? "▲" : "▼"} live
          </div>
        </div>
      </div>

      {renderLegs(slip.golfLegs, currency, slip.slipOddsAmerican, stakeLabel)}

      {live?.probabilityHistory && live.probabilityHistory.length >= 2 && (
        <ProbSparkline hist={live.probabilityHistory} dir={dir} />
      )}

      {live?.updates && live.updates.length > 0 && (
        <div className="bp-thread">
          {live.updates.slice(0, 3).map((u, i) => (
            <div key={u.id} className={`bp-upd${i === 0 ? " new" : ""}`}>
              <span className={`ud ${u.direction}`} />
              <span className="ut">{u.text}</span>
              <span className={`uv ${u.direction}`}>{u.value || "—"}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bp-foot">
        <button
          type="button"
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            onReact?.(slip.slipId, "up");
          }}
          aria-label="React"
        >
          <ThumbUp />
          <span>{reactionCount}</span>
        </button>
        <button
          type="button"
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            onComment?.(slip.slipId);
          }}
          aria-label="Comments"
        >
          <CommentIcon />
          <span>{commentCount}</span>
        </button>
        {showTail && !isMine && (
          <button
            type="button"
            className="tailbtn"
            onClick={(e) => {
              e.stopPropagation();
              onTail?.(slip.slipId);
            }}
          >
            Tail
          </button>
        )}
        {slip.otherLegsCount > 0 && (
          <span className="who-on">
            <span className="lbl">
              +{slip.otherLegsCount} non-golf {slip.otherLegsCount === 1 ? "leg" : "legs"}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sub-components / helpers ───────────────────────────────────────

function renderLegs(
  legs: PardleBetLeg[],
  currency: "USD" | "GBP" | "EUR",
  slipOddsAmerican: number,
  stakeLabel: string,
) {
  if (legs.length === 0) return null;
  // Single leg: the prototype's compact `.bp-bet` row. Multi-leg
  // (parlay): stack the same row per leg but drop the stake off all
  // but the last row — stake is on the whole slip, not per leg.
  return (
    <div className="bp-legs">
      {legs.map((leg, i) => (
        <div className="bp-bet" key={leg.legId}>
          <span className="player">
            {leg.player ? leg.player.displayName : "—"}
          </span>
          <span className="mktchip">{formatMarket(leg.market)}</span>
          <span className="stake">
            {i === legs.length - 1
              ? `${stakeLabel} @ ${formatOddsAmerican(slipOddsAmerican)}`
              : formatOddsAmerican(leg.oddsAmerican)}
          </span>
        </div>
      ))}
    </div>
  );
}

function deriveProbability(
  slip: PardleBetSlip,
  live: BetPostLive | undefined,
): number {
  if (live?.probability != null && Number.isFinite(live.probability)) {
    return clamp01(live.probability);
  }
  return clamp01(impliedProbability(slip.slipOddsAmerican));
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function settledColor(isWin: boolean): string {
  return isWin ? "var(--pv-up)" : "var(--pv-down)";
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="av av-md" aria-hidden>
      {initials}
    </span>
  );
}

function ProbSparkline({
  hist,
  dir,
}: {
  hist: number[];
  dir: "up" | "down";
}) {
  const w = 300;
  const h = 32;
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const rng = Math.max(0.001, max - min);
  const pts = hist
    .map(
      (v, i) =>
        `${(i / (hist.length - 1)) * w},${
          h - ((v - min) / rng) * (h - 5) - 3
        }`,
    )
    .join(" ");
  const color = dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
  const lastY = h - ((hist[hist.length - 1] - min) / rng) * (h - 5) - 3;
  return (
    <div className="bp-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={w} cy={lastY} r="3.5" fill={color} />
      </svg>
    </div>
  );
}

function ThumbUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 22V11" />
      <path d="M17 22H7V11l6-9v0a2 2 0 0 1 2 2v6h5l-3 12z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-1 4 8.5 8.5 0 0 1-7.6 4.5 8.38 8.38 0 0 1-4-1L3 21l1-5a8.5 8.5 0 0 1 15-9.5 8.38 8.38 0 0 1 2 5z" />
    </svg>
  );
}
