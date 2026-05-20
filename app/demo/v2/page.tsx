/**
 * /demo/v2 — four-way comparison of design directions.
 *
 * v2 = trading terminal: dark, monospace tabular numerals, uppercase
 *      labels, 4-6px radii, SVG icons, cyan live accent.
 * v3 = editorial / Athletic: light, generous typography, serif
 *      headlines, prose-style copy, deep forest green + gold accents.
 * v4 = "Real" energy: deep black, big bold SANS numbers (not mono),
 *      saturated electric colors, avatar circles, pill buttons,
 *      glow effects, larger rounded corners — social-tech app vibe.
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

/* ──────────────────────────────────────────────────────────────── */
/* V3 — editorial / Athletic                                         */
/* Light, serif headlines, generous typography, prose-style copy.    */
/* ──────────────────────────────────────────────────────────────── */
.v3-preview {
  --v3-bg: #faf8f4;
  --v3-bg-elevated: #ffffff;
  --v3-border: #e5e1d8;
  --v3-border-strong: #c9c2b4;
  --v3-text: #1a1a1a;
  --v3-text-dim: #6f6a64;
  --v3-text-label: #918a82;
  --v3-green: #1f4a2c;
  --v3-green-soft: #5a7d3a;
  --v3-red: #7a2932;
  --v3-gold: #a47d2b;
  --v3-serif: 'Charter', 'Source Serif Pro', 'Source Serif 4',
               'Iowan Old Style', 'Apple Garamond', Georgia,
               'Times New Roman', serif;
  --v3-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
              Roboto, 'Helvetica Neue', Arial, sans-serif;

  background: var(--v3-bg);
  color: var(--v3-text);
  border-radius: 4px;
  padding: 22px 20px;
  font-family: var(--v3-sans);
  line-height: 1.4;
}

/* Tournament header (v3) */
.v3-header {
  border-bottom: 1px solid var(--v3-border-strong);
  padding-bottom: 14px;
}

.v3-header-eyebrow {
  font-family: var(--v3-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--v3-green);
  margin: 0 0 4px;
}

.v3-tournament {
  font-family: var(--v3-serif);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--v3-text);
  margin: 0;
  line-height: 1.15;
}

.v3-header-meta {
  font-family: var(--v3-sans);
  font-size: 12px;
  color: var(--v3-text-dim);
  margin: 8px 0 0;
}

/* Feed row (v3) — prose style, no chips */
.v3-feed-row {
  padding: 18px 0;
  border-bottom: 1px solid var(--v3-border);
}

.v3-feed-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
}

.v3-feed-name {
  font-family: var(--v3-serif);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--v3-text);
  line-height: 1.1;
}

.v3-feed-name-dot {
  color: var(--v3-gold);
  margin-right: 6px;
}

.v3-feed-actions {
  display: flex;
  gap: 14px;
  font-family: var(--v3-sans);
  font-size: 12px;
  color: var(--v3-text-dim);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.v3-feed-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.v3-feed-prose {
  font-family: var(--v3-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--v3-text);
  margin: 6px 0 10px;
  max-width: 50ch;
}

.v3-feed-emphasis {
  color: var(--v3-green);
  font-weight: 700;
}

.v3-feed-emphasis-bad {
  color: var(--v3-red);
  font-weight: 700;
}

.v3-feed-meta {
  font-family: var(--v3-sans);
  font-size: 11px;
  color: var(--v3-text-label);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Bet card (v3) */
.v3-bet-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 16px;
  padding: 18px 20px;
  border: 1px solid var(--v3-border);
  border-radius: 4px;
  background: var(--v3-bg-elevated);
}

.v3-bet-name {
  font-family: var(--v3-serif);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--v3-text);
  line-height: 1.2;
}

.v3-bet-meta {
  font-family: var(--v3-sans);
  font-size: 12px;
  color: var(--v3-text-dim);
}

