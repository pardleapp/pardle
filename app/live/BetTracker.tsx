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
  detectBetSettlement,
  evaluateRoundScore,
  evaluateWinningScore,
  mergeServerAndLocal,
  patchLegacyPlacement,
  persistBet,
  readBets,
  removeBetEverywhere,
  snapshotForPlacement,
  writeBets,
  type OutrightBet,
  type PlayerRoundState,
  type RoundScoreBet,
  type TopFinishBet,
  type TopFinishProbs,
  type TournamentProjection,
  type TrackedBet,
  type WinningScoreBet,
} from "./bet-shared";
import { useAuth } from "./auth/useAuth";
import { useToast } from "./Toast";
import NotificationPrompt from "./notifications/NotificationPrompt";
import RecentFormSparkline, {
  type RecentEvent,
} from "./RecentFormSparkline";
import { abbreviateName } from "@/lib/text/abbreviate";
import { hapticSuccess } from "@/lib/haptic";
import {
  BET_CURRENCIES,
  DEFAULT_BET_CURRENCY,
  formatBetCurrency,
  normaliseBetCurrency,
  type BetCurrency,
} from "@/lib/format/bet-currency";

const CURRENCY_STORAGE_KEY = "pardle_bet_currency";

function loadBetCurrency(): BetCurrency {
  if (typeof window === "undefined") return DEFAULT_BET_CURRENCY;
  return normaliseBetCurrency(
    window.localStorage.getItem(CURRENCY_STORAGE_KEY),
  );
}

function saveBetCurrency(c: BetCurrency): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CURRENCY_STORAGE_KEY, c);
}

type BetKind = "outright" | "round-score" | "winning-score" | "top-finish";

interface RecentFormEntry {
  name: string;
  recent: RecentEvent[];
}

interface Props {
  players: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections: Record<string, TournamentProjection>;
  /** Model's current top-5 / top-10 / top-20 prob per player. */
  topFinishCurrent?: Record<string, TopFinishProbs>;
  /** Last-N-starts recent form keyed by playerId — sparkline + arrow. */
  recentForm?: Record<string, RecentFormEntry>;
  /** Hot/cold-hand status keyed by playerId. */
  handStatus?: Record<string, "hot" | "cold">;
  oddsFormat: OddsFormat;
  onPickOddsFormat: (fmt: OddsFormat) => void;
}

function recentTrendFor(recent: RecentEvent[]): "up" | "down" | "flat" {
  if (recent.length < 5) return "flat";
  const scoreOf = (e: RecentEvent) =>
    e.finishPos ?? (e.madeCut ? 80 : 90);
  const newer = (scoreOf(recent[0]) + scoreOf(recent[1]) + scoreOf(recent[2])) / 3;
  const older = (scoreOf(recent[3]) + scoreOf(recent[4])) / 2;
  const diff = older - newer;
  if (diff > 8) return "up";
  if (diff < -8) return "down";
  return "flat";
}

