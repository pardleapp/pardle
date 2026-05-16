"use client";

import { useEffect, useMemo, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

const STORAGE_KEY = "pardle_bets_v1";

interface TrackedBet {
  id: string;
  playerId: string;
  playerName: string;
  /** Decimal odds the user got at placement. e.g. 9.0 for 8/1. */
  oddsTaken: number;
  /** Whether the user typed the odds in fractional form (purely for display). */
  oddsTakenLabel: string;
  /** Stake in £ (or whatever currency the user thinks in — we don't enforce). */
  stake: number;
  /** epoch ms when the user added it. */
  placedAt: number;
}

interface Props {
  players: CachedLeaderboardRow[];
  /** playerId → current decimal odds (1/probability). */
  currentOdds: Record<string, number>;
}

function readBets(): TrackedBet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackedBet[]) : [];
  } catch {
    return [];
  }
}

function writeBets(bets: TrackedBet[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

/** Parse "5/1", "9/2", "evens", "2.5", or "2.50" into decimal odds. */
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

/** Decimal odds → readable fractional ("4/1", "9/2", "evens"). */
function fractionalDisplay(decimal: number): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  const v = decimal - 1;
  if (Math.abs(v - 1) < 0.05) return "evens";
  // Find the simplest small denominator that approximates v.
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

export default function BetTracker({ players, currentOdds }: Props) {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBets(readBets());
    setHydrated(true);
  }, []);

  function addBet(b: Omit<TrackedBet, "id" | "placedAt">) {
    const id = `b${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const next = [
      ...bets,
      { ...b, id, placedAt: Date.now() } satisfies TrackedBet,
    ];
    setBets(next);
    writeBets(next);
  }

  function removeBet(id: string) {
    const next = bets.filter((b) => b.id !== id);
    setBets(next);
    writeBets(next);
  }

  // ─ Valuation summary (totals across all bets) ─────────────────
  const totals = useMemo(() => {
    let stake = 0;
    let value = 0;
    let valued = 0;
    for (const b of bets) {
      stake += b.stake;
      const fair = currentOdds[b.playerId];
      if (Number.isFinite(fair) && fair > 1) {
        value += b.stake * (b.oddsTaken / fair);
        valued += b.stake;
      }
    }
    return { stake, value, valued, hasValue: valued > 0 };
  }, [bets, currentOdds]);

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
            const fair = currentOdds[b.playerId];
            const haveFair = Number.isFinite(fair) && fair > 1;
            const currentValue = haveFair ? b.stake * (b.oddsTaken / fair) : null;
            const profit = currentValue !== null ? currentValue - b.stake : null;
            const profitClass = profit === null
              ? ""
              : profit > 0
              ? "bets-profit-up"
              : profit < 0
              ? "bets-profit-down"
              : "";
            return (
              <li key={b.id} className="bets-row">
                <div className="bets-row-main">
                  <p className="bets-row-name">{b.playerName}</p>
                  <p className="bets-row-meta">
                    {gbp.format(b.stake)} @ {b.oddsTakenLabel}
                    {haveFair && (
                      <>
                        {" "}· now {fractionalDisplay(fair)}
                      </>
                    )}
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
                  onClick={() => removeBet(b.id)}
                  aria-label="Remove bet"
                  title="Remove this bet"
                >
                  ✕
                </button>
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
          onAdd={(b) => {
            addBet(b);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}

      {bets.length === 0 && !open && (
        <p className="bets-empty">
          Log a bet to see it valued live as odds move during the round.
        </p>
      )}
    </section>
  );
}

function AddBetForm({
  players,
  onAdd,
  onCancel,
}: {
  players: CachedLeaderboardRow[];
  onAdd: (b: Omit<TrackedBet, "id" | "placedAt">) => void;
  onCancel: () => void;
}) {
  const [playerQ, setPlayerQ] = useState("");
  const [pickedPlayer, setPickedPlayer] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [oddsText, setOddsText] = useState("");
  const [stakeText, setStakeText] = useState("");
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
    onAdd({
      playerId: pickedPlayer.id,
      playerName: pickedPlayer.name,
      oddsTaken: odds.decimal,
      oddsTakenLabel: odds.label,
      stake,
    });
  }

  return (
    <form className="bets-form" onSubmit={submit}>
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