.v3-bet-meta-fine {
  font-size: 11px;
  color: var(--v3-text-label);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.v3-bet-value {
  font-family: var(--v3-serif);
  font-size: 24px;
  font-weight: 700;
  color: var(--v3-text);
  text-align: right;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.v3-bet-pnl {
  font-family: var(--v3-sans);
  font-size: 12px;
  color: var(--v3-green);
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Leaderboard (v3) */
.v3-lb-row {
  display: grid;
  grid-template-columns: 32px 1fr auto auto;
  align-items: baseline;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid var(--v3-border);
  font-family: var(--v3-sans);
}

.v3-lb-pos {
  font-family: var(--v3-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--v3-text-dim);
  font-variant-numeric: tabular-nums;
}

.v3-lb-name {
  font-family: var(--v3-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--v3-text);
  letter-spacing: -0.01em;
}

.v3-lb-form {
  font-family: var(--v3-sans);
  font-size: 10px;
  color: var(--v3-text-label);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
}

.v3-lb-total {
  font-family: var(--v3-serif);
  font-size: 18px;
  font-weight: 700;
  color: var(--v3-green);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.v3-lb-thru {
  font-family: var(--v3-sans);
  font-size: 11px;
  color: var(--v3-text-dim);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Putt poll (v3) — framed as a journalism prompt */
.v3-poll {
  padding: 22px;
  border: 1px solid var(--v3-border-strong);
  border-radius: 4px;
  background: var(--v3-bg-elevated);
  position: relative;
}

.v3-poll-rule {
  position: absolute;
  top: 0;
  left: 22px;
  right: 22px;
  border-top: 2px solid var(--v3-gold);
}

.v3-poll-eyebrow {
  font-family: var(--v3-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--v3-gold);
  margin: 6px 0 8px;
}

.v3-poll-question {
  font-family: var(--v3-serif);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--v3-text);
  margin: 0 0 14px;
}

.v3-poll-context {
  font-family: var(--v3-sans);
  font-size: 13px;
  line-height: 1.55;
  color: var(--v3-text-dim);
  margin: 0 0 16px;
}

.v3-poll-context strong {
  color: var(--v3-text);
}

.v3-poll-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.v3-poll-btn {
  padding: 12px 18px;
  border: 1px solid var(--v3-border-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--v3-text);
  font-family: var(--v3-serif);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 100ms, border-color 100ms, color 100ms;
}

.v3-poll-btn:hover {
  border-color: var(--v3-green);
  color: var(--v3-green);
  background: rgba(31, 74, 44, 0.04);
}

/* ──────────────────────────────────────────────────────────────── */
/* V4 — "Real" energy                                                */
/* Deep black, big bold SANS numbers (not mono), saturated colors,   */
/* avatar circles, pill buttons, glow on hot indicators.             */
/* ──────────────────────────────────────────────────────────────── */
.v4-preview {
  --v4-bg: #000;
  --v4-bg-card: #0e0f12;
  --v4-bg-card-hi: #15171b;
  --v4-border: rgba(255, 255, 255, 0.06);
  --v4-text: #f5f5f7;
  --v4-text-dim: #9aa0a8;
  --v4-text-faint: #5a606a;
  --v4-green: #00d96e;
  --v4-green-glow: rgba(0, 217, 110, 0.35);
  --v4-red: #ff4b6b;
  --v4-red-glow: rgba(255, 75, 107, 0.35);
  --v4-amber: #ff9d2e;
  --v4-amber-glow: rgba(255, 157, 46, 0.45);
  --v4-purple: #a070ff;

  background: var(--v4-bg);
  color: var(--v4-text);
  border-radius: 16px;
  padding: 18px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI',
                Roboto, system-ui, sans-serif;
  line-height: 1.35;
}

/* Header (v4) */
.v4-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--v4-border);
}

.v4-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 217, 110, 0.12);
  color: var(--v4-green);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.v4-live-pill::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--v4-green);
  box-shadow: 0 0 8px var(--v4-green-glow);
  animation: v4-pulse 1.6s infinite;
}

