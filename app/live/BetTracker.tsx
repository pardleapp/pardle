"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import {
  formatOdds,
  parseOdds as parseOddsShared,
  type OddsFormat,
} from "@/lib/odds-format";

const STORAGE_KEY = "pardle_bets_v2";
const LEGACY_KEY = "pardle_bets_v1";

type BetKind = "outright" | "round-score";

/** One PnL sample for the per-bet history chart. */
interface PnlSample {
  t: number; // epoch ms
  v: number; // bet's "current value" in £
}

interface OutrightBet {
  id: string;
  kind: "outright";
  playerId: string;
  playerName: string;
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
}

interface RoundScoreBet {
  id: string;
  kind: "round-score";
  playerId: string;
  playerName: string;
  /** The round the bet applies to. `null` = "current round, whichever's live". */
  round: number | null;
  /** Score line — e.g. 69.5. */
  line: number;
  side: "under" | "over";
  oddsTaken: number;
  oddsTakenLabel: string;
  stake: number;
  placedAt: number;
}

type TrackedBet = OutrightBet | RoundScoreBet;

interface RoundSnapshot {
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  status: "not-started" | "in-progress" | "complete";
}

interface PlayerRoundState {
  currentRound: number;
  holesPlayed: number;
  holesRemaining: number;
  strokes: number;
  parPlayed: number;
  parRemaining: number;
  roundPar: number;
  toPar: number;
  ttdPacePerHole: number;
  ttdHoles: number;
  rounds: Record<number, RoundSnapshot>;
}

interface OddsHistorySample {
  ts: number;
  p: number; // decimal odds
}

interface FeedRowLike {
  event: {
    id: string;
    type: string;
    playerId: string;
    round: number;
    hole?: number;
    par?: number;
    strokes?: number;
    ts: number;
  };
}

interface Props {
  players: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  /** Per-player decimal-odds samples (server-side rolling buffer). */
  oddsHistories: Record<string, OddsHistorySample[] | null>;
  playerRoundStates: Record<string, PlayerRoundState>;
  /** The visible feed rows — used to reconstruct round-score history. */
  feedEvents: FeedRowLike[];
  oddsFormat: OddsFormat;
}

function readBets(): TrackedBet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Migrate legacy bets that don't carry a `kind` field.
    return (parsed as Array<Partial<TrackedBet>>).map((b) => {
      if (!b.kind) return { ...(b as OutrightBet), kind: "outright" };
      return b as TrackedBet;
    });
  } catch {
    return [];
  }
}

