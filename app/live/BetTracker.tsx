"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

const STORAGE_KEY = "pardle_bets_v2";
const LEGACY_KEY = "pardle_bets_v1";

type BetKind = "outright" | "round-score";

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

interface Props {
  players: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  playerRoundStates: Record<string, PlayerRoundState>;
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
 * Parse an odds string in any of the common bookmaker formats:
 *   - American: "+250", "-310"
 *   - Fractional: "8/1", "9/2", "evens"
 *   - Decimal: "9.0", "1.91"
 * Returns null on garbage.
 */
function parseOdds(input: string): { decimal: number; label: string } | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (t === "evens" || t === "even" || t === "1/1") {
    return { decimal: 2, label: "+100" };
  }
  // American odds: leading + or -, integer follows.
  const am = /^([+-])\s*(\d+)$/.exec(t);
  if (am) {
    const sign = am[1];
    const v = Number(am[2]);
    if (v >= 100) {
      const decimal = sign === "+" ? 1 + v / 100 : 1 + 100 / v;
      return { decimal, label: `${sign}${v}` };
    }
  }
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (num > 0 && den > 0) {
      const decimal = 1 + num / den;
      return { decimal, label: americanDisplay(decimal) };
    }
  }
  const decimal = Number(t);
  if (Number.isFinite(decimal) && decimal > 1) {
    return { decimal, label: americanDisplay(decimal) };
  }
  return null;
}

/** Decimal odds → American format ("+250" / "-310" / "+100"). */
function americanDisplay(decimal: number): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  if (Math.abs(decimal - 2) < 0.01) return "+100";
  if (decimal >= 2) {
    return `+${Math.round((decimal - 1) * 100)}`;
  }
  return `-${Math.round(100 / (decimal - 1))}`;
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
  playerRoundStates,
}: Props) {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

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

  const totals = useMemo(() => {
    let stake = 0;
    let value = 0;
    let valued = 0;
    for (const b of bets) {
      stake += b.stake;
      if (b.kind === "outright") {
        const fair = currentOdds[b.playerId];
        if (Number.isFinite(fair) && fair > 1) {
          value += b.stake * (b.oddsTaken / fair);
          valued += b.stake;
        }
        continue;
      }
      // Round-score
      const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
      if (!ev) continue;
      if (ev.kind === "not-started") {
        // Flat: bet currently worth its stake, no PnL.
        value += b.stake;
        valued += b.stake;
      } else if (ev.kind === "in-progress") {
        if (ev.prob > 0 && ev.prob < 1) {
          const fair = 1 / ev.prob;
          value += b.stake * (b.oddsTaken / fair);
          valued += b.stake;
        } else if (ev.prob === 1) {
          value += b.stake * b.oddsTaken;
          valued += b.stake;
        } else {
          valued += b.stake; // adds 0 to value
        }
      } else if (ev.kind === "settled") {
        value += ev.won ? b.stake * b.oddsTaken : 0;
        valued += b.stake;
      }
    }
    return { stake, value, valued, hasValue: valued > 0 };
  }, [bets, currentOdds, playerRoundStates]);

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
            return b.kind === "outright" ? (
              <OutrightRow
                key={b.id}
                bet={b}
                currentOdds={currentOdds}
                onRemove={() => removeBet(b.id)}
              />
            ) : (
              <RoundScoreRow
                key={b.id}
                bet={b}
                state={playerRoundStates[b.playerId]}
                onRemove={() => removeBet(b.id)}
              />
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
  onRemove,
}: {
  bet: OutrightBet;
  currentOdds: Record<string, number>;
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
    <li className="bets-row">
      <div className="bets-row-main">
        <p className="bets-row-name">{bet.playerName}</p>
        <p className="bets-row-meta">
          Win @ {bet.oddsTakenLabel} · {gbp.format(bet.stake)}
          {haveFair && <> · now {americanDisplay(fair)}</>}
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
        onClick={onRemove}
        aria-label="Remove bet"
        title="Remove this bet"
      >
        ✕
      </button>
    </li>
  );
}

function RoundScoreRow({
  bet,
  state,
  onRemove,
}: {
  bet: RoundScoreBet;
  state: PlayerRoundState | undefined;
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
    <li className="bets-row">
      <div className="bets-row-main">
        <p className="bets-row-name">
          {bet.playerName}{" "}
          <span className="bets-row-kind">
            {bet.side} {bet.line} · {roundLabel}
          </span>
        </p>
        <p className="bets-row-meta">
          @ {bet.oddsTakenLabel} · {gbp.format(bet.stake)} · {stateText}
        </p>
        {ev?.kind === "in-progress" && (
          <p className="bets-row-meta">
            Model: {Math.round(ev.prob * 100)}% chance · fair{" "}
            {ev.prob > 0 && ev.prob < 1
              ? americanDisplay(1 / ev.prob)
              : "—"}
          </p>
        )}
      </div>
      <div className={`bets-row-value ${profitClass}`}>{valueBlock}</div>
      <button
        type="button"
        className="bets-row-x"
        onClick={onRemove}
        aria-label="Remove bet"
        title="Remove this bet"
      >
        ✕
      </button>
    </li>
  );
}

// ── Add-bet form ───────────────────────────────────────────────────

function AddBetForm({
  players,
  onAdd,
  onCancel,
}: {
  players: CachedLeaderboardRow[];
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
    const odds = parseOdds(oddsText);
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
