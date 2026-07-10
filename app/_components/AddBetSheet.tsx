"use client";

/**
 * AddBetSheet — bottom sheet that lets the user track a real bet.
 * Mirrors the design-handoff prototype's <AddBet> (Pardle Social v2
 * line 88): player chips + market chips + odds taken + stake +
 * currency toggle + "Track bet" CTA. On submit it persists through
 * the canonical path (persistBet → localStorage + Supabase) so the
 * same bet shows up on /bets, on the Sweat feed inline cards once
 * play starts, and as a tagged row on /leaderboard.
 *
 * Player list source: real Memorial field from /api/field (pre-
 * event) merged with the live leaderboard from /api/feed (during
 * play). No live data is required to submit — odds + stake are
 * free-form text so users can place bets pre-tournament tonight.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  persistBet,
  type OutrightBet,
  type RoundScoreBet,
  type TopFinishBet,
  type TrackedBet,
  type WinningScoreBet,
} from "@/app/live/bet-shared";
import {
  type BetCurrency,
  DEFAULT_BET_CURRENCY,
  normaliseBetCurrency,
} from "@/lib/format/bet-currency";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";
import { hapticSuccess } from "@/lib/haptic";
import { formatOdds, parseOdds as parseOddsShared } from "@/lib/odds-format";

interface PlayerOption {
  /** Orchestrator id when known, DataGolf id otherwise — used as the
   *  bet's `playerId`. */
  id: string;
  /** "First Last" display name. */
  name: string;
}

interface MarketDef {
  key: string;
  label: string;
  kind: TrackedBet["kind"];
  /** Pre-filled odds suggestion (still editable). */
  defaultOdds: string;
  /** For top-finish: 5/10/20. */
  cutoff?: 5 | 10 | 20;
  /** Whether this market needs the user to pick a player. */
  needsPlayer: boolean;
}

const MARKETS: MarketDef[] = [
  {
    key: "outright",
    label: "Outright win",
    kind: "outright",
    defaultOdds: "+1200",
    needsPlayer: true,
  },
  {
    key: "top5",
    label: "Top 5",
    kind: "top-finish",
    cutoff: 5,
    defaultOdds: "+175",
    needsPlayer: true,
  },
  {
    key: "top10",
    label: "Top 10",
    kind: "top-finish",
    cutoff: 10,
    defaultOdds: "-120",
    needsPlayer: true,
  },
  {
    key: "round-score",
    label: "Round score",
    kind: "round-score",
    defaultOdds: "-110",
    needsPlayer: true,
  },
  {
    key: "winning-score",
    label: "Winning score",
    kind: "winning-score",
    defaultOdds: "+125",
    needsPlayer: false,
  },
];

const DEFAULT_ROUND_LINE = "69.5";
const DEFAULT_WIN_LINE = "270.5";
const ROUND_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: "Any" },
  { value: 1, label: "R1" },
  { value: 2, label: "R2" },
  { value: 3, label: "R3" },
  { value: 4, label: "R4" },
];

