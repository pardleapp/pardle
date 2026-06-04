"use client";

/**
 * BetDetailClient — interactive bet-detail surface. Matches the
 * design-handoff prototype's <BetDetail> overlay 1:1:
 *
 *   ← Your bet · R. Henley · OUTRIGHT WIN · £50
 *
 *         54%
 *         ▲ live win probability
 *      ────────────────────
 *      ░░░░░▁▂▃▅▆▇ (area chart, dashed entry marker)
 *      entry                                    now
 *      Today's trajectory · dashed line marks entry
 *
 *   SHOT BY SHOT
 *     · Birdie 15 → −10            +4
 *     · Par 16                     +1
 *     · Approach 17 to 3 ft        +5
 *
 *   ON THIS BET · 2 tailing
 *     [MI][TH] 2 from your crew tailed this
 *
 *     [comment thread + input]
 *
 *   ──────────────────────────────────
 *   [Share to group]    [Tailed ✓ / Tail]
 *
 * Mock data only for this first cut.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/_components/BackButton";
import { hapticTap } from "@/lib/haptic";
import type { MockBetLive } from "../mock-bets";

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  PA: "linear-gradient(135deg,#a070ff,#3b1f8a)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function MiniAv({
  initials,
  size = 28,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <span
      className="crew-mini-av"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: bgFor(initials),
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function AreaChart({
  hist,
  dir,
}: {
  hist: number[];
  dir: "up" | "down";
}) {
  if (hist.length < 2) return null;
  const w = 320;
  const h = 148;
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const rng = Math.max(0.001, max - min);
  const xy = hist.map((v, i) => [
    (i / (hist.length - 1)) * w,
    h - ((v - min) / rng) * (h - 26) - 14,
  ]);
  const line = xy.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const color = dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
  return (
    <div className="bd-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="bdgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#bdgrad)" />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Entry marker — dashed vertical at the first sample. */}
        <line
          x1={xy[0][0]}
          y1="0"
          x2={xy[0][0]}
          y2={h}
          stroke="var(--pv-muted)"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

interface Comment {
  author: string;
  initials: string;
  sharp?: string;
  text: string;
}

// Demo comments — invented Jordan/Mia/Theo/Sam etc. Real bet-comment
// wiring (Supabase + RLS) is a follow-up. Outside ?demo=1 the comment
// thread renders empty so we don't show fake crew chatter under a
// user's real bet during a live tournament.
const MOCK_COMMENTS_BY_BET: Record<string, Comment[]> = {};

export default function BetDetailClient({
  bet,
  backFallback = "/bets",
  backAriaLabel = "Back to My bets",
}: {
  bet: MockBetLive;
  backFallback?: string;
  backAriaLabel?: string;
}) {
  // Apply pv-theme-body so the page bg matches the rest of the
  // redesigned surfaces.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  const probColor =
    bet.dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
  const [comments, setComments] = useState<Comment[]>(
    MOCK_COMMENTS_BY_BET[bet.id] ?? [],
  );
  const [input, setInput] = useState("");
  const [shared, setShared] = useState(false);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    hapticTap();
    setComments((list) => [
      ...list,
      { author: "You", initials: "YO", text },
    ]);
    setInput("");
  };

  // `mine:false` flags this as a group-market view (opened from the
  // Groups tab's "Most backed in your group" row, not from My-bets).
  // We re-skin a few labels accordingly:
  //   header eyebrow: "Group market" instead of "Your bet"
  //   tailers heading + lede: "{N} on this market" instead of
  //                           "{N} tailing / {N} from your crew tailed"
  //   chart caption: drop the "where you entered" phrasing
  //   footer: "Discuss" + "Tail this market" instead of
  //           "Share to group" + (hidden tail).
  const isGroupView = bet.mine === false;
  const headerEyebrow = isGroupView ? "Group market" : "Your bet";
  const chartNote = isGroupView
    ? "Today's trajectory · live win probability for the group's market"
    : "Today's trajectory · dashed line marks where you entered";
  const tailingHeading = isGroupView
    ? `${bet.on.length} on this market`
    : `${bet.on.length} tailing`;
  const tailersLede = isGroupView
    ? `${bet.on.length} from The Lads on this market`
    : `${bet.on.length} from your crew tailed this`;
  const playerHref = `/live/player/${encodeURIComponent(bet.who)}`;

  return (
    <div className="bd-pv">
      <div className="bd-pv-head">
        <BackButton
          fallback={backFallback}
          className="bd-pv-back"
          ariaLabel={backAriaLabel}
        />
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">{headerEyebrow}</div>
          <div className="bd-pv-title-mk">
            <Link href={playerHref} className="bd-pv-title-player">
              {bet.who}
            </Link>{" "}
            · {bet.mkt}
            {!isGroupView && (
              <>
                {" "}
                · {bet.cur}
                {bet.stake}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bd-pv-body">
        <div className="bd-hero">
          <div className="bd-hero-big" style={{ color: probColor }}>
            {bet.prob}%
          </div>
          <div className="bd-hero-dd" style={{ color: probColor }}>
            {bet.dir === "up" ? "▲" : "▼"} live win probability
          </div>
        </div>
        <AreaChart hist={bet.hist} dir={bet.dir} />
        <div className="bd-chart-x">
          <span>{isGroupView ? "R1" : "entry"}</span>
          <span>now</span>
        </div>
        <p className="bd-chart-note">{chartNote}</p>

        <section className="bd-sec">
          <h4 className="bd-sec-h">Shot by shot</h4>
          <div className="bp-thread" style={{ borderTop: "none", paddingTop: 0 }}>
            {bet.tl.map((u, i) => (
              <div className="bp-upd" key={i}>
                <span className={`bp-upd-dot ${u[2]}`} />
                <span className="bp-upd-text">{u[0]}</span>
                <span className={`bp-upd-val ${u[2]}`}>
                  {u[1] === "0" ? "—" : u[1]}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">
            {isGroupView ? "Group on this market" : "On this bet"} ·{" "}
            {tailingHeading}
          </h4>
          {bet.on.length > 0 && (
            <div className="bd-tailers">
              <span className="bd-tailers-av-row">
                {bet.on.map((init) => (
                  <MiniAv key={init} initials={init} size={28} />
                ))}
              </span>
              <span className="bd-tailers-lbl">{tailersLede}</span>
            </div>
          )}
          <ul className="bd-comments">
            {comments.map((c, i) => (
              <li key={i} className="bd-comment">
                <MiniAv initials={c.initials} size={26} />
                <div className="bd-comment-bd">
                  <span className="bd-comment-au">{c.author}</span>
                  {c.sharp && (
                    <span className="bd-comment-sharp">{c.sharp}</span>
                  )}
                  {c.text}
                </div>
              </li>
            ))}
          </ul>
          <form
            className="bd-comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Comment on this bet…"
              aria-label="Comment on this bet"
            />
            <button type="submit" className="bd-comment-send" aria-label="Send">
              ↑
            </button>
          </form>
        </section>
      </div>

      <div className="bd-pv-foot">
        <button
          type="button"
          className={`bd-pv-share${shared ? " bd-pv-share-done" : ""}`}
          onClick={() => setShared(true)}
        >
          {shared
            ? "Shared ✓"
            : isGroupView
              ? "Discuss in group"
              : "Share to group"}
        </button>
        {isGroupView && (
          <button type="button" className="bd-pv-tail">
            Tail this market
          </button>
        )}
      </div>
    </div>
  );
}
