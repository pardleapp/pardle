"use client";

/**
 * Crew-side post components — render the prototype's <BetPost>,
 * <ResultPost> and <TipPost> for the mock crew data that ships to
 * /live while Groups doesn't have a backend yet. Each component
 * accepts the corresponding shape from mock-crew-posts.ts.
 *
 * Real own-bet rendering still goes through ../BetPost.tsx; these
 * are pure-display siblings for the "Jordan is sweating Henley"
 * social layer.
 */

import Link from "next/link";
import type {
  MockBetPost,
  MockResultPost,
  MockTipPost,
} from "./mock-crew-posts";
import { useHoldReact } from "./useHoldReact";
import ReactionChips, { type ReactionState } from "./ReactionChips";

const PALETTE: Record<string, string> = {
  JO: "linear-gradient(135deg,#5cd7c1,#1f8b6e)",
  SA: "linear-gradient(135deg,#f29a4f,#d44a4a)",
  TH: "linear-gradient(135deg,#6b7df2,#c659d8)",
  MI: "linear-gradient(135deg,#ed7a99,#7a274d)",
  YO: "linear-gradient(135deg,#ffb35a,#c4691a)",
  PA: "linear-gradient(135deg,#a070ff,#3b1f8a)",
  DA: "linear-gradient(135deg,#85d4f7,#1f6b9e)",
  NI: "linear-gradient(135deg,#7be0ad,#26795a)",
  RO: "linear-gradient(135deg,#56b0e8,#3a4f9b)",
};
function bgFor(initials: string): string {
  return PALETTE[initials] ?? "linear-gradient(135deg,#6b7df2,#3b1f8a)";
}

