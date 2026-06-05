/**
 * /live/player/[id]/t/[year]/[eventId]
 *
 * Per-tournament drill-down: full per-round stats for one player at
 * one historical PGA Tour event. Reached by clicking a row in the
 * Recent Form section of a player profile.
 *
 * Data source: DataGolf historical-raw-data/rounds endpoint, cached
 * in Redis for 30 days (event data is immutable once played).
 *
 * Player resolution: the URL [id] is the orchestrator playerId (lets
 * the back button work). The DG payload doesn't share that id, so we
 * match by name via the leaderboard cache for the live tournament,
 * falling back to URL query if needed.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getCachedHistoricalRounds } from "@/lib/feed/historical-cache";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getFeedBundle } from "@/lib/feed/store";
import type {
  DGHistoricalRound,
  DGHistoricalScoreRow,
} from "@/lib/golf-api/datagolf";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; year: string; eventId: string }>;
  searchParams: Promise<{ name?: string }>;
}

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Flip "Last, First" → "First Last". */
function flipName(s: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(s.trim());
  if (!m) return s;
  return `${m[2].trim()} ${m[1].trim()}`;
}

function findPlayer(
  scores: DGHistoricalScoreRow[],
  searchName: string,
): DGHistoricalScoreRow | null {
  const target = normaliseName(searchName);
  return (
    scores.find((s) => normaliseName(flipName(s.player_name)) === target) ??
    null
  );
}

