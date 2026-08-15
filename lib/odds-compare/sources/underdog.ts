/**
 * Underdog Fantasy round-score fetcher.
 *
 * Underdog is a DFS pick'em like PrizePicks — every line ships as
 * a "higher/lower" pair with per-side american prices (usually
 * around -112 / -112 for their balanced lines). Their PGA coverage
 * is thin outside majors; the /over_under_lines endpoint returns
 * ~5000 lines across every active sport but often zero golf during
 * regular tour stops.
 *
 * Endpoint: api.underdogfantasy.com/beta/v6/over_under_lines
 * Public but Cloudflare-guarded; routed through proxiedFetch.
 *
 * The response schema joins by ids:
 *   over_under_lines[].over_under.appearance_stat.stat (e.g.
 *   "round_1_strokes")
 *   over_under_lines[].options[] — each side (higher/lower) with
 *   american_price / decimal_price
 *   players[] — id → name
 *   appearances[] — id → player_id
 */

import "server-only";
import type { BookKey, RoundScoreQuote } from "../types";
import { proxiedFetch } from "../proxied-fetch";

const BASE = "https://api.underdogfantasy.com/beta/v6";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";

interface UDOption {
  choice?: string; // "higher" | "lower"
  american_price?: string | number;
  decimal_price?: string | number;
}
interface UDAppearanceStat {
  stat?: string;
}
interface UDOverUnder {
  title?: string;
  appearance_stat?: UDAppearanceStat;
}
interface UDLine {
  id: string;
  stat_value?: string | number;
  status?: string;
  options?: UDOption[];
  over_under?: UDOverUnder;
  updated_at?: string;
  live_event?: boolean;
}
interface UDAppearance {
  id: string;
  player_id?: string;
}
interface UDPlayer {
  id: string;
  first_name?: string;
  last_name?: string;
}
interface UDResponse {
  over_under_lines?: UDLine[];
  appearances?: UDAppearance[];
  players?: UDPlayer[];
}

/** Parse the round number out of Underdog's stat key. E.g.
 *  "round_2_strokes" -> 2. */
function roundFromStatKey(stat: string): number | null {
  const m = stat.match(/round[_\s]*(\d)/i);
  if (!m) return null;
  const r = Number(m[1]);
  return r >= 1 && r <= 4 ? r : null;
}

function isRoundScoreStat(stat: string): boolean {
  const s = stat.toLowerCase();
  if (!/round/.test(s)) return false;
  return (
    s.includes("stroke") || s.includes("score") || s.includes("total")
  );
}

function decimalFromPrice(o: UDOption): number | null {
  if (o.decimal_price != null) {
    const n = Number(o.decimal_price);
    if (Number.isFinite(n) && n > 1) return n;
  }
  if (o.american_price != null) {
    const n = Number(o.american_price);
    if (Number.isFinite(n)) return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  }
  return null;
}

export async function fetchUnderdogRoundScoreQuotes(
  round: number,
): Promise<RoundScoreQuote[]> {
  const res = await proxiedFetch(`${BASE}/over_under_lines`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Underdog ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = (await res.json()) as UDResponse;
  const lines = j.over_under_lines ?? [];
  if (lines.length === 0) return [];

  const players = new Map<string, string>();
  for (const p of j.players ?? []) {
    players.set(
      p.id,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    );
  }
  const appearancePlayer = new Map<string, string>();
  for (const a of j.appearances ?? []) {
    if (a.player_id) appearancePlayer.set(a.id, a.player_id);
  }

  const BOOK: BookKey = "underdog";
  const now = new Date().toISOString();
  const out: RoundScoreQuote[] = [];
  for (const line of lines) {
    if (line.status && line.status !== "active") continue;
    const stat = line.over_under?.appearance_stat?.stat ?? "";
    if (!isRoundScoreStat(stat)) continue;
    const r = roundFromStatKey(stat);
    if (r !== round) continue;
    const lineVal = Number(line.stat_value);
    if (!Number.isFinite(lineVal)) continue;
    // Underdog joins the player id through options[].appearance_id.
    // Fall back to the line's own appearance_id when present.
    const appearanceId = (line.options ?? []).find(
      (o) => (o as UDOption & { appearance_id?: string }).appearance_id,
    ) as (UDOption & { appearance_id?: string }) | undefined;
    const pid = appearanceId?.appearance_id
      ? appearancePlayer.get(appearanceId.appearance_id)
      : null;
    const playerName = pid ? players.get(pid) : null;
    if (!playerName) continue;
    let over: number | null = null;
    let under: number | null = null;
    for (const opt of line.options ?? []) {
      const dec = decimalFromPrice(opt);
      if (opt.choice === "higher") over = dec;
      if (opt.choice === "lower") under = dec;
    }
    out.push({
      book: BOOK,
      playerName,
      round: r,
      line: lineVal,
      over,
      under,
      lastUpdatedAt: line.updated_at ?? now,
    });
  }
  return out;
}
