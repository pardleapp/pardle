/**
 * /demo/v2 — side-by-side comparison of the current design vs the
 * proposed v2 refresh. Five component pairs in a stacked grid so
 * the visual deltas are immediately legible.
 *
 * "Current" side uses live globals.css classes — what /live looks
 * like right now. "V2" side uses scoped classes defined inline at
 * the top of this file: dark bg, tabular figures, monospace numbers,
 * tighter radii, bigger data + smaller labels, SVG icons.
 *
 * Throwaway route. Delete after a direction's picked.
 */

import Link from "next/link";

// ──────────────────────────────────────────────────────────────────
// V2 styles — scoped to .v2-preview so they don't leak into the rest
// of the page. Inline here rather than in globals.css so the whole
// proposal sits in one file.
// ──────────────────────────────────────────────────────────────────

const V2_CSS = `
.v2-preview {
  --v2-bg: #0c0e10;
  --v2-bg-elevated: #14171a;
  --v2-border: rgba(255, 255, 255, 0.07);
  --v2-text: #e8e9eb;
  --v2-text-dim: #8a8f96;
  --v2-text-label: #5e636a;
  --v2-green: #9ed154;
  --v2-green-dim: rgba(158, 209, 84, 0.14);
  --v2-red: #ef5b6b;
  --v2-red-dim: rgba(239, 91, 107, 0.14);
  --v2-amber: #f6c14b;
  --v2-cyan: #00d9ff;
  --v2-magenta: #d97bff;
  --v2-mono: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;

  background: var(--v2-bg);
  color: var(--v2-text);
  border-radius: 6px;
  padding: 14px;
  font-feature-settings: 'tnum' 1, 'cv11' 1;
  font-variant-numeric: tabular-nums;
}

/* Tournament header */
.v2-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--v2-border);
}

.v2-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.v2-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--v2-cyan);
  box-shadow: 0 0 0 0 rgba(0, 217, 255, 0.5);
  animation: v2-pulse 1.6s infinite;
  flex-shrink: 0;
}

@keyframes v2-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0, 217, 255, 0.5); }
  50% { box-shadow: 0 0 0 6px rgba(0, 217, 255, 0); }
}

.v2-tournament {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--v2-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.v2-elapsed {
  font-family: var(--v2-mono);
  font-size: 12px;
  color: var(--v2-text-dim);
  font-variant-numeric: tabular-nums;
}

/* Feed row */
.v2-feed-row {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--v2-border);
}

.v2-feed-icon {
  font-family: var(--v2-mono);
  width: 32px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.v2-feed-icon-glyph {
  font-size: 14px;
  font-weight: 800;
  color: var(--v2-green);
  letter-spacing: -0.02em;
}

.v2-feed-icon-glyph-bad {
  color: var(--v2-red);
}

.v2-feed-icon-hole {
  font-size: 10px;
  color: var(--v2-text-label);
  font-weight: 700;
}

.v2-feed-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.v2-feed-name {
  font-size: 15px;
  font-weight: 800;
  color: var(--v2-text);
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.v2-feed-result {
  font-family: var(--v2-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--v2-green);
  letter-spacing: 0.03em;
  background: var(--v2-green-dim);
  padding: 2px 7px;
  border-radius: 3px;
  text-transform: uppercase;
}

.v2-feed-result-bad {
  color: var(--v2-red);
  background: var(--v2-red-dim);
}

.v2-feed-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--v2-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--v2-text-dim);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.v2-feed-tag::before {
  content: "·";
  color: var(--v2-text-label);
  margin-right: 6px;
}

.v2-feed-tag:first-child::before {
  display: none;
}

.v2-feed-tag-hot {
  color: var(--v2-amber);
}

.v2-feed-tag-community {
  color: var(--v2-magenta);
}

.v2-feed-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--v2-mono);
  font-size: 10px;
  color: var(--v2-text-label);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.v2-feed-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.v2-feed-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--v2-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--v2-text-dim);
}

.v2-feed-action svg {
  width: 12px;
  height: 12px;
}

/* Bet card */
.v2-bet-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 14px 16px;
  border: 1px solid var(--v2-border);
  border-radius: 6px;
  background: var(--v2-bg-elevated);
}

.v2-bet-name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--v2-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.v2-bet-meta {
  font-family: var(--v2-mono);
  font-size: 10px;
  color: var(--v2-text-label);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.v2-bet-value {
  font-family: var(--v2-mono);
  font-size: 20px;
  font-weight: 800;
  color: var(--v2-text);
  text-align: right;
  letter-spacing: -0.02em;
}

.v2-bet-pnl {
  font-family: var(--v2-mono);
  font-size: 11px;
  font-weight: 800;
  color: var(--v2-green);
  text-align: right;
}

/* Leaderboard */
.v2-lb-row {
  display: grid;
  grid-template-columns: 38px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid var(--v2-border);
  font-family: var(--v2-mono);
}

.v2-lb-pos {
  font-size: 11px;
  font-weight: 800;
  color: var(--v2-text-label);
  letter-spacing: 0.04em;
}

.v2-lb-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--v2-text);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v2-lb-spark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}

.v2-lb-spark > span {
  width: 3px;
  background: var(--v2-text-dim);
  border-radius: 1px;
}

.v2-lb-total {
  font-size: 14px;
  font-weight: 800;
  color: var(--v2-green);
  text-align: right;
  letter-spacing: -0.01em;
}

.v2-lb-total-neg {
  color: var(--v2-green);
}

/* Putt poll */
.v2-poll {
  padding: 14px 16px;
  border: 1px solid var(--v2-border);
  border-radius: 6px;
  background: var(--v2-bg-elevated);
}

.v2-poll-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.v2-poll-label {
  font-family: var(--v2-mono);
  font-size: 10px;
  font-weight: 800;
  color: var(--v2-cyan);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.v2-poll-meta {
  font-family: var(--v2-mono);
  font-size: 10px;
  color: var(--v2-text-label);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.v2-poll-question {
  font-size: 15px;
  font-weight: 800;
  color: var(--v2-text);
  letter-spacing: -0.01em;
  margin: 4px 0 8px;
}

.v2-poll-baseline {
  font-family: var(--v2-mono);
  font-size: 11px;
  color: var(--v2-text-dim);
  letter-spacing: 0.02em;
  margin-bottom: 12px;
}

.v2-poll-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.v2-poll-btn {
  padding: 10px 14px;
  border: 1px solid var(--v2-border);
  border-radius: 4px;
  background: transparent;
  color: var(--v2-text);
  font-family: var(--v2-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 100ms, border-color 100ms;
}

.v2-poll-btn:hover {
  border-color: var(--v2-text-dim);
  background: rgba(255, 255, 255, 0.03);
}

.v2-poll-btn-yes:hover {
  border-color: var(--v2-green);
  color: var(--v2-green);
}

.v2-poll-btn-no:hover {
  border-color: var(--v2-red);
  color: var(--v2-red);
}

/* Wrapper grid */
.demo-wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 60px;
}

.demo-h1 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 800;
}

.demo-h2 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.demo-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 36px;
}

.demo-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.demo-side-label {
  margin: 0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.demo-current {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}

@media (max-width: 720px) {
  .demo-pair {
    grid-template-columns: 1fr;
  }
}
`;