@keyframes v4-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.v4-tournament {
  flex: 1;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v4-round-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--v4-bg-card-hi);
  font-size: 11px;
  font-weight: 700;
  color: var(--v4-text-dim);
}

/* Feed row (v4) */
.v4-feed-row {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--v4-border);
}

.v4-avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: linear-gradient(135deg, #6b7df2, #c659d8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.02em;
  flex-shrink: 0;
}

.v4-feed-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.v4-feed-top {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.v4-feed-name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.v4-feed-hot-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--v4-amber);
  box-shadow: 0 0 8px var(--v4-amber-glow);
}

.v4-feed-score {
  font-size: 22px;
  font-weight: 800;
  color: var(--v4-green);
  letter-spacing: -0.02em;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.v4-feed-score-hole {
  font-size: 11px;
  font-weight: 700;
  color: var(--v4-text-dim);
  letter-spacing: 0;
}

.v4-feed-action {
  font-size: 13px;
  font-weight: 700;
  color: var(--v4-text);
  line-height: 1.3;
}

.v4-feed-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.v4-feed-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--v4-bg-card-hi);
  color: var(--v4-text-dim);
}

.v4-feed-pill-hot {
  background: rgba(255, 157, 46, 0.15);
  color: var(--v4-amber);
}

.v4-feed-pill-community {
  background: rgba(160, 112, 255, 0.15);
  color: var(--v4-purple);
}

.v4-feed-meta {
  font-size: 11px;
  font-weight: 600;
  color: var(--v4-text-faint);
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}

.v4-feed-meta-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Bet card (v4) */
.v4-bet-card {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--v4-bg-card);
  align-items: center;
}

.v4-bet-name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.v4-bet-meta {
  font-size: 11px;
  font-weight: 600;
  color: var(--v4-text-dim);
  margin-top: 2px;
}

.v4-bet-value {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  text-align: right;
  line-height: 1;
}

.v4-bet-pnl {
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  margin-top: 4px;
  color: var(--v4-green);
}

/* Leaderboard (v4) */
.v4-lb-row {
  display: grid;
  grid-template-columns: 30px 32px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--v4-border);
}

.v4-lb-pos {
  font-size: 12px;
  font-weight: 800;
  color: var(--v4-text-dim);
}

.v4-avatar-sm {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: linear-gradient(135deg, #4f6df0, #b252d2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
}

.v4-lb-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v4-lb-name-cold {
  color: var(--v4-text-dim);
}

.v4-lb-spark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
}

.v4-lb-spark > span {
  width: 4px;
  border-radius: 1px;
  background: var(--v4-text-dim);
}

.v4-lb-total {
  font-size: 16px;
  font-weight: 800;
  text-align: right;
  letter-spacing: -0.01em;
  min-width: 36px;
  color: var(--v4-green);
}

/* Putt poll (v4) */
.v4-poll {
  padding: 18px;
  border-radius: 16px;
  background: var(--v4-bg-card);
  position: relative;
  overflow: hidden;
}

.v4-poll-glow {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 140px;
  height: 140px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(0, 217, 110, 0.18) 0%, transparent 70%);
  pointer-events: none;
}

.v4-poll-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 217, 110, 0.12);
  color: var(--v4-green);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.v4-poll-eyebrow::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--v4-green);
  box-shadow: 0 0 6px var(--v4-green-glow);
}

.v4-poll-meta {
  font-size: 11px;
  font-weight: 700;
  color: var(--v4-text-dim);
  display: inline-block;
  margin-left: 8px;
}

.v4-poll-question {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 10px 0 8px;
  line-height: 1.2;
}

.v4-poll-baseline {
  font-size: 12px;
  color: var(--v4-text-dim);
  margin-bottom: 14px;
}

.v4-poll-baseline strong {
  color: var(--v4-text);
  font-weight: 800;
}

.v4-poll-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.v4-poll-btn {
  padding: 12px 16px;
  border: none;
  border-radius: 999px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 100ms, box-shadow 200ms;
}

.v4-poll-btn:active {
  transform: scale(0.97);
}

