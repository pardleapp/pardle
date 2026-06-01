"use client";

/**
 * MemberProfile — full-screen overlay opened from a member row or
 * a standings rank. Matches the design-handoff prototype's
 * <MemberProfile>:
 *
 *   ← Jordan · Admin
 *     In The Lads · this week · 12 bets · 8 W
 *
 *   [JO avatar 56]   Jordan
 *                    Today +£312 · this tournament         [Nudge]
 *
 *   P&L · this tournament
 *     ░░░░░▁▂▃▅▆▇        (area chart, green/red)
 *     R1                                                       now
 *
 *   Open bets · 3
 *     [pro av]  R. Henley   OUTRIGHT    £50 @ 3.50   62%
 *     [pro av]  C. Morikawa TOP 10      £30 @ 2.10   55%
 *     [pro av]  M. Brennan  UNDER 69.5  $40 @ 1.90   46% (red)
 *
 *   ────────────────────────────────────────
 *   [View full profile]              [Tail their slip]
 *
 * Tapping a bet row routes to /live/player/[name] — caller is
 * expected to dismiss this overlay first (see openPlayer in
 * GroupsClient) so the route change leaves a clean stack.
 */

import { MEMBER_INFO } from "./mock-groups";

interface Props {
  name: string;
  onClose: () => void;
  onOpenPlayer: (player: string) => void;
}

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
          <linearGradient id="mpgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#mpgrad)" />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export default function MemberProfile({ name, onClose, onOpenPlayer }: Props) {
  const fallback = {
    initials: name.slice(0, 2).toUpperCase(),
    role: "" as const,
    today: "+£0",
    dir: "up" as const,
    hist: [0, 0],
    record: "—",
    bets: [] as never[],
  };
  const info = MEMBER_INFO[name] ?? fallback;
  const negative = info.dir === "down";

  return (
    <div className="grp-overlay" role="dialog" aria-label={`${name} profile`}>
      <header className="grp-overlay-head">
        <button
          type="button"
          className="bd-pv-back"
          onClick={onClose}
          aria-label="Close member profile"
        >
          ←
        </button>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">
            {name}
            {info.role && <span className="role-tag">{info.role}</span>}
          </div>
          <div className="bd-pv-title-mk">In The Lads · {info.record}</div>
        </div>
      </header>

      <div className="grp-overlay-body">
        <section className="mp-hero">
          <span
            className="crew-mini-av"
            style={{
              width: 56,
              height: 56,
              fontSize: 19,
              background: bgFor(info.initials),
            }}
            aria-hidden="true"
          >
            {info.initials}
          </span>
          <div className="mp-hero-body">
            <div className="mp-hero-nm">{name}</div>
            <div className="mp-hero-sub">
              Today{" "}
              <b
                style={{
                  color: negative ? "var(--pv-down)" : "var(--pv-up)",
                }}
              >
                {info.today}
              </b>{" "}
              · this tournament
            </div>
          </div>
          <button type="button" className="mp-nudge">
            Nudge
          </button>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">P&amp;L · this tournament</h4>
          <AreaChart hist={info.hist} dir={info.dir} />
          <div className="bd-chart-x">
            <span>R1</span>
            <span>now</span>
          </div>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">Open bets · {info.bets.length}</h4>
          {info.bets.length === 0 ? (
            <p className="pl-gbet-empty">No open bets right now.</p>
          ) : (
            <ul className="mp-bets">
              {info.bets.map((b, i) => {
                const probColor =
                  b.dir === "down" ? "var(--pv-down)" : "var(--pv-up)";
                return (
                  <li key={i}>
                    <button
                      type="button"
                      className="mp-bet-row"
                      onClick={() => onOpenPlayer(b.player)}
                    >
                      <div className="mp-bet-row-l">
                        <div className="mp-bet-row-nm">
                          {b.player}
                          <span className="bp-bet-mkt">{b.market}</span>
                        </div>
                        <div className="mp-bet-row-sub">
                          {b.stakeLabel} @ {b.oddsLabel}
                        </div>
                      </div>
                      <span className="mp-bet-row-prob" style={{ color: probColor }}>
                        {b.probPct}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <footer className="grp-overlay-foot">
        <button type="button" className="bd-pv-share">
          View full profile
        </button>
        <button type="button" className="bd-pv-tail">
          Tail their slip
        </button>
      </footer>
    </div>
  );
}