function PlayerRowName({
  bet,
  recentForm,
  handStatus,
  children,
}: {
  bet: { playerId: string; playerName: string };
  recentForm: Record<string, RecentFormEntry> | undefined;
  handStatus: Record<string, "hot" | "cold"> | undefined;
  /** Optional override for the name slot — used by top-finish and
   *  round-score rows to include their sub-label inline. */
  children?: JSX.Element | string;
}) {
  const form = recentForm?.[bet.playerId];
  const hand = handStatus?.[bet.playerId];
  return (
    <>
      <p className="bets-row-name">
        {hand && (
          <span
            className={`hand-badge hand-badge-${hand}`}
            aria-hidden="true"
          >
            {hand === "hot" ? "🔥" : "🥶"}
          </span>
        )}
        {children ?? abbreviateName(bet.playerName)}
      </p>
      {form && (
        <RecentFormSparkline
          recent={form.recent}
          trend={recentTrendFor(form.recent)}
          mode="compact"
        />
      )}
    </>
  );
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

// Currency formatting now lives in lib/format/bet-currency; each
// per-bet call site passes bet.currency (falls back to GBP) and
// the BetTracker totals use primaryCurrency derived from the user's
// preference + first-bet currency.

export default function BetTracker({
  players,
  currentOdds,
  playerRoundStates,
  tournamentProjections,
  topFinishCurrent,
  recentForm,
  handStatus,
  oddsFormat,
  onPickOddsFormat,
}: Props) {
  const toast = useToast();
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [open, setOpen] = useState(false);
  const [presetKind, setPresetKind] = useState<BetKind | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Live / settled split — tabs above the list so the user can
  // glance at either category without scrolling through the
  // accordion that used to bury settled bets. Defaults to Live.
  const [activeListTab, setActiveListTab] = useState<"live" | "settled">("live");
  const [betCurrency, setBetCurrency] = useState<BetCurrency>(
    DEFAULT_BET_CURRENCY,
  );
  const { user } = useAuth();

  useEffect(() => {
    setBets(readBets());
    setBetCurrency(loadBetCurrency());
    setHydrated(true);
  }, []);

  // Totals roll into the user's preferred currency picked in the
  // form (saved to localStorage). Per-row displays still honour
  // each bet's own captured currency. Mixed-currency rollups would
  // mislead — keep totals in a single currency until a real
  // FX-rate layer exists.
  const primaryCurrency: BetCurrency = bets[0]?.currency
    ? normaliseBetCurrency(bets[0].currency)
    : betCurrency;

  // When the user signs in, migrate any localStorage-only bets to
  // the server and then load the server's view as the source of
  // truth. Sign-out leaves localStorage in place so anonymous bets
  // still persist for the next session.
  useEffect(() => {
    if (!hydrated || !user) return;
    let cancelled = false;
    (async () => {
      try {
        let local = readBets();
        if (local.length > 0) {
          await fetch("/api/bets/migrate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bets: local }),
          });
        }
        const res = await fetch("/api/bets", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          bets: TrackedBet[];
          removedIds?: string[];
        };
        if (cancelled) return;
        // Drop any local bet the server says was removed elsewhere
        // before merging — otherwise zombies (locally added but
        // removed on another device) hang around forever.
        if (json.removedIds && json.removedIds.length > 0) {
          const removed = new Set(json.removedIds);
          local = local.filter((b) => !removed.has(b.id));
        }
        const merged = mergeServerAndLocal(json.bets ?? [], local);
        setBets(merged);
        writeBets(merged);
      } catch {
        // Network blip — keep localStorage view for now.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, user]);

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
    hapticSuccess();
    // persistBet writes to localStorage AND fire-and-forget POSTs to
    // the server. Anonymous users get a 401 and just keep the local
    // copy; signed-in users get cross-device sync.
    void persistBet(b);
  }

  function removeBet(id: string) {
    const next = bets.filter((b) => b.id !== id);
    setBets(next);
    void removeBetEverywhere(id);
  }

  const settledByBet = useMemo(() => {
    const m = new Map<string, { won: boolean }>();
    for (const b of bets) {
      // 1) Prefer server-stamped settlement (survives tournament
      //    rollovers). Once a bet's settled_at column is set by
      //    notify-poll, that's authoritative.
      if (b.settledAt != null && b.settledWon != null) {
        m.set(b.id, { won: b.settledWon });
        continue;
      }
      // 2) Round-score bets settle per-round — detectBetSettlement
      //    doesn't handle them (it's only outright / top-finish /
      //    winning-score). Use evaluateRoundScore directly so a bet
      //    whose round has completed moves into the Settled tab
      //    even before the server cron has stamped settled_at.
      if (b.kind === "round-score") {
        const ev = evaluateRoundScore(b, playerRoundStates[b.playerId]);
        if (ev?.kind === "settled") {
          m.set(b.id, { won: ev.won });
        }
        continue;
      }
      // 3) Fall back to client-side detection against the active
      //    tournament's leaderboard (covers bets that just settled
      //    this minute, before notify-poll caught up).
      const s = detectBetSettlement(
        b,
        players,
        playerRoundStates,
        tournamentProjections,
      );
      if (s) m.set(b.id, s);
    }
    return m;
  }, [bets, players, playerRoundStates, tournamentProjections]);

  const valueByBet = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const b of bets)
      out.set(
        b.id,
        currentValueForBet(
          b,
          currentOdds,
          playerRoundStates,
          tournamentProjections,
          topFinishCurrent,
          settledByBet.get(b.id) ?? null,
        ),
      );
    return out;
  }, [
    bets,
    currentOdds,
    playerRoundStates,
    tournamentProjections,
    topFinishCurrent,
    settledByBet,
  ]);

  // Split bets into "still in play / pending this week" and "past
  // tournament results". The active list is what the user is
  // tracking for the current event; the settled list is read-only
  // history they can collapse out of the way once the tournament
  // moves on.
  const { activeBets, settledBets } = useMemo(() => {
    const active: TrackedBet[] = [];
    const settled: TrackedBet[] = [];
    for (const b of bets) {
      if (settledByBet.has(b.id)) settled.push(b);
      else active.push(b);
    }
    return { activeBets: active, settledBets: settled };
  }, [bets, settledByBet]);

  const renderRow = (b: TrackedBet) => {
    if (b.kind === "outright")
      return (
        <OutrightRow
          key={b.id}
          bet={b}
          currentOdds={currentOdds}
          oddsFormat={oddsFormat}
          settled={settledByBet.get(b.id) ?? null}
          onRemove={() => removeBet(b.id)}
          recentForm={recentForm}
          handStatus={handStatus}
        />
      );
    if (b.kind === "winning-score")
      return (
        <WinningScoreRow
          key={b.id}
          bet={b}
          projections={tournamentProjections}
          oddsFormat={oddsFormat}
          settled={settledByBet.get(b.id) ?? null}
          onRemove={() => removeBet(b.id)}
        />
      );
    if (b.kind === "top-finish")
      return (
        <TopFinishRow
          key={b.id}
          bet={b}
          probs={topFinishCurrent?.[b.playerId]}
          oddsFormat={oddsFormat}
          settled={settledByBet.get(b.id) ?? null}
          onRemove={() => removeBet(b.id)}
          recentForm={recentForm}
          handStatus={handStatus}
        />
      );
    return (
      <RoundScoreRow
        key={b.id}
        bet={b}
        state={playerRoundStates[b.playerId]}
        oddsFormat={oddsFormat}
        settled={settledByBet.get(b.id) ?? null}
        onRemove={() => removeBet(b.id)}
        recentForm={recentForm}
        handStatus={handStatus}
      />
    );
  };

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
          My bets{bets.length > 0 ? ` · ${bets.length}` : ""}
        </h3>
        <div className="bets-head-actions">
          <div
            className="odds-segment odds-segment-compact"
            role="group"
            aria-label="Odds format"
          >
            {(["american", "fractional", "decimal"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                className={`odds-segment-btn ${
                  oddsFormat === fmt ? "odds-segment-btn-on" : ""
                }`}
                onClick={() => onPickOddsFormat(fmt)}
                aria-pressed={oddsFormat === fmt}
                title={`Show odds as ${fmt}`}
              >
                {fmt === "american"
                  ? "+250"
                  : fmt === "fractional"
                    ? "5/2"
                    : "3.5"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="bets-toggle"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : bets.length === 0 ? "Add a bet" : "+ Add"}
          </button>
        </div>
      </div>

      {user && bets.length > 0 && (
        <button
          type="button"
          className="bets-sync-btn"
          onClick={async () => {
            const local = readBets();
            try {
              const res = await fetch("/api/bets/migrate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ bets: local }),
              });
              if (!res.ok) {
                toast.error(`Sync failed (HTTP ${res.status})`);
                return;
              }
              const j = (await res.json()) as { migrated?: number };
              toast.success(
                `Synced ${j.migrated ?? 0} bet${j.migrated === 1 ? "" : "s"} to server`,
              );
              // Re-pull from server so the freshly-synced bets pick up
              // any settlement state notify-poll has already written.
              const r2 = await fetch("/api/bets", { cache: "no-store" });
              if (r2.ok) {
                const json = (await r2.json()) as {
                  bets: TrackedBet[];
                  removedIds?: string[];
                };
                let localPruned = local;
                if (json.removedIds && json.removedIds.length > 0) {
                  const removed = new Set(json.removedIds);
                  localPruned = local.filter((b) => !removed.has(b.id));
                }
                const merged = mergeServerAndLocal(
                  json.bets ?? [],
                  localPruned,
                );
                setBets(merged);
                writeBets(merged);
              }
            } catch (err) {
              toast.error(
                `Sync error: ${err instanceof Error ? err.message : "unknown"}`,
              );
            }
          }}
        >
          Sync local bets to server
        </button>
      )}

      {bets.length > 0 && (
        <>
          {(activeBets.length > 0 || settledBets.length > 0) && (
            <div
              className="bets-tabs"
              role="tablist"
              aria-label="Bet list filter"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeListTab === "live"}
                className={`bets-tab${
                  activeListTab === "live" ? " bets-tab-on" : ""
                }`}
                onClick={() => setActiveListTab("live")}
              >
                Live
                {activeBets.length > 0 && (
                  <span className="bets-tab-count">
                    {activeBets.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeListTab === "settled"}
                className={`bets-tab${
                  activeListTab === "settled" ? " bets-tab-on" : ""
                }`}
                onClick={() => setActiveListTab("settled")}
              >
                Settled
                {settledBets.length > 0 && (
                  <span className="bets-tab-count">
                    {settledBets.length}
                  </span>
                )}
              </button>
            </div>
          )}
          {activeListTab === "live" ? (
            activeBets.length > 0 ? (
              <ul className="bets-list">{activeBets.map(renderRow)}</ul>
            ) : (
              <p className="bets-empty-tab">
                No live bets right now.
                {settledBets.length > 0 && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="bets-empty-link"
                      onClick={() => setActiveListTab("settled")}
                    >
                      See settled →
                    </button>
                  </>
                )}
              </p>
            )
          ) : settledBets.length > 0 ? (
            <ul className="bets-list bets-list-past">
              {settledBets.map(renderRow)}
            </ul>
          ) : (
            <p className="bets-empty-tab">No settled bets yet.</p>
          )}
        </>
      )}

      {bets.length > 0 && totals.hasValue && (
        <p className="bets-totals">
          Staked{" "}
          <strong>
            {formatBetCurrency(totals.valued, primaryCurrency)}
          </strong>{" "}
          · Worth now{" "}
          <strong
            className={
              totals.value > totals.valued
                ? "bets-profit-up"
                : totals.value < totals.valued
                ? "bets-profit-down"
                : ""
            }
          >
            {formatBetCurrency(totals.value, primaryCurrency)}
          </strong>{" "}
          ({totals.value >= totals.valued ? "+" : ""}
          {formatBetCurrency(totals.value - totals.valued, primaryCurrency)})
        </p>
      )}

      {open && (
        <AddBetForm
          players={players}
          playerRoundStates={playerRoundStates}
          tournamentProjections={tournamentProjections}
          recentForm={recentForm}
          handStatus={handStatus}
          oddsFormat={oddsFormat}
          initialKind={presetKind ?? "outright"}
          currency={betCurrency}
          onCurrencyChange={(c) => {
            setBetCurrency(c);
            saveBetCurrency(c);
          }}
          onAdd={(b) => {
            addBet(b);
            setOpen(false);
            setPresetKind(null);
          }}
          onCancel={() => {
            setOpen(false);
            setPresetKind(null);
          }}
        />
      )}

      {bets.length === 0 && !open && (
        <div className="bets-empty-state">
          <h3 className="bets-empty-title">Track your first bet</h3>
          <p className="bets-empty-blurb">
            Add a bet from your bookmaker — Pardle shows you the fair
            value live, with the swing on every shot that moves the
            needle.
          </p>
          <div className="bets-empty-grid">
            <button
              type="button"
              className="bets-empty-tile"
              onClick={() => {
                setPresetKind("outright");
                setOpen(true);
              }}
            >
              <span className="bets-empty-tile-emoji">🏆</span>
              <span className="bets-empty-tile-title">Outright</span>
              <span className="bets-empty-tile-blurb">
                Pick the winner
              </span>
            </button>
            <button
              type="button"
              className="bets-empty-tile"
              onClick={() => {
                setPresetKind("top-finish");
                setOpen(true);
              }}
            >
              <span className="bets-empty-tile-emoji">📈</span>
              <span className="bets-empty-tile-title">Top 5 / 10 / 20</span>
              <span className="bets-empty-tile-blurb">
                Player finishes in the top N
              </span>
            </button>
            <button
              type="button"
              className="bets-empty-tile"
              onClick={() => {
                setPresetKind("round-score");
                setOpen(true);
              }}
            >
              <span className="bets-empty-tile-emoji">⛳</span>
              <span className="bets-empty-tile-title">Round score</span>
              <span className="bets-empty-tile-blurb">
                Under / over a player&apos;s round total
              </span>
            </button>
            <button
              type="button"
              className="bets-empty-tile"
              onClick={() => {
                setPresetKind("winning-score");
                setOpen(true);
              }}
            >
              <span className="bets-empty-tile-emoji">🎯</span>
              <span className="bets-empty-tile-title">Winning score</span>
              <span className="bets-empty-tile-blurb">
                Total strokes of the eventual winner
              </span>
            </button>
          </div>
        </div>
      )}

      <NotificationPrompt betCount={bets.length} />
    </section>
  );
}

function OutrightRow({
  bet,
  currentOdds,
  oddsFormat,
  settled,
  onRemove,
  recentForm,
  handStatus,
}: {
  bet: OutrightBet;
  currentOdds: Record<string, number>;
  oddsFormat: OddsFormat;
  settled: { won: boolean } | null;
  onRemove: () => void;
  recentForm: Record<string, RecentFormEntry> | undefined;
  handStatus: Record<string, "hot" | "cold"> | undefined;
}) {
  const fair = currentOdds[bet.playerId];
  const haveFair = Number.isFinite(fair) && fair > 1;
  const currentValue = settled
    ? settled.won
      ? bet.stake * bet.oddsTaken
      : 0
    : haveFair
      ? bet.stake * (bet.oddsTaken / fair)
      : null;
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
          <PlayerRowName
            bet={bet}
            recentForm={recentForm}
            handStatus={handStatus}
          />
          <p className="bets-row-meta">
            Win @ {formatOdds(bet.oddsTaken, oddsFormat)} ·{" "}
            {formatBetCurrency(bet.stake, bet.currency)}
            {settled ? (
              <> · {settled.won ? "won ✓" : "lost"}</>
            ) : (
              haveFair && <> · now {formatOdds(fair, oddsFormat)}</>
            )}
          </p>
        </div>
        <div className={`bets-row-value ${profitClass}`}>
          {currentValue !== null ? (
            <>
              <strong>{formatBetCurrency(currentValue, bet.currency)}</strong>
              <span>
                {profit !== null && profit >= 0 ? "+" : ""}
                {profit !== null ? formatBetCurrency(profit, bet.currency) : ""}
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

function TopFinishRow({
  bet,
  probs,
  oddsFormat,
  settled,
  onRemove,
  recentForm,
  handStatus,
}: {
  bet: TopFinishBet;
  probs: TopFinishProbs | undefined;
  oddsFormat: OddsFormat;
  settled: { won: boolean } | null;
  onRemove: () => void;
  recentForm: Record<string, RecentFormEntry> | undefined;
  handStatus: Record<string, "hot" | "cold"> | undefined;
}) {
  const prob = probs
    ? bet.cutoff === 5
      ? probs.top5
      : bet.cutoff === 10
      ? probs.top10
      : probs.top20
    : null;
  const haveModel = prob != null && Number.isFinite(prob);
  const currentValue = settled
    ? settled.won
      ? bet.stake * bet.oddsTaken
      : 0
    : haveModel
      ? prob! >= 1
        ? bet.stake * bet.oddsTaken
        : prob! <= 0
          ? 0
          : bet.stake * prob! * bet.oddsTaken
      : null;
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
          <PlayerRowName
            bet={bet}
            recentForm={recentForm}
            handStatus={handStatus}
          >
            <>
              {abbreviateName(bet.playerName)}{" "}
              <span className="bets-row-kind">Top {bet.cutoff}</span>
            </>
          </PlayerRowName>
          <p className="bets-row-meta">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · {formatBetCurrency(bet.stake, bet.currency)}
            {settled ? (
              <> · {settled.won ? "won ✓" : "lost"}</>
            ) : (
              haveModel &&
              prob! > 0 &&
              prob! < 1 && (
                <>
                  {" "}
                  · model {Math.round(prob! * 100)}% · fair{" "}
                  {formatOdds(1 / prob!, oddsFormat)}
                </>
              )
            )}
          </p>
        </div>
        <div className={`bets-row-value ${profitClass}`}>
          {currentValue !== null ? (
            <>
              <strong>{formatBetCurrency(currentValue, bet.currency)}</strong>
              <span>
                {profit !== null && profit >= 0 ? "+" : ""}
                {profit !== null ? formatBetCurrency(profit, bet.currency) : ""}
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

function WinningScoreFairOdds({
  line,
  side,
  projections,
  oddsFormat,
}: {
  line: number;
  side: "under" | "over";
  projections: Record<string, TournamentProjection>;
  oddsFormat: OddsFormat;
}) {
  if (!Number.isFinite(line) || line < 230 || line > 320) return null;
  const ev = evaluateWinningScore(
    {
      kind: "winning-score",
      id: "preview",
      placedAt: 0,
      line,
      side,
      oddsTaken: 2,
      oddsTakenLabel: "evens",
      stake: 0,
    },
    projections,
  );
  if (!ev) return null;
  return (
    <p className="bets-form-fair">
      Model: <strong>{Math.round(ev.prob * 100)}%</strong> chance · fair{" "}
      <strong>
        {ev.prob > 0 && ev.prob < 1
          ? formatOdds(1 / ev.prob, oddsFormat)
          : "—"}
      </strong>
    </p>
  );
}

function WinningScoreRow({
  bet,
  projections,
  oddsFormat,
  settled,
  onRemove,
}: {
  bet: WinningScoreBet;
  projections: Record<string, TournamentProjection>;
  oddsFormat: OddsFormat;
  settled: { won: boolean } | null;
  onRemove: () => void;
}) {
  const ev = evaluateWinningScore(bet, projections);
  const havModel = ev != null;
  const currentValue = settled
    ? settled.won
      ? bet.stake * bet.oddsTaken
      : 0
    : havModel
      ? ev.prob >= 1
        ? bet.stake * bet.oddsTaken
        : ev.prob <= 0
          ? 0
          : bet.stake * ev.prob * bet.oddsTaken
      : null;
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
          <p className="bets-row-name">
            Winning score{" "}
            <span className="bets-row-kind">
              {bet.side} {bet.line}
            </span>
          </p>
          <p className="bets-row-meta">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · {formatBetCurrency(bet.stake, bet.currency)}
            {settled ? (
              <> · {settled.won ? "won ✓" : "lost"}</>
            ) : (
              havModel && (
                <>
                  {" "}
                  · model {Math.round(ev.prob * 100)}% · fair{" "}
                  {ev.prob > 0 && ev.prob < 1
                    ? formatOdds(1 / ev.prob, oddsFormat)
                    : "—"}
                </>
              )
            )}
          </p>
        </div>
        <div className={`bets-row-value ${profitClass}`}>
          {currentValue !== null ? (
            <>
              <strong>{formatBetCurrency(currentValue, bet.currency)}</strong>
              <span>
                {profit !== null && profit >= 0 ? "+" : ""}
                {profit !== null ? formatBetCurrency(profit, bet.currency) : ""}
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
  settled,
  onRemove,
  recentForm,
  handStatus,
}: {
  bet: RoundScoreBet;
  state: PlayerRoundState | undefined;
  oddsFormat: OddsFormat;
  settled: { won: boolean } | null;
  onRemove: () => void;
  recentForm: Record<string, RecentFormEntry> | undefined;
  handStatus: Record<string, "hot" | "cold"> | undefined;
}) {
  const ev = evaluateRoundScore(bet, state);
  const roundLabel = bet.round != null ? `R${bet.round}` : "current round";

  let stateText: string;
  let valueBlock: JSX.Element;
  let profitClass = "";

  // DB-stamped settled state (from notify-poll) wins over live model
  // evaluation — covers bets from past tournaments where the active
  // leaderboard no longer has the player's state.
  if (settled) {
    profitClass = settled.won ? "bets-profit-up" : "bets-profit-down";
    stateText = settled.won ? "Won" : "Lost";
    valueBlock = (
      <strong className={profitClass}>
        {settled.won
          ? `+${formatBetCurrency(bet.stake * (bet.oddsTaken - 1), bet.currency)}`
          : `-${formatBetCurrency(bet.stake, bet.currency)}`}
      </strong>
    );
  } else if (!ev) {
    stateText = "Waiting on data…";
    valueBlock = <span className="bets-row-pending">—</span>;
  } else if (ev.kind === "not-started") {
    stateText = `R${ev.round} not started yet`;
    valueBlock = (
      <>
        <strong>{formatBetCurrency(bet.stake, bet.currency)}</strong>
        <span>+£0.00</span>
      </>
    );
  } else if (ev.kind === "settled") {
    profitClass = ev.won ? "bets-profit-up" : "bets-profit-down";
    stateText = `R${ev.round} final ${ev.finalStrokes} — ${ev.won ? "WON" : "LOST"}`;
    valueBlock = (
      <strong className={profitClass}>
        {ev.won
          ? `+${formatBetCurrency(bet.stake * (bet.oddsTaken - 1), bet.currency)}`
          : `-${formatBetCurrency(bet.stake, bet.currency)}`}
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
        <strong>{formatBetCurrency(currentValue, bet.currency)}</strong>
        <span>
          {profit >= 0 ? "+" : ""}
          {formatBetCurrency(profit, bet.currency)}
        </span>
      </>
    );
  }

  return (
    <li className="bets-row-wrap">
      <Link href={`/live/bet/${bet.id}`} className="bets-row bets-row-link">
        <div className="bets-row-main">
          <PlayerRowName
            bet={bet}
            recentForm={recentForm}
            handStatus={handStatus}
          >
            <>
              {abbreviateName(bet.playerName)}{" "}
              <span className="bets-row-kind">
                {bet.side} {bet.line} · {roundLabel}
              </span>
            </>
          </PlayerRowName>
          <p className="bets-row-meta">
            @ {formatOdds(bet.oddsTaken, oddsFormat)} · {formatBetCurrency(bet.stake, bet.currency)} ·{" "}
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
  tournamentProjections,
  recentForm,
  handStatus,
  oddsFormat,
  initialKind = "outright",
  currency,
  onCurrencyChange,
  onAdd,
  onCancel,
}: {
  players: CachedLeaderboardRow[];
  playerRoundStates: Record<string, PlayerRoundState>;
  tournamentProjections: Record<string, TournamentProjection>;
  recentForm: Record<string, RecentFormEntry> | undefined;
  handStatus: Record<string, "hot" | "cold"> | undefined;
  oddsFormat: OddsFormat;
  initialKind?: BetKind;
  currency: BetCurrency;
  onCurrencyChange: (c: BetCurrency) => void;
  onAdd: (b: TrackedBet) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BetKind>(initialKind);
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
  const [cutoff, setCutoff] = useState<5 | 10 | 20>(5);
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
    if (kind !== "winning-score" && !pickedPlayer) {
      return setErr("Pick a player from the list.");
    }
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

    if (kind === "winning-score") {
      const line = Number(lineText);
      if (!Number.isFinite(line) || line < 230 || line > 320) {
        return setErr("Enter a realistic winning-score line, e.g. 268.5.");
      }
      onAdd({
        kind: "winning-score",
        id,
        placedAt,
        line,
        side,
        oddsTaken: odds.decimal,
        oddsTakenLabel: odds.label,
        stake,
        currency,
      });
      return;
    }

    // Outright + round-score + top-finish from here on — all need a player.
    if (!pickedPlayer) return setErr("Pick a player from the list.");

    if (kind === "top-finish") {
      onAdd({
        kind: "top-finish",
        id,
        placedAt,
        playerId: pickedPlayer.id,
        playerName: pickedPlayer.name,
        cutoff,
        oddsTaken: odds.decimal,
        oddsTakenLabel: odds.label,
        stake,
        currency,
      });
      return;
    }

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
        currency,
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
    // Always lock the bet to a concrete round at placement time.
    // Falling back to "current round at evaluation time" caused
    // bets placed for R1 to silently retarget at R2 once R1 ended
    // — the bet would appear back in Live with an unrelated score.
    // Preference order: explicit pick → placement snapshot → the
    // player's current round → tournament's R1 fallback.
    const lockedRound =
      roundN ??
      placement?.round ??
      playerRoundStates[pickedPlayer.id]?.currentRound ??
      1;
    onAdd({
      kind: "round-score",
      id,
      placedAt,
      playerId: pickedPlayer.id,
      playerName: pickedPlayer.name,
      round: lockedRound,
      line,
      side,
      oddsTaken: odds.decimal,
      oddsTakenLabel: odds.label,
      stake,
      currency,
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
        <button
          type="button"
          className={kind === "winning-score" ? "bets-kind-on" : ""}
          onClick={() => setKind("winning-score")}
        >
          Winning score
        </button>
        <button
          type="button"
          className={kind === "top-finish" ? "bets-kind-on" : ""}
          onClick={() => setKind("top-finish")}
        >
          Top finish
        </button>
      </div>

      {kind === "winning-score" ? (
        <>
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
              <span>Line (e.g. 268.5)</span>
              <input
                type="number"
                step="0.5"
                placeholder="268.5"
                value={lineText}
                onChange={(e) => setLineText(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
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
              <span>Stake</span>
              <div className="bets-form-stake-row">
                <select
                  value={currency}
                  onChange={(e) =>
                    onCurrencyChange(e.target.value as BetCurrency)
                  }
                  aria-label="Currency"
                  className="bets-form-currency"
                >
                  {BET_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="10"
                  value={stakeText}
                  onChange={(e) => setStakeText(e.target.value)}
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                />
              </div>
            </label>
          </div>
          <WinningScoreFairOdds
            line={Number(lineText)}
            side={side}
            projections={tournamentProjections}
            oddsFormat={oddsFormat}
          />
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
      ) : pickedPlayer ? (
        <div className="bets-form-picked">
          <div className="bets-form-picked-main">
            {handStatus?.[pickedPlayer.id] && (
              <span
                className={`hand-badge hand-badge-${handStatus[pickedPlayer.id]}`}
                aria-hidden="true"
              >
                {handStatus[pickedPlayer.id] === "hot" ? "🔥" : "🥶"}
              </span>
            )}
            <strong>{pickedPlayer.name}</strong>
            {recentForm?.[pickedPlayer.id] && (
              <RecentFormSparkline
                recent={recentForm[pickedPlayer.id].recent}
                trend={recentTrendFor(recentForm[pickedPlayer.id].recent)}
                mode="full"
                showList
              />
            )}
          </div>
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
              {filtered.map((p) => {
                const form = recentForm?.[p.playerId];
                const hand = handStatus?.[p.playerId];
                return (
                  <li key={p.playerId}>
                    <button
                      type="button"
                      onClick={() =>
                        setPickedPlayer({ id: p.playerId, name: p.displayName })
                      }
                    >
                      <span className="bets-form-suggest-name">
                        {hand && (
                          <span
                            className={`hand-badge hand-badge-${hand}`}
                            aria-hidden="true"
                          >
                            {hand === "hot" ? "🔥" : "🥶"}
                          </span>
                        )}
                        {p.displayName}
                      </span>
                      {form && (
                        <RecentFormSparkline
                          recent={form.recent}
                          trend={recentTrendFor(form.recent)}
                          mode="compact"
                        />
                      )}
                      <span className="bets-form-suggest-meta">
                        {p.position} · {p.total}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {pickedPlayer && (
        <>
          {kind === "top-finish" && (
            <div className="bets-form-row">
              <label className="bets-form-label">
                <span>Top finish</span>
                <select
                  value={cutoff}
                  onChange={(e) =>
                    setCutoff(Number(e.target.value) as 5 | 10 | 20)
                  }
                >
                  <option value="5">Top 5</option>
                  <option value="10">Top 10</option>
                  <option value="20">Top 20</option>
                </select>
              </label>
            </div>
          )}
          {kind === "round-score" && (
            <>
              <div className="bets-form-row">
                <label className="bets-form-label">
                  <span>Round</span>
                  <select
                    value={roundText}
                    onChange={(e) => setRoundText(e.target.value)}
                  >
                    <option value="">
                      {pickedPlayer
                        ? `Current — R${
                            playerRoundStates[pickedPlayer.id]?.currentRound ??
                            1
                          }`
                        : "Current round"}
                    </option>
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
              <span>Stake</span>
              <div className="bets-form-stake-row">
                <select
                  value={currency}
                  onChange={(e) =>
                    onCurrencyChange(e.target.value as BetCurrency)
                  }
                  aria-label="Currency"
                  className="bets-form-currency"
                >
                  {BET_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="10"
                  value={stakeText}
                  onChange={(e) => setStakeText(e.target.value)}
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                />
              </div>
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