function writeBets(bets: TrackedBet[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  // Legacy bucket no longer used — clean up.
  window.localStorage.removeItem(LEGACY_KEY);
}

/**
 * Wrap the shared odds parser so a saved bet remembers its original
 * label in the user's preferred format (we re-format on display via
 * `formatOdds` anyway, but the stored label is a useful fallback if
 * the format helper ever regresses).
 */
function parseOdds(
  input: string,
  preferredFormat: OddsFormat,
): { decimal: number; label: string } | null {
  const parsed = parseOddsShared(input);
  if (!parsed) return null;
  return { decimal: parsed.decimal, label: formatOdds(parsed.decimal, preferredFormat) };
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

// ── Normal-distribution helpers (no external dep) ──────────────────
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normalCdf(x: number, mean: number, sd: number): number {
  if (sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

/** Per-remaining-hole stroke variance — empirical PGA Tour estimate. */
const PER_HOLE_VAR = 0.65;

/**
 * Compute the "current value" of any bet (outright or round-score)
 * in a single place so totals, row rendering, and history sampling
 * all see the same number. Returns null when we have no data to
 * value the bet against (e.g. the player isn't priced on Polymarket
 * yet, or their snapshot data hasn't landed). Settled bets return
 * their final payout (won) or 0 (lost).
 */
function currentValueForBet(
  b: TrackedBet,
  currentOdds: Record<string, number>,
  playerRoundStates: Record<string, PlayerRoundState>,
): number | null {
  if (b.kind === "outright") {
    const fair = currentOdds[b.playerId];
    if (!Number.isFinite(fair) || fair <= 1) return null;
    return b.stake * (b.oddsTaken / fair);
  }
  const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
  if (!ev) return null;
  if (ev.kind === "not-started") return b.stake;
  if (ev.kind === "settled") return ev.won ? b.stake * b.oddsTaken : 0;
  // In-progress
  if (ev.prob >= 1) return b.stake * b.oddsTaken;
  if (ev.prob <= 0) return 0;
  return b.stake * (b.oddsTaken / (1 / ev.prob));
}

/** Outcome of evaluating a round-score bet. */
type RoundScoreEval =
  | { kind: "not-started"; round: number }
  | { kind: "in-progress"; round: number; prob: number; round_state: RoundSnapshot }
  | { kind: "settled"; round: number; won: boolean; finalStrokes: number };

/**
 * Resolve which round the bet is targeting:
 * - If bet.round is set → that round
 * - Otherwise → state.currentRound (live or next-up)
 */
function resolveBetRound(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
): number | null {
  if (bet.round != null) return bet.round;
  return state?.currentRound ?? null;
}

/**
 * Evaluate a round-score bet against the player's state.
 * - not-started → flat PnL (bet value = stake, profit = 0)
 * - in-progress → Normal projection (current pace blended with TTD pace)
 * - settled → won/lost based on final strokes vs line
 */
function evaluateRoundScore(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
): RoundScoreEval | null {
  if (!state) return null;
  const round = resolveBetRound(bet, state);
  if (round == null) return null;
  const r = state.rounds?.[round];
  if (!r) return { kind: "not-started", round };

  if (r.status === "not-started") {
    return { kind: "not-started", round };
  }
  if (r.status === "complete") {
    const won =
      bet.side === "under" ? r.strokes < bet.line : r.strokes > bet.line;
    return { kind: "settled", round, won, finalStrokes: r.strokes };
  }
  // In progress — project final.
  const currentPace =
    r.holesPlayed > 0 ? (r.strokes - r.parPlayed) / r.holesPlayed : 0;
  const w = Math.min(1, r.holesPlayed / 9);
  const blendedPace = w * currentPace + (1 - w) * state.ttdPacePerHole;
  const expectedRemainingStrokes =
    r.parRemaining + r.holesRemaining * blendedPace;
  const expectedFinal = r.strokes + expectedRemainingStrokes;
  const sd = Math.sqrt(r.holesRemaining * PER_HOLE_VAR);
  const prob =
    bet.side === "under"
      ? normalCdf(bet.line, expectedFinal, sd)
      : 1 - normalCdf(bet.line, expectedFinal, sd);
  return { kind: "in-progress", round, prob, round_state: r };
}

export default function BetTracker({
  players,
  currentOdds,
  oddsHistories,
  playerRoundStates,
  feedEvents,
  oddsFormat,
}: Props) {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setBets(readBets());
    setHydrated(true);
  }, []);

  function addBet(b: TrackedBet) {
    const next = [...bets, b];
    setBets(next);
    writeBets(next);
  }

  function removeBet(id: string) {
    const next = bets.filter((b) => b.id !== id);
    setBets(next);
    writeBets(next);
  }

  // Per-bet current value, computed once per render and reused by
  // totals + each row.
  const valueByBet = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const b of bets) out.set(b.id, currentValueForBet(b, currentOdds, playerRoundStates));
    return out;
  }, [bets, currentOdds, playerRoundStates]);

  const totals = useMemo(() => {
    let stake = 0;
    let value = 0;
    let valued = 0;
    for (const b of bets) {
      stake += b.stake;
      const v = valueByBet.get(b.id);
      if (v == null) continue;
      value += v;
      valued += b.stake;
    }
    return { stake, value, valued, hasValue: valued > 0 };
  }, [bets, valueByBet]);

  if (!hydrated) return null;

  return (
    <section className="bets">
      <div className="bets-head">
        <h3 className="bets-title">
          💷 My bets{bets.length > 0 ? ` · ${bets.length}` : ""}
        </h3>
        <button
          type="button"
          className="bets-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : bets.length === 0 ? "Add a bet" : "+ Add"}
        </button>
      </div>

      {bets.length > 0 && (
        <ul className="bets-list">
          {bets.map((b) => {
            const expanded = expandedId === b.id;
            const toggle = () =>
              setExpandedId((cur) => (cur === b.id ? null : b.id));
            const row =
              b.kind === "outright" ? (
                <OutrightRow
                  bet={b}
                  currentOdds={currentOdds}
                  oddsFormat={oddsFormat}
                  expanded={expanded}
                  onToggle={toggle}
                  onRemove={() => removeBet(b.id)}
                />
              ) : (
                <RoundScoreRow
                  bet={b}
                  state={playerRoundStates[b.playerId]}
                  oddsFormat={oddsFormat}
                  expanded={expanded}
                  onToggle={toggle}
                  onRemove={() => removeBet(b.id)}
                />
              );
            return (
              <li
                key={b.id}
                className={`bets-row-wrap ${expanded ? "bets-row-wrap-open" : ""}`}
              >
                {row}
                {expanded && (
                  <BetChart
                    bet={b}
                    stake={b.stake}
                    history={reconstructHistory(
                      b,
                      oddsHistories,
                      playerRoundStates,
                      feedEvents,
                      valueByBet.get(b.id) ?? null,
                    )}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {bets.length > 0 && totals.hasValue && (
        <p className="bets-totals">
          Staked <strong>{gbp.format(totals.valued)}</strong> · Worth now{" "}
          <strong
            className={
              totals.value > totals.valued
                ? "bets-profit-up"
                : totals.value < totals.valued
                ? "bets-profit-down"
                : ""
            }
          >
            {gbp.format(totals.value)}
          </strong>{" "}
          ({totals.value >= totals.valued ? "+" : ""}
          {gbp.format(totals.value - totals.valued)})
        </p>
      )}

      {open && (
        <AddBetForm
          players={players}
          oddsFormat={oddsFormat}
          onAdd={(b) => {
            addBet(b);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}

      {bets.length === 0 && !open && (
        <p className="bets-empty">
          Log a bet — outright winner, round score under/over — to see it valued
          live as the round unfolds.
        </p>
      )}
    </section>
  );
}

function OutrightRow({
  bet,
  currentOdds,
  oddsFormat,
  expanded,
  onToggle,
  onRemove,
}: {
  bet: OutrightBet;
  currentOdds: Record<string, number>;
  oddsFormat: OddsFormat;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const fair = currentOdds[bet.playerId];
  const haveFair = Number.isFinite(fair) && fair > 1;
  const currentValue = haveFair ? bet.stake * (bet.oddsTaken / fair) : null;
  const profit = currentValue !== null ? currentValue - bet.stake : null;
  const profitClass =
    profit === null
      ? ""
      : profit > 0
      ? "bets-profit-up"
      : profit < 0
      ? "bets-profit-down"
      : "";
  return (
    <div
      className={`bets-row ${expanded ? "bets-row-expanded" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="bets-row-main">
        <p className="bets-row-name">{bet.playerName}</p>
        <p className="bets-row-meta">
          Win @ {formatOdds(bet.oddsTaken, oddsFormat)} ·{" "}
          {gbp.format(bet.stake)}
          {haveFair && <> · now {formatOdds(fair, oddsFormat)}</>}
        </p>
      </div>
      <div className={`bets-row-value ${profitClass}`}>
        {currentValue !== null ? (
          <>
            <strong>{gbp.format(currentValue)}</strong>
            <span>
              {profit !== null && profit >= 0 ? "+" : ""}
              {profit !== null ? gbp.format(profit) : ""}
            </span>
          </>
        ) : (
          <span className="bets-row-pending">—</span>
        )}
      </div>
      <button
        type="button"
        className="bets-row-x"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove bet"
        title="Remove this bet"
      >
        ✕
      </button>
    </div>
  );
}

function RoundScoreRow({
  bet,
  state,
  oddsFormat,
  expanded,
  onToggle,
  onRemove,
}: {
  bet: RoundScoreBet;
  state: PlayerRoundState | undefined;
  oddsFormat: OddsFormat;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const ev = evaluateRoundScore(bet, state);
  const roundLabel = bet.round != null ? `R${bet.round}` : "current round";

  let stateText: string;
  let valueBlock: JSX.Element;
  let profitClass = "";

  if (!ev) {
    stateText = "Waiting on data…";
    valueBlock = <span className="bets-row-pending">—</span>;
  } else if (ev.kind === "not-started") {
    stateText = `R${ev.round} not started yet`;
    valueBlock = (
      <>
        <strong>{gbp.format(bet.stake)}</strong>
        <span>+£0.00</span>
      </>
    );
  } else if (ev.kind === "settled") {
    profitClass = ev.won ? "bets-profit-up" : "bets-profit-down";
    stateText = `R${ev.round} final ${ev.finalStrokes} — ${ev.won ? "WON" : "LOST"}`;
    valueBlock = (
      <strong className={profitClass}>
        {ev.won
          ? `+${gbp.format(bet.stake * (bet.oddsTaken - 1))}`
          : `-${gbp.format(bet.stake)}`}
      </strong>
    );
  } else {
    const r = ev.round_state;
    const fairDecimal = ev.prob > 0 ? 1 / ev.prob : null;
    const currentValue =
      fairDecimal != null && ev.prob < 1
        ? bet.stake * (bet.oddsTaken / fairDecimal)
        : ev.prob === 1
        ? bet.stake * bet.oddsTaken
        : 0;
    const profit = currentValue - bet.stake;
    profitClass = profit > 0 ? "bets-profit-up" : profit < 0 ? "bets-profit-down" : "";
    stateText = `R${ev.round}: ${r.strokes} thru ${r.holesPlayed} (${r.toPar >= 0 ? "+" : ""}${r.toPar}) · ${r.holesRemaining} to play`;
    valueBlock = (
      <>
        <strong>{gbp.format(currentValue)}</strong>
        <span>
          {profit >= 0 ? "+" : ""}
          {gbp.format(profit)}
        </span>
      </>
    );
  }

  return (
    <div
      className={`bets-row ${expanded ? "bets-row-expanded" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="bets-row-main">
        <p className="bets-row-name">
          {bet.playerName}{" "}
          <span className="bets-row-kind">
            {bet.side} {bet.line} · {roundLabel}
          </span>
        </p>
        <p className="bets-row-meta">
          @ {formatOdds(bet.oddsTaken, oddsFormat)} · {gbp.format(bet.stake)} ·{" "}
          {stateText}
        </p>
        {ev?.kind === "in-progress" && (
          <p className="bets-row-meta">
            Model: {Math.round(ev.prob * 100)}% chance · fair{" "}
            {ev.prob > 0 && ev.prob < 1
              ? formatOdds(1 / ev.prob, oddsFormat)
              : "—"}
          </p>
        )}
      </div>
      <div className={`bets-row-value ${profitClass}`}>{valueBlock}</div>
      <button
        type="button"
        className="bets-row-x"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove bet"
        title="Remove this bet"
      >
        ✕
      </button>
    </div>
  );
}

// ── Add-bet form ───────────────────────────────────────────────────

function AddBetForm({
  players,
  oddsFormat,
  onAdd,
  onCancel,
}: {
  players: CachedLeaderboardRow[];
  oddsFormat: OddsFormat;
  onAdd: (b: TrackedBet) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BetKind>("outright");
  const [playerQ, setPlayerQ] = useState("");
  const [pickedPlayer, setPickedPlayer] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [oddsText, setOddsText] = useState("");
  const [stakeText, setStakeText] = useState("");
  const [lineText, setLineText] = useState("");
  const [side, setSide] = useState<"under" | "over">("under");
  const [roundText, setRoundText] = useState<string>(""); // "", "1", "2", "3", "4"
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = playerQ.toLowerCase().trim();
    if (!needle) return players.slice(0, 6);
    return players
      .filter((p) => p.displayName.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [playerQ, players]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pickedPlayer) return setErr("Pick a player from the list.");
    const odds = parseOdds(oddsText, oddsFormat);
    if (!odds) return setErr("Enter odds like +250, -150, 8/1, or 9.0.");
    const stake = Number(stakeText);
    if (!Number.isFinite(stake) || stake <= 0) {
      return setErr("Enter a positive stake.");
    }
    const placedAt = Date.now();
    const id = `b${placedAt.toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    if (kind === "outright") {
      onAdd({
        kind: "outright",
        id,
        placedAt,
        playerId: pickedPlayer.id,
        playerName: pickedPlayer.name,
        oddsTaken: odds.decimal,
        oddsTakenLabel: odds.label,
        stake,
      });
      return;
    }

    const line = Number(lineText);
    if (!Number.isFinite(line) || line <= 50 || line >= 90) {
      return setErr("Enter a realistic round-score line, e.g. 69.5.");
    }
    const roundN = roundText === "" ? null : Number(roundText);
    if (roundN !== null && (roundN < 1 || roundN > 4)) {
      return setErr("Pick a round between 1 and 4.");
    }
    onAdd({
      kind: "round-score",
      id,
      placedAt,
      playerId: pickedPlayer.id,
      playerName: pickedPlayer.name,
      round: roundN,
      line,
      side,
      oddsTaken: odds.decimal,
      oddsTakenLabel: odds.label,
      stake,
    });
  }

  return (
    <form className="bets-form" onSubmit={submit}>
      <div className="bets-form-kind">
        <button
          type="button"
          className={kind === "outright" ? "bets-kind-on" : ""}
          onClick={() => setKind("outright")}
        >
          Outright winner
        </button>
        <button
          type="button"
          className={kind === "round-score" ? "bets-kind-on" : ""}
          onClick={() => setKind("round-score")}
        >
          Round score
        </button>
      </div>

      {pickedPlayer ? (
        <div className="bets-form-picked">
          <span>
            <strong>{pickedPlayer.name}</strong>
          </span>
          <button
            type="button"
            className="bets-form-change"
            onClick={() => setPickedPlayer(null)}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            placeholder="Search a player…"
            value={playerQ}
            onChange={(e) => setPlayerQ(e.target.value)}
            className="bets-form-input"
            autoFocus
          />
          {filtered.length > 0 && (
            <ul className="bets-form-suggest">
              {filtered.map((p) => (
                <li key={p.playerId}>
                  <button
                    type="button"
                    onClick={() =>
                      setPickedPlayer({ id: p.playerId, name: p.displayName })
                    }
                  >
                    {p.displayName}
                    <span className="bets-form-suggest-meta">
                      {p.position} · {p.total}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {pickedPlayer && (
        <>
          {kind === "round-score" && (
            <>
              <div className="bets-form-row">
                <label className="bets-form-label">
                  <span>Round</span>
                  <select
                    value={roundText}
                    onChange={(e) => setRoundText(e.target.value)}
                  >
                    <option value="">Auto (current/next)</option>
                    <option value="1">R1</option>
                    <option value="2">R2</option>
                    <option value="3">R3</option>
                    <option value="4">R4</option>
                  </select>
                </label>
                <label className="bets-form-label">
                  <span>Side</span>
                  <select
                    value={side}
                    onChange={(e) =>
                      setSide(e.target.value as "under" | "over")
                    }
                  >
                    <option value="under">Under</option>
                    <option value="over">Over</option>
                  </select>
                </label>
              </div>
              <label className="bets-form-label">
                <span>Line (e.g. 69.5)</span>
                <input
                  type="number"
                  step="0.5"
                  placeholder="69.5"
                  value={lineText}
                  onChange={(e) => setLineText(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            </>
          )}
          <div className="bets-form-row">
            <label className="bets-form-label">
              <span>Odds</span>
              <input
                type="text"
                placeholder="+250, -150, 8/1, 9.0"
                value={oddsText}
                onChange={(e) => setOddsText(e.target.value)}
                inputMode="text"
                autoComplete="off"
                autoFocus
              />
            </label>
            <label className="bets-form-label">
              <span>Stake (£)</span>
              <input
                type="number"
                placeholder="10"
                value={stakeText}
                onChange={(e) => setStakeText(e.target.value)}
                inputMode="decimal"
                step="0.01"
                min="0"
              />
            </label>
          </div>
          {err && <p className="bets-form-err">{err}</p>}
          <div className="bets-form-actions">
            <button
              type="button"
              className="bets-form-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" className="bets-form-submit">
              Add bet
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// ── History reconstruction ─────────────────────────────────────────

/**
 * Build the bet's value-over-time series from data the server already
 * tracks (odds buffer + score events) — so the chart shows real
 * history covering periods when the user wasn't on the page.
 *
 * Outright bets: walk the odds-history samples for the player from
 * `placedAt` onwards. Each sample yields a value point.
 *
 * Round-score bets: walk the player's completed-hole events in the
 * targeted round, oldest first. Each hole completed yields a new
 * (strokes, holesPlayed, parPlayed) state which we run through the
 * same projection model the row uses.
 */
function reconstructHistory(
  bet: TrackedBet,
  oddsHistories: Record<string, OddsHistorySample[] | null>,
  playerRoundStates: Record<string, PlayerRoundState>,
  feedEvents: FeedRowLike[],
  nowValue: number | null,
): PnlSample[] {
  const series: PnlSample[] = [];
  // Anchor with the stake at placed-time.
  series.push({ t: bet.placedAt, v: bet.stake });

  if (bet.kind === "outright") {
    const samples = oddsHistories[bet.playerId] ?? [];
    for (const s of samples) {
      if (s.ts < bet.placedAt) continue;
      if (!Number.isFinite(s.p) || s.p <= 1) continue;
      const v = bet.stake * (bet.oddsTaken / s.p);
      // Skip near-duplicates so the line isn't pixel-noise.
      const last = series[series.length - 1];
      if (Math.abs(v - last.v) < 0.05 && s.ts - last.t < 60_000) continue;
      series.push({ t: s.ts, v });
    }
  } else {
    // Round-score: rebuild round state hole-by-hole.
    const state = playerRoundStates[bet.playerId];
    const round =
      bet.round != null ? bet.round : state?.currentRound ?? null;
    if (round == null) {
      if (nowValue != null) series.push({ t: Date.now(), v: nowValue });
      return series;
    }
    const roundSnap = state?.rounds?.[round];
    // Collect score events for this player+round from the visible feed.
    const events = feedEvents
      .filter(
        (r) =>
          r.event.type === "score" &&
          r.event.playerId === bet.playerId &&
          r.event.round === round &&
          r.event.ts >= bet.placedAt &&
          typeof r.event.strokes === "number" &&
          typeof r.event.par === "number" &&
          typeof r.event.hole === "number",
      )
      .sort((a, b) => a.event.ts - b.event.ts);

    if (!roundSnap || (events.length === 0 && roundSnap.status === "not-started")) {
      // Round hasn't moved since placedAt — flat line, value = stake.
      if (nowValue != null && Math.abs(nowValue - bet.stake) > 0.01) {
        series.push({ t: Date.now(), v: nowValue });
      }
      return series;
    }

    // Walk events accumulating round state.
    let strokes = 0;
    let parPlayed = 0;
    let holesPlayed = 0;
    const roundPar = roundSnap.roundPar;
    for (const r of events) {
      strokes += r.event.strokes!;
      parPlayed += r.event.par!;
      holesPlayed++;
      const holesRemaining = 18 - holesPlayed;
      const parRemaining = roundPar - parPlayed;
      const v = roundScoreValueAt(
        bet,
        strokes,
        parPlayed,
        holesPlayed,
        parRemaining,
        holesRemaining,
        state?.ttdPacePerHole ?? 0,
      );
      if (v != null) series.push({ t: r.event.ts, v });
    }
  }

  // Make sure the latest server-known value lands on the chart.
  if (nowValue != null) {
    const last = series[series.length - 1];
    if (Math.abs(nowValue - last.v) > 0.01) {
      series.push({ t: Date.now(), v: nowValue });
    }
  }
  return series;
}

function roundScoreValueAt(
  bet: RoundScoreBet,
  strokes: number,
  parPlayed: number,
  holesPlayed: number,
  parRemaining: number,
  holesRemaining: number,
  ttdPacePerHole: number,
): number | null {
  if (holesRemaining === 0) {
    const won =
      bet.side === "under" ? strokes < bet.line : strokes > bet.line;
    return won ? bet.stake * bet.oddsTaken : 0;
  }
  const currentPace = holesPlayed > 0 ? (strokes - parPlayed) / holesPlayed : 0;
  const w = Math.min(1, holesPlayed / 9);
  const blendedPace = w * currentPace + (1 - w) * ttdPacePerHole;
  const expectedFinal = strokes + parRemaining + holesRemaining * blendedPace;
  const sd = Math.sqrt(holesRemaining * PER_HOLE_VAR);
  const z = (bet.line - expectedFinal) / (sd * Math.SQRT2);
  const cdf = 0.5 * (1 + erf(z));
  const prob = bet.side === "under" ? cdf : 1 - cdf;
  if (prob <= 0) return 0;
  if (prob >= 1) return bet.stake * bet.oddsTaken;
  return bet.stake * (bet.oddsTaken / (1 / prob));
}

// ── PnL-over-time chart ────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 100;
const CHART_PAD = 8;

/** Inline SVG line chart of a bet's value over time, reconstructed
 *  from server-tracked data (odds buffer for outrights, completed-hole
 *  events for round-score bets). Covers the period from placedAt to
 *  now even if the user wasn't viewing the page in between. Shows the
 *  stake as a dashed baseline; profit area tints green above, loss
 *  area red below. */
function BetChart({
  bet,
  stake,
  history,
}: {
  bet: TrackedBet;
  stake: number;
  history: PnlSample[];
}) {
  if (history.length < 2) {
    return (
      <div className="bets-chart-empty">
        Not enough price moves yet to chart — the line will fill in as
        odds move or as the round plays out.
      </div>
    );
  }

  const ts = history.map((h) => h.t);
  const vs = history.map((h) => h.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const vMin = Math.min(...vs, stake);
  const vMax = Math.max(...vs, stake);
  const tRange = Math.max(1, tMax - tMin);
  // Pad the value range so a flat line doesn't paint along the edge.
  const vPad = Math.max((vMax - vMin) * 0.15, stake * 0.05, 0.5);
  const yLo = vMin - vPad;
  const yHi = vMax + vPad;
  const yRange = Math.max(0.001, yHi - yLo);

  const xOf = (t: number) =>
    CHART_PAD + ((t - tMin) / tRange) * (CHART_W - CHART_PAD * 2);
  const yOf = (v: number) =>
    CHART_H - CHART_PAD - ((v - yLo) / yRange) * (CHART_H - CHART_PAD * 2);

  const stakeY = yOf(stake);
  const linePath = history
    .map((h, i) => `${i === 0 ? "M" : "L"}${xOf(h.t)},${yOf(h.v)}`)
    .join(" ");
  // Build area paths above/below the stake baseline so we can tint
  // profit-green and loss-red.
  const areaPoints = history
    .map((h) => `${xOf(h.t)},${yOf(h.v)}`)
    .join(" ");
  const profitArea = `M${xOf(history[0].t)},${stakeY} L ${areaPoints} L ${xOf(history[history.length - 1].t)},${stakeY} Z`;

  const lastV = vs[vs.length - 1];
  const profit = lastV - stake;
  const profitClass =
    profit > 0 ? "bets-profit-up" : profit < 0 ? "bets-profit-down" : "";

  return (
    <div className="bets-chart">
      <div className="bets-chart-summary">
        <span>Stake {gbp.format(stake)}</span>
        <span className={profitClass}>
          {profit >= 0 ? "+" : ""}
          {gbp.format(profit)} now
        </span>
        <span className="bets-chart-meta">
          {history.length} sample{history.length === 1 ? "" : "s"}
        </span>
      </div>
      <svg
        className="bets-chart-svg"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={`pnl-up-${bet.id}`}>
            <rect x={0} y={0} width={CHART_W} height={stakeY} />
          </clipPath>
          <clipPath id={`pnl-down-${bet.id}`}>
            <rect
              x={0}
              y={stakeY}
              width={CHART_W}
              height={CHART_H - stakeY}
            />
          </clipPath>
        </defs>
        {/* Profit area (green tint, clipped above the stake line) */}
        <path
          d={profitArea}
          fill="rgba(123, 174, 63, 0.18)"
          clipPath={`url(#pnl-up-${bet.id})`}
        />
        {/* Loss area (red tint, clipped below) */}
        <path
          d={profitArea}
          fill="rgba(224, 91, 91, 0.16)"
          clipPath={`url(#pnl-down-${bet.id})`}
        />
        {/* Stake baseline */}
        <line
          x1={CHART_PAD}
          y1={stakeY}
          x2={CHART_W - CHART_PAD}
          y2={stakeY}
          stroke="rgba(128,128,128,0.55)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {/* Value line */}
        <path
          d={linePath}
          fill="none"
          stroke="#2ea7f0"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Latest point dot */}
        <circle
          cx={xOf(ts[ts.length - 1])}
          cy={yOf(vs[vs.length - 1])}
          r={3}
          fill="#2ea7f0"
        />
      </svg>
    </div>
  );
}