const CURRENCIES: Array<{ symbol: string; code: BetCurrency }> = [
  { symbol: "£", code: "GBP" },
  { symbol: "$", code: "USD" },
  // "u" for units — sizes bets by bankroll fraction. All P&L renders
  // as "+2.5u" downstream via formatBetCurrency's UNIT branch.
  { symbol: "u", code: "UNIT" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-selected player (from "+ Bet on X" deep-link). */
  prefillPlayer?: PlayerOption | null;
  /** When non-null the sheet calls this after a successful save. */
  onTracked?: (bet: TrackedBet) => void;
}

export default function AddBetSheet({
  open,
  onClose,
  prefillPlayer,
  onTracked,
}: Props) {
  useDismissibleOverlay(open, onClose);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<PlayerOption | null>(
    prefillPlayer ?? null,
  );
  const [marketIdx, setMarketIdx] = useState(0);
  const [oddsText, setOddsText] = useState(MARKETS[0].defaultOdds);
  const [stake, setStake] = useState("");
  const [cur, setCur] = useState<{ symbol: string; code: BetCurrency }>(
    CURRENCIES[0],
  );
  // Per-market extras — used only for round-score + winning-score.
  // Stored as text so the input field stays editable; parsed on submit.
  const [side, setSide] = useState<"under" | "over">("under");
  const [lineText, setLineText] = useState(DEFAULT_ROUND_LINE);
  const [round, setRound] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Active tournament captured from /api/feed at sheet-open time —
   *  baked onto every placed bet so settlement always targets the
   *  right event even after the active tournament rolls forward. */
  const [tournament, setTournament] = useState<{
    id: string;
    name: string;
  } | null>(null);
  /** Pickable tournaments — upcoming + live + last few completed.
   *  Populated from /api/tournaments/pickable so the user can attach
   *  a bet to a past or future event, not just the currently live
   *  one. Fixes the "bet stuck live because it belonged to a past
   *  tournament we couldn't identify" bug at source. */
  const [pickable, setPickable] = useState<
    Array<{
      id: string;
      name: string;
      startDate: number;
      state: "upcoming" | "live" | "completed";
    }>
  >([]);
  /** The tournament the user picked from the dropdown. Falls back to
   *  `tournament` (active) when unset — that's the default for the
   *  common case: someone placing a bet mid-round on today's event. */
  const [pickedTournamentId, setPickedTournamentId] = useState<string | null>(
    null,
  );

  // Reset state when the sheet opens (mirrors a fresh sheet each time).
  useEffect(() => {
    if (!open) return;
    setPicked(prefillPlayer ?? null);
    setSearch("");
    setMarketIdx(0);
    setOddsText(MARKETS[0].defaultOdds);
    setStake("");
    setSide("under");
    setLineText(DEFAULT_ROUND_LINE);
    setRound(null);
    setErr(null);
    setSaving(false);
    setPickedTournamentId(null);
  }, [open, prefillPlayer]);

  // Load the curated list of tournaments the bet can be attached to
  // (upcoming + live + last few completed). Keeps the AddBet flow
  // self-contained — the dropdown is populated the moment the sheet
  // opens so the user never sees an empty menu.
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/tournaments/pickable", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as {
          active: { id: string; name: string } | null;
          options: Array<{
            id: string;
            name: string;
            startDate: number;
            state: "upcoming" | "live" | "completed";
          }>;
        };
        if (cancel) return;
        setPickable(j.options ?? []);
        // Default the picker to the currently-live event if we know one
        // — that's the >90% case for placement.
        if (j.active?.id) {
          setPickedTournamentId((prev) => prev ?? j.active!.id);
        } else if ((j.options ?? [])[0]?.id) {
          setPickedTournamentId((prev) => prev ?? j.options![0].id);
        }
      } catch {
        // ignored — dropdown falls back to the active tournament from
        // /api/feed, which the existing effect handles.
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  // Load the player list from the live leaderboard first; fall back
  // to the DataGolf field (pre-event). Both endpoints already exist
  // (used by /leaderboard). We also capture the active tournament's
  // id + name so we can stamp every placed bet — without that,
  // unsettled bets implicitly retarget whichever tournament happens
  // to be active when they're next read (the "my Memorial bets now
  // show on US Open" bug).
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/feed?v=addbet", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as {
            leaderboard?: Array<{ playerId: string; displayName: string }>;
            playerIndex?: Array<{ playerId: string; displayName: string }>;
            tournament?: { id?: string; name?: string } | null;
          };
          if (!cancel && j.tournament?.id) {
            setTournament({
              id: j.tournament.id,
              name: j.tournament.name ?? "",
            });
          }
          // Prefer playerIndex (full field — includes players outside
          // the top 30 leaderboard slice and pre-tournament commits)
          // so users can place a bet on anyone in the field.
          const src = (j.playerIndex ?? j.leaderboard) ?? [];
          if (src.length > 0) {
            if (!cancel) {
              setPlayers(
                src.map((p) => ({
                  id: p.playerId,
                  name: p.displayName,
                })),
              );
            }
            return;
          }
        }
        // Pre-event fallback: DataGolf field.
        const f = await fetch("/api/field", { cache: "no-store" });
        if (!f.ok) return;
        const fj = (await f.json()) as {
          field?: Array<{ dgId: string; name: string }>;
          tournament?: { id?: string; name?: string } | null;
        };
        if (cancel) return;
        if (fj.tournament?.id) {
          setTournament({
            id: fj.tournament.id,
            name: fj.tournament.name ?? "",
          });
        }
        setPlayers(
          (fj.field ?? []).map((p) => ({ id: `dg-${p.dgId}`, name: p.name })),
        );
      } catch {
        // ignored — keep whatever players state we have
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  // Make sure a player pre-filled from a deep-link wins over the
  // search/select state — the user shouldn't have to re-pick.
  useEffect(() => {
    if (prefillPlayer) setPicked(prefillPlayer);
  }, [prefillPlayer]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      // Show picked player + a handful by default.
      const head = picked ? [picked] : [];
      const rest = players
        .filter((p) => p.id !== picked?.id)
        .slice(0, 8);
      return [...head, ...rest];
    }
    return players
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [players, search, picked]);

  const market = MARKETS[marketIdx];
  const previewName =
    market.needsPlayer && picked ? picked.name : "the field";
  const marketPreview: string = (() => {
    if (market.kind === "round-score") {
      const r = round != null ? ` · R${round}` : "";
      return `${side.toUpperCase()} ${lineText || "—"}${r}`;
    }
    if (market.kind === "winning-score") {
      return `${side.toUpperCase()} ${lineText || "—"} · TOT`;
    }
    return market.label;
  })();

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (saving) return;
      setErr(null);
      if (market.needsPlayer && !picked) {
        setErr("Pick a player.");
        return;
      }
      const parsed = parseOddsShared(oddsText);
      if (!parsed || parsed.decimal <= 1) {
        setErr("Enter odds like +250, 8/1, or 9.0.");
        return;
      }
      const stakeNum = Number(stake);
      if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
        setErr("Enter a positive stake.");
        return;
      }
      const placedAt = Date.now();
      const id = `b${placedAt.toString(36)}${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const oddsTakenLabel = formatOdds(parsed.decimal, parsed.format);

      // Resolve which tournament this bet targets. Priority order:
      //   1. The user's explicit pick from the dropdown.
      //   2. Whatever /api/feed reported as active (fallback for cases
      //      where the pickable list hadn't loaded yet).
      // The settlement layer keys off bet.tournamentId — placing one
      // without it reintroduces the "bet implicitly retargets
      // whichever event is next active" bug.
      const pickedFromList =
        pickedTournamentId != null
          ? pickable.find((t) => t.id === pickedTournamentId)
          : undefined;
      const targetTournament: { id: string; name?: string } | null =
        pickedFromList
          ? { id: pickedFromList.id, name: pickedFromList.name }
          : tournament?.id
            ? { id: tournament.id, name: tournament.name }
            : null;
      if (!targetTournament?.id) {
        setErr(
          "Pick a tournament for this bet — none is currently available.",
        );
        return;
      }
      const tournamentStamp = {
        tournamentId: targetTournament.id,
        tournamentName: targetTournament.name || undefined,
      };

      let bet: TrackedBet;
      if (market.kind === "winning-score") {
        const line = Number(lineText);
        if (!Number.isFinite(line) || line < 230 || line > 320) {
          setErr("Enter a realistic winning-score line, e.g. 270.5.");
          return;
        }
        bet = {
          id,
          kind: "winning-score",
          placedAt,
          line,
          side,
          oddsTaken: parsed.decimal,
          oddsTakenLabel,
          stake: stakeNum,
          currency: cur.code,
          ...tournamentStamp,
        } satisfies WinningScoreBet;
      } else if (market.kind === "top-finish") {
        bet = {
          id,
          kind: "top-finish",
          placedAt,
          playerId: picked!.id,
          playerName: picked!.name,
          cutoff: market.cutoff ?? 5,
          oddsTaken: parsed.decimal,
          oddsTakenLabel,
          stake: stakeNum,
          currency: cur.code,
          ...tournamentStamp,
        } satisfies TopFinishBet;
      } else if (market.kind === "round-score") {
        const line = Number(lineText);
        if (!Number.isFinite(line) || line < 55 || line > 90) {
          setErr("Enter a realistic round-score line, e.g. 69.5.");
          return;
        }
        bet = {
          id,
          kind: "round-score",
          placedAt,
          playerId: picked!.id,
          playerName: picked!.name,
          round,
          line,
          side,
          oddsTaken: parsed.decimal,
          oddsTakenLabel,
          stake: stakeNum,
          currency: cur.code,
          ...tournamentStamp,
        } satisfies RoundScoreBet;
      } else {
        bet = {
          id,
          kind: "outright",
          placedAt,
          playerId: picked!.id,
          playerName: picked!.name,
          oddsTaken: parsed.decimal,
          oddsTakenLabel,
          stake: stakeNum,
          currency: cur.code,
          ...tournamentStamp,
        } satisfies OutrightBet;
      }

      setSaving(true);
      try {
        await persistBet(bet);
        hapticSuccess();
        onTracked?.(bet);
        onClose();
      } catch (e) {
        setErr(
          e instanceof Error ? e.message : "Couldn't save the bet — try again.",
        );
        setSaving(false);
      }
    },
    [
      cur.code,
      lineText,
      market,
      oddsText,
      onClose,
      onTracked,
      picked,
      round,
      saving,
      side,
      stake,
    ],
  );

  if (!open) return null;

  return (
    <>
      <div className="addbet-scrim" onClick={onClose} />
      <div className="addbet-sheet" role="dialog" aria-modal="true">
        <div className="addbet-grip" aria-hidden="true" />
        <h3 className="addbet-title">Track a bet</h3>

        {/* Tournament — the primary settlement anchor. Defaults to the
            currently-live event but the user can attach a bet to a
            past event (e.g. one they forgot to log) or an upcoming
            one (pre-tournament placement). Without an explicit pick,
            settlement historically drifted to "whichever event is
            active when read later", which stranded bets forever. */}
        {pickable.length > 0 && (
          <div className="addbet-field">
            <div className="addbet-fl">Tournament</div>
            <select
              className="addbet-select"
              value={pickedTournamentId ?? ""}
              onChange={(e) => setPickedTournamentId(e.target.value)}
            >
              {pickable.map((t) => {
                const suffix =
                  t.state === "live"
                    ? " · Live"
                    : t.state === "upcoming"
                      ? " · Upcoming"
                      : " · Past";
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {suffix}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {market.needsPlayer && (
          <div className="addbet-field">
            <div className="addbet-fl">Player</div>
            <input
              type="text"
              className="addbet-search"
              placeholder="Search the field…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            <div className="addbet-chiprow">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`addbet-chip${
                    picked?.id === p.id ? " addbet-chip-on" : ""
                  }`}
                  onClick={() => setPicked(p)}
                >
                  {p.name}
                </button>
              ))}
              {filtered.length === 0 && (
                <span className="addbet-hint">
                  No match — odds + stake still work; pick later or close.
                </span>
              )}
            </div>
          </div>
        )}

        <div className="addbet-field">
          <div className="addbet-fl">Market</div>
          <div className="addbet-chiprow">
            {MARKETS.map((m, i) => (
              <button
                key={m.key}
                type="button"
                className={`addbet-chip${
                  marketIdx === i ? " addbet-chip-on" : ""
                }`}
                onClick={() => {
                  setMarketIdx(i);
                  setOddsText(m.defaultOdds);
                  // Reset side/line defaults per market so the user
                  // sees a sensible starting line for the kind they
                  // just picked instead of a stale value from another.
                  if (m.kind === "winning-score") {
                    setLineText(DEFAULT_WIN_LINE);
                    setSide("under");
                  } else if (m.kind === "round-score") {
                    setLineText(DEFAULT_ROUND_LINE);
                    setSide("under");
                  }
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {market.kind === "round-score" && (
          <div className="addbet-field">
            <div className="addbet-fl">Round</div>
            <div className="addbet-chiprow">
              {ROUND_OPTIONS.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`addbet-chip${
                    round === r.value ? " addbet-chip-on" : ""
                  }`}
                  onClick={() => setRound(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(market.kind === "round-score" ||
          market.kind === "winning-score") && (
          <div className="addbet-field">
            <div className="addbet-fl">
              {market.kind === "round-score"
                ? "Round score line"
                : "Winning-score line"}
            </div>
            <div className="addbet-stakerow">
              <div
                className="addbet-curtog"
                role="radiogroup"
                aria-label="Side"
              >
                {(["under", "over"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={side === s}
                    className={side === s ? "on" : ""}
                    onClick={() => setSide(s)}
                  >
                    {s === "under" ? "U" : "O"}
                  </button>
                ))}
              </div>
              <input
                type="number"
                inputMode="decimal"
                className="addbet-stake-input"
                value={lineText}
                onChange={(e) => setLineText(e.target.value)}
                placeholder={
                  market.kind === "round-score"
                    ? DEFAULT_ROUND_LINE
                    : DEFAULT_WIN_LINE
                }
                step="0.5"
              />
            </div>
          </div>
        )}

        <div className="addbet-field">
          <div className="addbet-fl">Odds taken</div>
          <input
            className="addbet-odds"
            type="text"
            value={oddsText}
            onChange={(e) => setOddsText(e.target.value)}
            placeholder="e.g. +175 · 9/4 · 2.75"
            inputMode="text"
            autoCapitalize="off"
          />
        </div>

        <div className="addbet-field">
          <div className="addbet-fl">Stake</div>
          <div className="addbet-stakerow">
            <div className="addbet-curtog" role="radiogroup" aria-label="Currency">
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  role="radio"
                  aria-checked={cur.code === c.code}
                  className={cur.code === c.code ? "on" : ""}
                  onClick={() => setCur(c)}
                >
                  {c.symbol}
                </button>
              ))}
            </div>
            <input
              type="number"
              inputMode="decimal"
              className="addbet-stake-input"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder={cur.code === "UNIT" ? "1.0" : "0"}
              min="0"
              step={cur.code === "UNIT" ? "0.5" : "1"}
            />
          </div>
        </div>

        {err && <div className="addbet-err">{err}</div>}

        <button
          type="button"
          className="addbet-cta"
          disabled={saving}
          onClick={(e) => submit(e as unknown as React.FormEvent)}
        >
          {saving
            ? "Tracking…"
            : `Track bet @ ${oddsText.trim() || "—"}`}
        </button>

        <div className="addbet-preview">
          {market.needsPlayer && !picked
            ? "Pick a player and a stake to track."
            : !stake
              ? "Enter a stake to continue."
              : (
                  <>
                    Posts as <b>{previewName} · {marketPreview}</b> — your crew
                    sees it live.
                  </>
                )}
        </div>

        <button
          type="button"
          className="addbet-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        {/* `normaliseBetCurrency` is exported by lib/format/bet-currency and
            we want to keep its import surface stable; reference is intentional. */}
        {process.env.NODE_ENV === "test" && (
          <span hidden>{normaliseBetCurrency(DEFAULT_BET_CURRENCY)}</span>
        )}
      </div>
    </>
  );
}