.v4-poll-btn-yes {
  background: var(--v4-green);
  color: #04130a;
  box-shadow: 0 4px 20px var(--v4-green-glow);
}

.v4-poll-btn-no {
  background: var(--v4-bg-card-hi);
  color: var(--v4-text);
}

.v4-poll-btn-no:hover {
  background: rgba(255, 75, 107, 0.12);
  color: var(--v4-red);
}

/* Wrapper grid */
.demo-wrap {
  max-width: 1680px;
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
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 14px;
  margin-bottom: 36px;
  align-items: start;
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

@media (max-width: 1400px) {
  .demo-pair {
    grid-template-columns: 1fr 1fr;
  }
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
        <h1 className="demo-h1">Design refresh · four directions</h1>
        <p
          style={{
            margin: "4px 0 28px",
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1.5,
            maxWidth: 920,
          }}
        >
          Same content, four visual treatments side-by-side. Stacks to
          two-up on narrower screens, single column on mobile.
          {" "}
          <strong>Current</strong>: today on pardle.app.
          {" "}
          <strong>V2</strong>: trading-terminal — dark, monospace,
          tabular, Bloomberg-sober.
          {" "}
          <strong>V3</strong>: editorial / Athletic — light, serif,
          prose-style, premium publication.
          {" "}
          <strong>V4</strong>: "Real" energy — deep black, big bold
          sans (no monospace), saturated electric green, avatar
          circles, pill CTAs, glow indicators, social-tech-app vibe.
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
              <p className="demo-side-label">V2 · trading terminal</p>
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
            <div className="demo-side">
              <p className="demo-side-label">V3 · editorial</p>
              <div className="v3-preview">
                <div className="v3-header">
                  <p className="v3-header-eyebrow">Live · Round 3</p>
                  <h3 className="v3-tournament">
                    Charles Schwab Challenge
                  </h3>
                  <p className="v3-header-meta">
                    Colonial Country Club · Fort Worth · 78 in the field
                  </p>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V4 · Real energy</p>
              <div className="v4-preview">
                <div className="v4-header">
                  <span className="v4-live-pill">Live</span>
                  <span className="v4-tournament">
                    Charles Schwab
                  </span>
                  <span className="v4-round-pill">R3</span>
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
              <p className="demo-side-label">V2 · trading terminal</p>
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
            <div className="demo-side">
              <p className="demo-side-label">V3 · editorial</p>
              <div className="v3-preview">
                <div className="v3-feed-row">
                  <div className="v3-feed-head">
                    <h4 className="v3-feed-name">
                      <span className="v3-feed-name-dot">●</span>
                      Joaquin Niemann
                    </h4>
                    <div className="v3-feed-actions">
                      <span className="v3-feed-action">▲ 12</span>
                      <span className="v3-feed-action">💬 3</span>
                    </div>
                  </div>
                  <p className="v3-feed-prose">
                    <span className="v3-feed-emphasis">Birdies the 14th</span>
                    {" "}— his 4th of the round, more than any other player
                    in the field today. Backed by 28% of Pardle bettors this
                    week, and registering hot on the course (top five by
                    strokes gained today).
                  </p>
                  <p className="v3-feed-meta">R3 · 2 min ago</p>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V4 · Real energy</p>
              <div className="v4-preview">
                <div className="v4-feed-row">
                  <div className="v4-avatar">JN</div>
                  <div className="v4-feed-body">
                    <div className="v4-feed-top">
                      <span className="v4-feed-name">
                        Joaquin Niemann
                        <span className="v4-feed-hot-dot" aria-hidden />
                      </span>
                      <span className="v4-feed-score">
                        −1
                        <span className="v4-feed-score-hole">H14</span>
                      </span>
                    </div>
                    <div className="v4-feed-action">Birdies the 14th</div>
                    <div className="v4-feed-tags">
                      <span className="v4-feed-pill">4th of rd</span>
                      <span className="v4-feed-pill">Most in field</span>
                      <span className="v4-feed-pill v4-feed-pill-hot">
                        Hot today
                      </span>
                      <span className="v4-feed-pill v4-feed-pill-community">
                        28% backing
                      </span>
                    </div>
                    <div className="v4-feed-meta">
                      <span>2m ago</span>
                      <span className="v4-feed-meta-action">▲ 12</span>
                      <span className="v4-feed-meta-action">💬 3</span>
                    </div>
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
              <p className="demo-side-label">V2 · trading terminal</p>
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
            <div className="demo-side">
              <p className="demo-side-label">V3 · editorial</p>
              <div className="v3-preview">
                <div className="v3-bet-card">
                  <div className="v3-bet-name">Joaquin Niemann</div>
                  <div className="v3-bet-value">
                    £42.00
                    <div className="v3-bet-pnl">+110.0%</div>
                  </div>
                  <div className="v3-bet-meta">
                    Win @ +1500 · £20 stake
                  </div>
                  <div className="v3-bet-pnl" style={{ alignSelf: "end" }}>
                    +£22.00
                  </div>
                  <div className="v3-bet-meta-fine">
                    placed 36h ago
                  </div>
                  <div />
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V4 · Real energy</p>
              <div className="v4-preview">
                <div className="v4-bet-card">
                  <div className="v4-avatar">JN</div>
                  <div>
                    <div className="v4-bet-name">
                      Joaquin Niemann
                      <span className="v4-feed-hot-dot" aria-hidden />
                    </div>
                    <div className="v4-bet-meta">
                      Win @ +1500 · £20
                    </div>
                  </div>
                  <div>
                    <div className="v4-bet-value">£42.00</div>
                    <div className="v4-bet-pnl">+110%</div>
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
              <p className="demo-side-label">V2 · trading terminal</p>
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
            <div className="demo-side">
              <p className="demo-side-label">V3 · editorial</p>
              <div className="v3-preview">
                <div className="v3-lb-row">
                  <span className="v3-lb-pos">1</span>
                  <div>
                    <div className="v3-lb-name">Joaquin Niemann</div>
                    <div className="v3-lb-form">
                      Form: T6 · MC · T19 · T17 · T28
                    </div>
                  </div>
                  <span className="v3-lb-total">−10</span>
                  <span className="v3-lb-thru">thru 11</span>
                </div>
                <div className="v3-lb-row">
                  <span className="v3-lb-pos">T2</span>
                  <div>
                    <div className="v3-lb-name">Scottie Scheffler</div>
                    <div className="v3-lb-form">
                      Form: T3 · Win · T11 · T28 · MC
                    </div>
                  </div>
                  <span className="v3-lb-total">−8</span>
                  <span className="v3-lb-thru">thru 13</span>
                </div>
                <div className="v3-lb-row">
                  <span className="v3-lb-pos">T2</span>
                  <div>
                    <div className="v3-lb-name">Patrick Cantlay</div>
                    <div className="v3-lb-form">
                      Form: T42 · MC · T35 · T19 · T56
                    </div>
                  </div>
                  <span className="v3-lb-total">−8</span>
                  <span className="v3-lb-thru">F</span>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V4 · Real energy</p>
              <div className="v4-preview">
                <div className="v4-lb-row">
                  <span className="v4-lb-pos">1</span>
                  <div className="v4-avatar-sm">JN</div>
                  <span className="v4-lb-name">
                    Niemann
                    <span className="v4-feed-hot-dot" aria-hidden />
                  </span>
                  <span className="v4-lb-spark">
                    <span style={{ height: "50%" }} />
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "100%", background: "var(--v4-green)" }} />
                  </span>
                  <span className="v4-lb-total">−10</span>
                </div>
                <div className="v4-lb-row">
                  <span className="v4-lb-pos">T2</span>
                  <div
                    className="v4-avatar-sm"
                    style={{ background: "linear-gradient(135deg,#f29a4f,#d44a4a)" }}
                  >
                    SS
                  </div>
                  <span className="v4-lb-name">Scheffler</span>
                  <span className="v4-lb-spark">
                    <span style={{ height: "100%" }} />
                    <span style={{ height: "100%" }} />
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "50%" }} />
                  </span>
                  <span className="v4-lb-total">−8</span>
                </div>
                <div className="v4-lb-row">
                  <span className="v4-lb-pos">T2</span>
                  <div
                    className="v4-avatar-sm"
                    style={{ background: "linear-gradient(135deg,#56b0e8,#3a4f9b)" }}
                  >
                    PC
                  </div>
                  <span className="v4-lb-name v4-lb-name-cold">Cantlay</span>
                  <span className="v4-lb-spark">
                    <span style={{ height: "70%" }} />
                    <span style={{ height: "50%" }} />
                    <span style={{ height: "30%" }} />
                    <span style={{ height: "20%" }} />
                  </span>
                  <span
                    className="v4-lb-total"
                    style={{ color: "var(--v4-text-dim)" }}
                  >
                    −8
                  </span>
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
              <p className="demo-side-label">V2 · trading terminal</p>
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
            <div className="demo-side">
              <p className="demo-side-label">V3 · editorial</p>
              <div className="v3-preview">
                <div className="v3-poll">
                  <span className="v3-poll-rule" />
                  <p className="v3-poll-eyebrow">A prediction for the field</p>
                  <h4 className="v3-poll-question">
                    Will Niemann sink this 14-footer for birdie?
                  </h4>
                  <p className="v3-poll-context">
                    The tour averages <strong>22%</strong> from this
                    distance. Niemann ranks in the top decile on the
                    greens this week, gaining <strong>+1.8 strokes per
                    round</strong> on the field.
                  </p>
                  <div className="v3-poll-buttons">
                    <button type="button" className="v3-poll-btn">
                      Make
                    </button>
                    <button type="button" className="v3-poll-btn">
                      Miss
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="demo-side">
              <p className="demo-side-label">V4 · Real energy</p>
              <div className="v4-preview">
                <div className="v4-poll">
                  <div className="v4-poll-glow" />
                  <span className="v4-poll-eyebrow">Live poll</span>
                  <span className="v4-poll-meta">14 ft · birdie</span>
                  <p className="v4-poll-question">
                    Niemann's 14-footer. Drops?
                  </p>
                  <p className="v4-poll-baseline">
                    Tour <strong>22%</strong> from here · Niemann{" "}
                    <strong>+1.8 SG putt/rd</strong> this week
                  </p>
                  <div className="v4-poll-buttons">
                    <button type="button" className="v4-poll-btn v4-poll-btn-yes">
                      Yes · drops
                    </button>
                    <button type="button" className="v4-poll-btn v4-poll-btn-no">
                      No · misses
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 14,
            margin: "32px 0 0",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.55,
          }}
        >
          <div>
            <p style={{ fontWeight: 800, marginBottom: 4 }}>Current</p>
            Light mode default. Green chips and emoji-led chrome.
            Generous padding, rounded cards. Carries the daily-puzzle
            heritage — friendly, social, casual.
          </div>
          <div>
            <p style={{ fontWeight: 800, marginBottom: 4 }}>
              V2 · trading terminal
            </p>
            Dark default. Monospace tabular numerals, uppercase
            letter-spaced labels, 4-6px radii, SVG icons, cyan live
            indicators. Feels like a power tool for serious bettors.
          </div>
          <div>
            <p style={{ fontWeight: 800, marginBottom: 4 }}>V3 · editorial</p>
            Light, generous typography, serif headlines (Charter /
            Source Serif), prose-style copy, deep forest green + gold
            accents. Feels like a premium publication that happens to
            be live.
          </div>
          <div>
            <p style={{ fontWeight: 800, marginBottom: 4 }}>V4 · Real energy</p>
            Deep black, big bold sans (no monospace), saturated
            electric green, avatar circles for players, pill-shaped
            CTAs with shadow glow, hot-dot indicators. Feels like a
            social-tech app you tap on tap on tap.
          </div>
        </div>
      </main>
    </>
  );
}