function fmtSg(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 100) / 100;
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}`;
}

function fmtNum(
  v: number | null | undefined,
  digits = 0,
  suffix = "",
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtScore(round: DGHistoricalRound | undefined): string {
  if (!round) return "—";
  const diff = round.score - round.course_par;
  if (diff === 0) return `${round.score} (E)`;
  return `${round.score} (${diff > 0 ? "+" : ""}${diff})`;
}

function roundSummary(rounds: (DGHistoricalRound | undefined)[]): {
  totalScore: number | null;
  totalToPar: number | null;
  sumSgTotal: number | null;
  sumSgOtt: number | null;
  sumSgApp: number | null;
  sumSgArg: number | null;
  sumSgPutt: number | null;
} {
  let totalScore = 0;
  let totalPar = 0;
  let played = 0;
  let sumSgTotal = 0;
  let sumSgOtt = 0;
  let sumSgApp = 0;
  let sumSgArg = 0;
  let sumSgPutt = 0;
  let sgRounds = 0;
  for (const r of rounds) {
    if (!r) continue;
    totalScore += r.score;
    totalPar += r.course_par;
    played++;
    if (r.sg_total != null) {
      sumSgTotal += r.sg_total;
      sumSgOtt += r.sg_ott ?? 0;
      sumSgApp += r.sg_app ?? 0;
      sumSgArg += r.sg_arg ?? 0;
      sumSgPutt += r.sg_putt ?? 0;
      sgRounds++;
    }
  }
  if (played === 0) {
    return {
      totalScore: null,
      totalToPar: null,
      sumSgTotal: null,
      sumSgOtt: null,
      sumSgApp: null,
      sumSgArg: null,
      sumSgPutt: null,
    };
  }
  return {
    totalScore,
    totalToPar: totalScore - totalPar,
    sumSgTotal: sgRounds > 0 ? sumSgTotal : null,
    sumSgOtt: sgRounds > 0 ? sumSgOtt : null,
    sumSgApp: sgRounds > 0 ? sumSgApp : null,
    sumSgArg: sgRounds > 0 ? sumSgArg : null,
    sumSgPutt: sgRounds > 0 ? sumSgPutt : null,
  };
}

export default async function PlayerTournamentPage({
  params,
  searchParams,
}: PageProps) {
  const { id, year, eventId } = await params;
  const { name } = await searchParams;
  const yearNum = Number(year);
  const eventIdNum = Number(eventId);
  if (!Number.isFinite(yearNum) || !Number.isFinite(eventIdNum)) {
    notFound();
  }

  const payload = await getCachedHistoricalRounds(eventIdNum, yearNum);
  if (!payload) {
    return (
      <main className="container container-wide v4-theme pv-theme">
        <header className="brand">
          <Link
            className="brand-back"
            href={`/live/player/${id}`}
            aria-label="Back to player"
          >
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Tournament not available</p>
        </header>
        <p className="feed-empty">
          Historical data for this event isn&apos;t available yet. Try
          again in a few minutes.
        </p>
      </main>
    );
  }

  // Resolve player. The Recent-form links from the Season tab carry
  // ?name=... as a hint, but if the leaderboard hadn't responded at
  // click time the hint could be "Loading…" — useless for the
  // historical lookup. Fall back to resolving the player's real name
  // from the active leaderboard by orchestrator playerId, same pattern
  // /api/player/season uses. Last resort: try fuzzy-matching the URL
  // [id] against the historical scores (some routes carry display
  // names instead of orchestrator ids).
  let resolvedName: string | null = null;
  if (name && name !== "Loading…" && !name.includes("Loading")) {
    resolvedName = name;
  } else {
    const active = await getActiveTournament().catch(() => null);
    if (active) {
      const bundle = await getFeedBundle(active.tournament.id);
      const row = bundle.leaderboard.find((r) => r.playerId === id);
      if (row) resolvedName = row.displayName;
    }
  }
  if (!resolvedName) resolvedName = id;

  const player = findPlayer(payload.scores, resolvedName);
  if (!player) {
    return (
      <main className="container container-wide v4-theme pv-theme">
        <header className="brand">
          <Link
            className="brand-back"
            href={`/live/player/${id}`}
            aria-label="Back to player"
          >
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Player not found in event</p>
        </header>
        <p className="feed-empty">
          Couldn&apos;t find &quot;{resolvedName}&quot; in this
          event&apos;s record.
        </p>
      </main>
    );
  }

  const rounds = [
    player.round_1,
    player.round_2,
    player.round_3,
    player.round_4,
  ];
  const summary = roundSummary(rounds);
  const displayName = flipName(player.player_name);
  const courseName = rounds.find((r) => r)?.course_name ?? "Course";

  return (
    <main className="container container-wide v4-theme ptourn">
      <header className="brand">
        <Link
          className="brand-back"
          href={`/live/player/${id}`}
          aria-label="Back to player"
        >
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">{displayName}</p>
      </header>

      <section className="ptourn-head">
        <p className="ptourn-eyebrow">
          {payload.event_name} · {yearNum}
        </p>
        <h2 className="ptourn-title">{displayName}</h2>
        <div className="ptourn-summary">
          <div className="ptourn-summary-stat">
            <span className="ptourn-summary-num">{player.fin_text}</span>
            <span className="ptourn-summary-lbl">Finish</span>
          </div>
          <div className="ptourn-summary-stat">
            <span className="ptourn-summary-num">
              {summary.totalScore ?? "—"}
            </span>
            <span className="ptourn-summary-lbl">Total</span>
          </div>
          <div className="ptourn-summary-stat">
            <span className="ptourn-summary-num">
              {summary.totalToPar == null
                ? "—"
                : summary.totalToPar === 0
                  ? "E"
                  : `${summary.totalToPar > 0 ? "+" : ""}${summary.totalToPar}`}
            </span>
            <span className="ptourn-summary-lbl">To par</span>
          </div>
          <div className="ptourn-summary-stat">
            <span className="ptourn-summary-num">
              {fmtSg(summary.sumSgTotal)}
            </span>
            <span className="ptourn-summary-lbl">SG Total</span>
          </div>
        </div>
        <p className="ptourn-meta">{courseName}</p>
      </section>

      <section className="ptourn-section">
        <p className="ptourn-section-title">Strokes gained · per round</p>
        <table className="ptourn-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Score</th>
              <th>OTT</th>
              <th>APP</th>
              <th>ARG</th>
              <th>PUTT</th>
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, i) =>
              r ? (
                <tr key={i}>
                  <td>R{i + 1}</td>
                  <td>{fmtScore(r)}</td>
                  <td className={sgClass(r.sg_ott)}>{fmtSg(r.sg_ott)}</td>
                  <td className={sgClass(r.sg_app)}>{fmtSg(r.sg_app)}</td>
                  <td className={sgClass(r.sg_arg)}>{fmtSg(r.sg_arg)}</td>
                  <td className={sgClass(r.sg_putt)}>{fmtSg(r.sg_putt)}</td>
                  <td className={`ptourn-table-emph ${sgClass(r.sg_total)}`}>
                    {fmtSg(r.sg_total)}
                  </td>
                </tr>
              ) : null,
            )}
            {summary.sumSgTotal != null && (
              <tr className="ptourn-table-total">
                <td>Sum</td>
                <td>—</td>
                <td className={sgClass(summary.sumSgOtt)}>
                  {fmtSg(summary.sumSgOtt)}
                </td>
                <td className={sgClass(summary.sumSgApp)}>
                  {fmtSg(summary.sumSgApp)}
                </td>
                <td className={sgClass(summary.sumSgArg)}>
                  {fmtSg(summary.sumSgArg)}
                </td>
                <td className={sgClass(summary.sumSgPutt)}>
                  {fmtSg(summary.sumSgPutt)}
                </td>
                <td
                  className={`ptourn-table-emph ${sgClass(summary.sumSgTotal)}`}
                >
                  {fmtSg(summary.sumSgTotal)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="ptourn-section">
        <p className="ptourn-section-title">Scoring · per round</p>
        <table className="ptourn-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Birdies</th>
              <th>Pars</th>
              <th>Bogeys</th>
              <th>Doubles+</th>
              <th>Eagles</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, i) =>
              r ? (
                <tr key={i}>
                  <td>R{i + 1}</td>
                  <td className="ptourn-table-good">{r.birdies}</td>
                  <td>{r.pars}</td>
                  <td className="ptourn-table-bad">{r.bogies}</td>
                  <td className="ptourn-table-bad">{r.doubles_or_worse}</td>
                  <td className="ptourn-table-good">{r.eagles_or_better}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </section>

      <section className="ptourn-section">
        <p className="ptourn-section-title">Ball striking · per round</p>
        <table className="ptourn-table">
          <thead>
            <tr>
              <th>Round</th>
              <th>Drv dist</th>
              <th>Drv acc</th>
              <th>GIR</th>
              <th>Scrambling</th>
              <th>Prox · FW</th>
              <th>Prox · Rgh</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, i) =>
              r ? (
                <tr key={i}>
                  <td>R{i + 1}</td>
                  <td>{fmtNum(r.driving_dist, 1, " yd")}</td>
                  <td>{fmtPct(r.driving_acc)}</td>
                  <td>{fmtPct(r.gir)}</td>
                  <td>{fmtPct(r.scrambling)}</td>
                  <td>{fmtNum(r.prox_fw, 1, " ft")}</td>
                  <td>{fmtNum(r.prox_rgh, 1, " ft")}</td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </section>

      <p className="ptourn-footnote">
        Historical PGA Tour event archive
      </p>
    </main>
  );
}

function sgClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  if (v > 0.5) return "ptourn-table-good";
  if (v < -0.5) return "ptourn-table-bad";
  return "";
}