// ──────────────────────────────────────────────────────────────────
// Inline SVG icons (v2)
// ──────────────────────────────────────────────────────────────────

function IconUp() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 8L6 4L10 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="9" height="6.5" rx="1" />
      <path d="M3 9L4.5 11L6 9" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function V2DesignDemo() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: V2_CSS }} />
      <main className="demo-wrap">
        <Link href="/" style={{ fontSize: 12, color: "var(--muted)" }}>
          ← back
        </Link>
        <h1 className="demo-h1">Design refresh · v2 preview</h1>
        <p
          style={{
            margin: "4px 0 28px",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          Same content, two visual treatments. Left: today on pardle.app.
          Right: proposed v2 — dark default, tabular monospace numbers,
          tighter radii, bigger data with smaller labels, SVG icons. Throwaway
          route — delete once a direction's picked.
        </p>

        {/* ── 1. Tournament header ──────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 className="demo-h2">1. Tournament header</h2>
          <div className="demo-pair">
            <div className="demo-side">
              <p className="demo-side-label">Current</p>
              <div className="demo-current">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  <span
                    className="feed-live-pulse feed-live-pulse-inline"
                    aria-hidden
                  />
                  Charles Schwab Challenge
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V2</p>
              <div className="v2-preview">
                <div className="v2-header">
                  <div className="v2-header-left">
                    <span className="v2-live-dot" />
                    <span className="v2-tournament">
                      Charles Schwab Challenge
                    </span>
                  </div>
                  <span className="v2-elapsed">R3 · 14:23 ET</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Feed row (birdie) ──────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 className="demo-h2">2. Feed row — score event</h2>
          <div className="demo-pair">
            <div className="demo-side">
              <p className="demo-side-label">Current</p>
              <div className="demo-current">
                <div className="feed-row feed-row-birdie">
                  <span className="feed-emoji" aria-hidden>
                    🐦
                  </span>
                  <div className="feed-body">
                    <p className="feed-headline">
                      <span
                        className="hand-badge hand-badge-hot"
                        aria-hidden
                      >
                        🔥
                      </span>
                      Joaquin Niemann birdies the 14th
                    </p>
                    <p className="feed-tags">
                      <span className="feed-tag">4th birdie of the round</span>
                      <span className="feed-tag">most birdies in field today</span>
                      <span className="feed-tag feed-tag-community">
                        28% of Pardle backs him
                      </span>
                    </p>
                    <p className="feed-meta">R3 · 2m ago · view card →</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V2</p>
              <div className="v2-preview">
                <div className="v2-feed-row">
                  <div className="v2-feed-icon">
                    <span className="v2-feed-icon-glyph">−1</span>
                    <span className="v2-feed-icon-hole">H14</span>
                  </div>
                  <div className="v2-feed-body">
                    <div className="v2-feed-name">
                      JOAQUIN NIEMANN
                      <span className="v2-feed-result">Birdie</span>
                    </div>
                    <div className="v2-feed-tags">
                      <span className="v2-feed-tag">4th of round</span>
                      <span className="v2-feed-tag">Most in field</span>
                      <span className="v2-feed-tag v2-feed-tag-hot">Hot today</span>
                      <span className="v2-feed-tag v2-feed-tag-community">
                        28% backing
                      </span>
                    </div>
                    <div className="v2-feed-meta">R3 · 02:14 ago</div>
                  </div>
                  <div className="v2-feed-actions">
                    <span className="v2-feed-action">
                      <IconUp /> 12
                    </span>
                    <span className="v2-feed-action">
                      <IconComment /> 3
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. Bet card ─────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 className="demo-h2">3. Bet tracker card</h2>
          <div className="demo-pair">
            <div className="demo-side">
              <p className="demo-side-label">Current</p>
              <div className="demo-current">
                <div className="bets-row">
                  <div className="bets-row-main">
                    <p className="bets-row-name">
                      <span
                        className="hand-badge hand-badge-hot"
                        aria-hidden
                      >
                        🔥
                      </span>
                      Joaquin Niemann
                    </p>
                    <p className="bets-row-meta">
                      Win @ +1500 · £20 · now +650
                    </p>
                  </div>
                  <div className="bets-row-value bets-profit-up">
                    <strong>£42.00</strong>
                    <span>+£22.00</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V2</p>
              <div className="v2-preview">
                <div className="v2-bet-card">
                  <div className="v2-bet-name">
                    JOAQUIN NIEMANN
                    <span style={{ color: "var(--v2-amber)" }}>🔥</span>
                  </div>
                  <div
                    className="v2-bet-value"
                    style={{ gridRow: "span 2", alignSelf: "center" }}
                  >
                    £42.00
                    <div className="v2-bet-pnl">+110.0%</div>
                    <div
                      className="v2-bet-pnl"
                      style={{ color: "var(--v2-text-dim)", fontWeight: 600 }}
                    >
                      +£22.00
                    </div>
                  </div>
                  <div className="v2-bet-meta">
                    WIN  +1500  ·  £20 STAKE
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Leaderboard rows ─────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 className="demo-h2">4. Leaderboard rows</h2>
          <div className="demo-pair">
            <div className="demo-side">
              <p className="demo-side-label">Current</p>
              <div className="demo-current">
                <ol className="lb-list" style={{ margin: 0, padding: 0 }}>
                  <li className="lb-row">
                    <span className="lb-pos">1</span>
                    <span className="lb-name">
                      <span
                        className="hand-badge hand-badge-hot"
                        aria-hidden
                      >
                        🔥
                      </span>
                      Joaquin Niemann
                    </span>
                    <span className="lb-total">-10</span>
                    <span className="lb-thru">11</span>
                  </li>
                  <li className="lb-row">
                    <span className="lb-pos">T2</span>
                    <span className="lb-name">Scottie Scheffler</span>
                    <span className="lb-total">-8</span>
                    <span className="lb-thru">13</span>
                  </li>
                  <li className="lb-row">
                    <span className="lb-pos">T2</span>
                    <span className="lb-name">
                      <span
                        className="hand-badge hand-badge-cold"
                        aria-hidden
                      >
                        🥶
                      </span>
                      Patrick Cantlay
                    </span>
                    <span className="lb-total">-8</span>
                    <span className="lb-thru">F</span>
                  </li>
                </ol>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V2</p>
              <div className="v2-preview">
                <div className="v2-lb-row">
                  <span className="v2-lb-pos">01</span>
                  <span className="v2-lb-name">
                    NIEMANN
                    <span style={{ color: "var(--v2-amber)" }}>🔥</span>
                  </span>
                  <span className="v2-lb-spark">
                    <span style={{ height: "50%" }} />
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "70%" }} />
                    <span
                      style={{ height: "100%", background: "var(--v2-green)" }}
                    />
                  </span>
                  <span className="v2-lb-total">−10</span>
                </div>
                <div className="v2-lb-row">
                  <span className="v2-lb-pos">T02</span>
                  <span className="v2-lb-name">SCHEFFLER</span>
                  <span className="v2-lb-spark">
                    <span style={{ height: "100%" }} />
                    <span style={{ height: "100%" }} />
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "50%" }} />
                  </span>
                  <span className="v2-lb-total">−08</span>
                </div>
                <div className="v2-lb-row">
                  <span className="v2-lb-pos">T02</span>
                  <span className="v2-lb-name">
                    CANTLAY
                    <span style={{ color: "var(--v2-cyan)" }}>🥶</span>
                  </span>
                  <span className="v2-lb-spark">
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "50%" }} />
                    <span style={{ height: "30%" }} />
                    <span style={{ height: "20%" }} />
                  </span>
                  <span className="v2-lb-total">−08</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 5. Putt poll ─────────────────────────────────────── */}
        <section style={{ marginBottom: 32 }}>
          <h2 className="demo-h2">5. Putt prediction poll</h2>
          <div className="demo-pair">
            <div className="demo-side">
              <p className="demo-side-label">Current</p>
              <div className="demo-current">
                <div className="putt-poll">
                  <p className="putt-poll-prompt">
                    Will it drop?
                    <span className="putt-poll-prompt-hint">
                      Vote to see what others said
                    </span>
                  </p>
                  <p className="putt-poll-baseline">
                    Tour avg 22% from 14 ft · Niemann +1.8 SG putting this
                    week
                  </p>
                  <div className="putt-poll-buttons">
                    <button
                      type="button"
                      className="putt-poll-btn putt-poll-btn-yes"
                    >
                      Yes · drops
                    </button>
                    <button
                      type="button"
                      className="putt-poll-btn putt-poll-btn-no"
                    >
                      No · misses
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V2</p>
              <div className="v2-preview">
                <div className="v2-poll">
                  <div className="v2-poll-head">
                    <span className="v2-poll-label">● Putt prediction</span>
                    <span className="v2-poll-meta">14 ft · for birdie</span>
                  </div>
                  <p className="v2-poll-question">Will it drop?</p>
                  <p className="v2-poll-baseline">
                    TOUR 22%  ·  NIEMANN PUTT +1.8 SG/RD
                  </p>
                  <div className="v2-poll-buttons">
                    <button type="button" className="v2-poll-btn v2-poll-btn-yes">
                      Make
                    </button>
                    <button type="button" className="v2-poll-btn v2-poll-btn-no">
                      Miss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <p
          style={{
            margin: "32px 0 0",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          v2 design language: dark default, monospace tabular numerals
          throughout, uppercase + letter-spaced labels, 4-6px radii, SVG
          icons replacing chrome emoji, cyan live indicators, magenta
          community accent, amber/cyan hot-cold instead of fire/snowflake
          emoji as chrome (kept inside the data card as accent). Same
          content, different category.
        </p>
      </main>
    </>
  );
}
