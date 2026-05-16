"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type JSX } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";
import {
  formatOdds,
  parseOdds as parseOddsShared,
  type OddsFormat,
} from "@/lib/odds-format";
import {
  anchoredValue,
  currentValueForBet,
  evaluateRoundScore,
  patchLegacyPlacement,
  readBets,
  snapshotForPlacement,
  writeBets,
  type OutrightBet,
  type PlayerRoundState,
  type RoundScoreBet,
  type TrackedBet,
} from "./bet-shared";

type BetKind = "outright" | "round-score";

interface Props {
  players: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  playerRoundStates: Record<string, PlayerRoundState>;
  oddsFormat: OddsFormat;
}

function parseOdds(
  input: string,
  preferredFormat: OddsFormat,
): { decimal: number; label: string } | null {
  const parsed = parseOddsShared(input);
  if (!parsed) return null;
  return {
    decimal: parsed.decimal,
    label: formatOdds(parsed.decimal, preferredFormat),
  };
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export default function BetTracker({
  players,
  currentOdds,
  playerRoundStates,
  oddsFormat,
}: Props) {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBets(readBets());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let dirty = false;
    const patched = bets.map((b) => {
      if (b.kind !== "round-score" || b.placement) return b;
      const next = patchLegacyPlacement(b, playerRoundStates[b.playerId]);
      if (next.placement) {
        dirty = true;
        return next;
      }
      return b;
    });
    if (dirty) {
      setBets(patched);
      writeBets(patched);
    }
  }, [hydrated, playerRoundStates, bets]);

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

  const valueByBet = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const b of bets)
      out.set(b.id, currentValueForBet(b, currentOdds, playerRoundStates));
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
          {bets.map((b) =>
            b.kind === "outright" ? (
              <OutrightRow
                key={b.id}
                bet={b}
                currentOdds={currentOdds}
                oddsFormat={oddsFormat}
                onRemove={() => removeBet(b.id)}
              />
            ) : (
              <RoundScoreRow
                key={b.id}
                bet={b}
                state={playerRoundStates[b.playerId]}
                oddsFormat={oddsFormat}
                onRemove={() => removeBet(b.id)}
              />
            ),
          )}
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
          playerRoundStates={playerRoundStates}
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
          live as the round unfolds. Tap a bet to see the full PnL chart.
        </p>
      )}
    </section>
  );
}

function OutrightRow({
  bet,
  currentOdds,
  oddsFormat,
  onRemove,
}: {
  bet: OutrightBet;
  currentOdds: Record<string, number>;
  oddsFormat: OddsFormat;
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
    <li className="bets-row-wrap">
      <Link href={`/live/bet/${bet.id}`} className="bets-row bets-row-link">
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
      </Link>
      <button
        type="button"
        className="bets-row-x bets-row-x-detached"
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
  oddsFormat,
  onRemove,
}: {
  bet: RoundScoreBet;
  state: PlayerRoundState | undefined;
  oddsFormat: OddsFormat;
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
    const r = ev.roundState;
    const anchorProb = bet.placement?.probAtPlacement ?? 1 / bet.oddsTaken;
    const currentValue = anchoredValue(
      ev.prob,
      anchorProb,
      bet.stake,
      bet.oddsTaken,
    );
    const profit = currentValue - bet.stake;
    profitClass =
      profit > 0 ? "bets-profit-up" : profit < 0 ? "bets-profit-down" : "";
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
    <li className="bets-row-wrap">
      <Link href={`/live/bet/${bet.id}`} className="bets-row bets-row-link">
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
      </Link>
      <button
        type="button"
        className="bets-row-x bets-row-x-detached"
        onClick={onRemove}
        aria-label="Remove bet"
        title="Remove this bet"
      >
        ✕
      </button>
    </li>
  );
}

// ── Add-bet form ────────────────────────────────────────────────────

function AddBetForm({
  players,
  playerRoundStates,
  oddsFormat,
  onAdd,
  onCancel,
}: {
  players: CachedLeaderboardRow[];
  playerRoundStates: Record<string, PlayerRoundState>;
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
  const [roundText, setRoundText] = useState<string>("");
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
    const placement = snapshotForPlacement(
      { round: roundN, line, side, oddsTaken: odds.decimal },
      playerRoundStates[pickedPlayer.id],
    );
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
      placement,
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