function MiniAv({
  initials,
  size = 22,
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

function timeAgo(tsOffsetMs: number): string {
  const ago = Math.max(60, Math.abs(tsOffsetMs)) / 1000;
  if (ago < 60) return "just now";
  const m = Math.floor(ago / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function Spark({
  hist,
  dir,
}: {
  hist: number[];
  dir: "up" | "down" | "flat";
}) {
  if (hist.length < 2) return null;
  const w = 300;
  const h = 32;
  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const rng = Math.max(0.001, max - min);
  const pts = hist
    .map(
      (v, i) =>
        `${(i / (hist.length - 1)) * w},${h - ((v - min) / rng) * (h - 5) - 3}`,
    )
    .join(" ");
  const color =
    dir === "down" ? "var(--pv-down)" : dir === "up" ? "var(--pv-up)" : "var(--pv-dim)";
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

export function CrewBetPost({
  post,
  onCustomReact,
  reactionState,
  onToggleReaction,
}: {
  post: MockBetPost;
  onCustomReact?: (emoji: string) => void;
  reactionState?: ReactionState;
  onToggleReaction?: (emoji: string) => void;
}) {
  const { surfaceProps, tray, openTray } = useHoldReact({
    onReact: (emoji) => onCustomReact?.(emoji),
  });
  const dirClass = post.dir;
  const probColor =
    post.dir === "down"
      ? "var(--pv-down)"
      : post.dir === "up"
        ? "var(--pv-up)"
        : "var(--pv-ink)";
  return (
    <>
    <article
      className={`post bpost${post.dir === "down" ? " down" : ""}`}
      data-crew-id={post.id}
      {...surfaceProps}
    >
      <div className="bp-head">
        <MiniAv initials={post.bettorInitials} size={38} />
        <div className="bp-who">
          <div className="bp-who-nm">
            <span>{post.mine ? "You" : post.bettorName}</span>
            <span className="bp-who-verb">
              {post.mine ? "are sweating" : "is sweating"}
            </span>
          </div>
          <div className="bp-who-tm">{timeAgo(post.tsOffsetMs)} ago · live</div>
        </div>
        <div className="bp-prob">
          <div className="bp-prob-v" style={{ color: probColor }}>
            {post.probPct}%
          </div>
          <div className={`bp-prob-d ${dirClass}`}>
            {post.dir === "up" ? "▲" : post.dir === "down" ? "▼" : "·"} live
          </div>
        </div>
      </div>
      <div className="bp-bet">
        <Link
          href={`/live/player/${encodeURIComponent(post.playerName)}`}
          className="bp-bet-player bp-bet-player-link"
        >
          {post.playerName}
        </Link>
        <span className="bp-bet-mkt">{post.marketLabel}</span>
        <span className="bp-bet-stake">
          {post.currency}
          {post.stake} @ {post.oddsLabel}
        </span>
      </div>
      <Spark hist={post.sparkline} dir={post.dir} />
      {post.thread.length > 0 && (
        <div className="bp-thread">
          {post.thread.map((u, i) => (
            <div className="bp-upd" key={i}>
              <span className={`bp-upd-dot ${u.dir}`} />
              <span className="bp-upd-text">{u.text}</span>
              <span className={`bp-upd-val ${u.dir}`}>
                {u.delta === "0" ? "—" : u.delta}
              </span>
            </div>
          ))}
        </div>
      )}
      {onToggleReaction && (
        <div className="post-act-row">
          <ReactionChips
            state={reactionState}
            onToggle={onToggleReaction}
            onAdd={openTray}
          />
          <button
            type="button"
            className="post-act-cmt"
            aria-label="Comments"
            data-no-hold
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="15"
              height="15"
            >
              <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
            </svg>
            <span>{post.commentCount}</span>
          </button>
          {(!post.mine || post.on.length > 0) && (
            <div className="post-act-tail-grp" data-no-hold>
              {!post.mine && (
                <button type="button" className="post-act-tail">
                  Tail
                </button>
              )}
              {post.on.length > 0 && (
                <span className="bp-foot-on">
                  <span className="bp-foot-on-row">
                    {post.on.map((init) => (
                      <MiniAv key={init} initials={init} size={22} />
                    ))}
                  </span>
                  <span className="bp-foot-on-lbl">
                    {post.on.length} on it
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </article>
    {tray}
    </>
  );
}

export function CrewResultPost({
  post,
  onCustomReact,
  reactionState,
  onToggleReaction,
}: {
  post: MockResultPost;
  onCustomReact?: (emoji: string) => void;
  reactionState?: ReactionState;
  onToggleReaction?: (emoji: string) => void;
}) {
  const { surfaceProps, tray, openTray } = useHoldReact({
    onReact: (emoji) => onCustomReact?.(emoji),
  });
  return (
    <>
    <article
      className={`post rpost${post.win ? "" : " loss"}`}
      data-crew-id={post.id}
      {...surfaceProps}
    >
      <div className="rp-top">
        <MiniAv initials={post.bettorInitials} size={38} />
        <div className="rp-txt">
          {post.win ? "🎉 " : "💀 "}
          <b>{post.bettorName}</b> — {post.text}
        </div>
        <div className={`rp-pl ${post.win ? "win" : "loss"}`}>
          {post.plLabel}
        </div>
      </div>
      {onToggleReaction && (
        <div className="post-act-row">
          <ReactionChips
            state={reactionState}
            onToggle={onToggleReaction}
            onAdd={openTray}
          />
        </div>
      )}
    </article>
    {tray}
    </>
  );
}

export function CrewTipPost({
  post,
  onCustomReact,
  reactionState,
  onToggleReaction,
}: {
  post: MockTipPost;
  onCustomReact?: (emoji: string) => void;
  reactionState?: ReactionState;
  onToggleReaction?: (emoji: string) => void;
}) {
  const { surfaceProps, tray, openTray } = useHoldReact({
    onReact: (emoji) => onCustomReact?.(emoji),
  });
  return (
    <>
    <article className="post tpost" data-crew-id={post.id} {...surfaceProps}>
      <div className="tp-head">
        <MiniAv initials="GE" size={34} />
        <span className="tp-by">
          {post.channel}{" "}
          <span style={{ color: "var(--pv-blue)", fontWeight: 800 }}>
            tipped
          </span>
        </span>
        <span className="tp-odds mono">
          {post.marketLabel} · {post.oddsLabel}
        </span>
      </div>
      <div className="tp-body">
        <div className="tp-player">{post.playerName}</div>
        <div className="tp-rat">&ldquo;{post.rationale}&rdquo;</div>
      </div>
      <button type="button" className="tp-track" data-no-hold>
        ＋ Track this tip
      </button>
      {onToggleReaction && (
        <div className="post-act-row">
          <ReactionChips
            state={reactionState}
            onToggle={onToggleReaction}
            onAdd={openTray}
          />
        </div>
      )}
    </article>
    {tray}
    </>
  );
}
