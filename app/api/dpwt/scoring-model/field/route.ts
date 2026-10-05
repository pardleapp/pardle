/**
 * GET /api/dpwt/scoring-model/field
 *
 * DP World Tour version of /api/scoring-model/field: this week's field
 * for the round-score forecast, with event-specific skill, pre-event
 * probabilities, completed-round scores, per-round strokes gained and
 * tee times. Same response shape as the PGA route.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dpwtHoleByHole, dpwtLeaderboard, dpwtTeeMap, getDpwtActive, loadDpwtMeta } from "@/lib/dpwt/data";
import { getDpwtField } from "@/lib/dpwt/live";
import { listTournamentConfigs } from "@/lib/scoring-model/tournament-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DG = "https://feeds.datagolf.com";

interface PreRow {
  dg_id: number;
  win?: number; top_5?: number; top_10?: number; top_20?: number; make_cut?: number; first_round_leader?: number;
}

/** Per-player per-round strokes gained from the Tour's shot tracker. */
async function imgRoundSg(imgEventId: number) {
  const out = new Map<string, Record<number, { sgOtt?: number; sgApp?: number; sgArg?: number; sgPutt?: number }>>();
  try {
    const q = JSON.parse(await readFile(path.join(process.cwd(), "data", "dpwt", "img-stats-query.json"), "utf-8"));
    const body = {
      operationName: q.operationName,
      query: q.query,
      // Key order matters to the server (alphabetical, as captured).
      variables: { input: {
        categories: ["Driving", "Approach", "Putting", "Scoring"],
        first: 250,
        subCats: ["offTheTeeStrokesGained", "approachStrokesGained", "puttingStrokesGained", "teeToGreenStrokesGained"],
        tournamentId: imgEventId,
      } },
    };
    const r = await fetch("https://btec-http.services.srarena.io/", {
      method: "POST",
      headers: {
        "content-type": "application/json", operator: "europeantour", sport: "GOLF", "event-id": String(imgEventId),
        "gql-op-name": "StatsGetGolfTournamentStats", "ec-version": "6.0.129", "x-request-from": "6.0.129",
        "query-hash": q.queryHash, "normalise-response": "true",
        origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
      },
      body: JSON.stringify(body),
      next: { revalidate: 120 },
    } as RequestInit);
    if (!r.ok) return out;
    const j = await r.json();
    const blocks = (j.data ?? j)?.getGolfTournamentStats ?? [];
    const raw = new Map<string, Record<number, Record<string, number>>>();
    for (const blk of blocks) for (const sc of blk.subCats ?? []) for (const rk of sc.rankings ?? []) {
      const pl = rk.players?.[0];
      if (!pl) continue;
      const key = `${pl.firstName} ${pl.lastName}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
      const e = raw.get(key) ?? {};
      for (const rr of rk.rounds ?? []) (e[rr.round] ??= {})[sc.subCat] = rr.total;
      raw.set(key, e);
    }
    for (const [k, rounds] of raw) {
      const o: Record<number, { sgOtt?: number; sgApp?: number; sgArg?: number; sgPutt?: number }> = {};
      for (const [r, v] of Object.entries(rounds)) {
        const ott = v.offTheTeeStrokesGained, app = v.approachStrokesGained, t2g = v.teeToGreenStrokesGained;
        o[Number(r)] = { sgOtt: ott, sgApp: app, sgPutt: v.puttingStrokesGained, sgArg: t2g != null && ott != null && app != null ? t2g - ott - app : undefined };
      }
      out.set(k, o);
    }
  } catch {
    /* optional */
  }
  return out;
}

export async function GET() {
  const active = await getDpwtActive();
  if (!active) return NextResponse.json({ ok: true, tournamentId: null, tournamentName: null, players: [] });
  const meta = await loadDpwtMeta(active.slug);
  const key = process.env.DATAGOLF_API_KEY || process.env.DATAGOLF || "";
  const [field, lb, pre, sgByName] = await Promise.all([
    getDpwtField(),
    dpwtLeaderboard(active.dpwtEventId),
    fetch(`${DG}/preds/pre-tournament?tour=euro&odds_format=percent&file_format=json&key=${key}`, { next: { revalidate: 1800 } } as RequestInit)
      .then((r) => (r.ok ? (r.json() as Promise<{ baseline?: PreRow[] }>) : null)).catch(() => null),
    active.imgEventId ? imgRoundSg(active.imgEventId) : Promise.resolve(new Map()),
  ]);
  const probs = new Map((pre?.baseline ?? []).map((p) => [p.dg_id, p]));
  const lbById = new Map((lb?.Players ?? []).map((p) => [p.PlayerId, p]));
  const pars = meta?.courseHolePars ?? {};
  const hbh: Record<number, Map<number, number>> = {};
  const tees: Record<number, Map<number, { teetime: string }>> = {};
  for (const r of [1, 2, 3, 4]) {
    const [h, t] = await Promise.all([dpwtHoleByHole(active.dpwtEventId, r), dpwtTeeMap(active.dpwtEventId, r)]);
    tees[r] = t;
    const done = new Map<number, number>();
    for (const p of h?.Players ?? []) {
      const holes = (p.Holes ?? []).filter((x) => typeof x.Strokes === "number" && x.Strokes > 0);
      if (holes.length === 18) done.set(p.PlayerId, holes.reduce((a, x) => a + (x.Strokes as number) - (pars[String(x.HoleNo)] ?? 4), 0));
    }
    hbh[r] = done;
  }
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  const players = [...field.values()].map((f) => {
    const l = lbById.get(f.dpwtId);
    const weekRounds: number[] = [];
    const weekRoundsSg: Array<{ sgOtt?: number; sgApp?: number; sgArg?: number; sgPutt?: number } | null> = [];
    const sg = sgByName.get(norm(f.name));
    for (const r of [1, 2, 3, 4]) {
      const v = hbh[r].get(f.dpwtId);
      if (v == null) continue;
      weekRounds.push(v);
      weekRoundsSg.push(sg?.[r] ?? null);
    }
    const teeTimes: Record<number, string> = {};
    for (const r of [1, 2, 3, 4]) {
      const t = tees[r].get(f.dpwtId)?.teetime;
      if (t) teeTimes[r] = t.slice(0, 5);
    }
    const pr = probs.get(f.dgId);
    return {
      id: String(f.dpwtId),
      dgId: String(f.dgId),
      name: f.name,
      sgTotal: f.skill,
      sgSource: f.skill != null ? "event-specific" : null,
      position: l?.PositionDesc ?? "--",
      total: l ? (l.ScoreToPar === 0 ? "E" : l.ScoreToPar > 0 ? `+${l.ScoreToPar}` : String(l.ScoreToPar)) : "E",
      thru: l ? String(l.HolesPlayed ?? "-") : "-",
      playerState: l?.MissedCut ? "CUT" : "ACTIVE",
      weekRounds,
      weekRoundsSg,
      teeTimes,
      dgProbs: pr
        ? { win: pr.win, top5: pr.top_5, top10: pr.top_10, top20: pr.top_20, makeCut: pr.make_cut, firstRoundLead: pr.first_round_leader }
        : undefined,
    };
  });
  // Full event name, as course history's hostingEvents carry it: the
  // course-history tool auto-selects this week's venue by exact match.
  const cfg = (await listTournamentConfigs("dpwt")).find((c) => c.slug === active.slug);
  return NextResponse.json({
    ok: true,
    tournamentId: active.tournamentId,
    tournamentName: cfg?.eventName ?? meta?.eventName ?? null,
    players: players.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
