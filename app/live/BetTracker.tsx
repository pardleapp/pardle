"use client";

import { useEffect, useMemo, useState } from "react";
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

function parseOdds(input: string): { decimal: number; label: string } | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (t === "evens" || t === "even" || t === "1/1") {
    return { decimal: 2, label: "evens" };
  }
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (num > 0 && den > 0) {
      return { decimal: 1 + num / den, label: `${num}/${den}` };
    }
  }
  const decimal = Number(t);
  if (Number.isFinite(decimal) && decimal > 1) {
    return { decimal, label: decimal.toFixed(2) };
  }
  return null;
}

function fractionalDisplay(decimal: number): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  const v = decimal - 1;
  if (Math.abs(v - 1) < 0.05) return "evens";
  for (const den of [1, 2, 3, 4, 5, 6, 7, 8, 10]) {
    const num = v * den;
    if (Math.abs(num - Math.round(num)) < 0.07 && Math.round(num) > 0) {
      const n = Math.round(num);
      return den === 1 ? `${n}/1` : `${n}/${den}`;
    }
  }
  return `${v.toFixed(1)}/1`;
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
 * Probability that a round-score bet wins, given the player's current
 * round state. Model:
 *   - blend the player's current-round pace with their
 *     tournament-to-date pace (60/40 once they have ≥6 holes today;
 *     more weight on TTD when current-round sample is small)
 *   - project remaining holes at the blended pace
 *   - Normal approximation around expected final, sd = sqrt(N * 0.65)
 */
function roundScoreFairProb(
  bet: RoundScoreBet,
  state: PlayerRoundState | undefined,
): number | null {
  if (!state) return null;
  // Bet on a specific round and state is a different round → null.
  if (bet.round != null && bet.round !== state.currentRound) return null;

  const { holesPlayed, holesRemaining, strokes, parRemaining, ttdPacePerHole } =
    state;

  if (holesRemaining === 0) {
    // Round is over — bet is settled. Return 1 / 0 to show "won" / "lost".
    const finalScore = strokes;
    return bet.side === "under"
      ? finalScore < bet.line
        ? 1
        : 0
      : finalScore > bet.line
      ? 1
      : 0;
  }

  const currentPace =
    holesPlayed > 0 ? (strokes - (state.parPlayed)) / holesPlayed : 0;
  // Weight current-round pace more once we have a real sample (≥6
  // holes); before then, rely on TTD. Smooth weight via sigmoid.
  const w = Math.min(1, holesPlayed / 9); // 0..1 from 0..9 holes
  const blendedPace = w * currentPace + (1 - w) * ttdPacePerHole;
  const expectedRemainingStrokes =
    parRemaining + holesRemaining * blendedPace;
  const expectedFinal = strokes + expectedRemainingStrokes;
  const sd = Math.sqrt(holesRemaining * PER_HOLE_VAR);

  if (bet.side === "under") {
    // P(final < line) — bet wins when score is strictly less than line.
    // Lines are X.5 so this is equivalent to <= floor(line).
    return normalCdf(bet.line, expectedFinal, sd);
  }
  return 1 - normalCdf(bet.line, expectedFinal, sd);
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
      } else {
        const p = roundScoreFairProb(b, playerRoundStates[b.playerId]);
        if (p != null && p > 0) {
          const fair = 1 / p;
          value += b.stake * (b.oddsTaken / fair);
          valued += b.stake;
        }
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
          {haveFair && <> · now {fractionalDisplay(fair)}</>}
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
  const prob = roundScoreFairProb(bet, state);
  const haveValue = prob != null && prob > 0 && prob < 1;
  const fairDecimal = haveValue ? 1 / prob! : null;
  const currentValue =
    fairDecimal != null ? bet.stake * (bet.oddsTaken / fairDecimal) : null;
  const profit = currentValue !== null ? currentValue - bet.stake : null;
  const profitClass =
    profit === null
      ? ""
      : profit > 0
      ? "bets-profit-up"
      : profit < 0
      ? "bets-profit-down"
      : "";

  // Settlement display: prob = 1 → won, prob = 0 → lost.
  const settled = prob === 1 || prob === 0;
  const settledWon = prob === 1;

  let stateText = "Round not started yet";
  if (state) {
    if (state.holesRemaining === 0) {
      stateText = `${state.strokes} (R${state.currentRound} final, ${state.toPar >= 0 ? "+" : ""}${state.toPar})`;
    } else {
      stateText = `${state.strokes} thru ${state.holesPlayed} (${state.toPar >= 0 ? "+" : ""}${state.toPar}) · ${state.holesRemaining} to play`;
    }
  }

  return (
    <li className="bets-row">
      <div className="bets-row-main">
        <p className="bets-row-name">
          {bet.playerName}{" "}
          <span className="bets-row-kind">
            {bet.side} {bet.line}
            {bet.round ? ` R${bet.round}` : ""}
          </span>
        </p>
        <p className="bets-row-meta">
          @ {bet.oddsTakenLabel} · {gbp.format(bet.stake)} · {stateText}
        </p>
        {prob != null && !settled && (
          <p className="bets-row-meta">
            Model: {Math.round(prob * 100)}% chance · fair{" "}
            {fairDecimal ? fractionalDisplay(fairDecimal) : "—"}
          </p>
        )}
      </div>
      <div className={`bets-row-value ${profitClass}`}>
        {settled ? (
          <strong className={settledWon ? "bets-profit-up" : "bets-profit-down"}>
            {settledWon
              ? `+${gbp.format(bet.stake * (bet.oddsTaken - 1))}`
              : `-${gbp.format(bet.stake)}`}
          </strong>
        ) : currentValue !== null ? (
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
    if (!odds) return setErr("Enter odds like 8/1, evens, or 9.0.");
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
    onAdd({
      kind: "round-score",
      id,
      placedAt,
      playerId: pickedPlayer.id,
      playerName: pickedPlayer.name,
      round: null,
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
            <div className="bets-form-row">
              <label className="bets-form-label">
                <span>Side</span>
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as "under" | "over")}
                >
                  <option value="under">Under</option>
                  <option value="over">Over</option>
                </select>
              </label>
              <label className="bets-form-label">
                <span>Line</span>
                <input
                  type="number"
                  step="0.5"
                  placeholder="69.5"
                  value={lineText}
                  onChange={(e) => setLineText(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            </div>
          )}
          <div className="bets-form-row">
            <label className="bets-form-label">
              <span>Odds</span>
              <input
                type="text"
                placeholder="8/1 or 9.0"
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
