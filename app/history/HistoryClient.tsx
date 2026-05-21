"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/live/auth/useAuth";

interface HistoryBet {
  id: string;
  kind: "outright" | "round-score" | "winning-score" | "top-finish";
  placedAt: number;
  settledAt: number | null;
  settledWon: boolean | null;
  stake: number;
  oddsTaken: number;
  oddsTakenLabel?: string;
  rationale: string | null;
  channelId: string | null;
  sourceTipId: string | null;
  // Variable per kind:
  playerName?: string;
  cutoff?: number;
  line?: number;
  side?: string;
  round?: number;
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

function describe(b: HistoryBet): string {
  const odds = b.oddsTakenLabel ? ` @ ${b.oddsTakenLabel}` : "";
  if (b.kind === "outright") return `${b.playerName ?? "?"} to win${odds}`;
  if (b.kind === "top-finish")
    return `${b.playerName ?? "?"} top ${b.cutoff ?? "?"}${odds}`;
  if (b.kind === "round-score")
    return `${b.playerName ?? "?"} R${b.round ?? "?"} ${b.side ?? ""} ${b.line ?? ""}${odds}`;
  if (b.kind === "winning-score")
    return `Winning score ${b.side ?? ""} ${b.line ?? ""}${odds}`;
  return "Bet";
}

function pnl(b: HistoryBet): number | null {
  if (b.settledAt === null || b.settledWon === null) return null;
  if (b.settledWon) return b.stake * b.oddsTaken - b.stake;
  return -b.stake;
}

/** Group settled-bet pnl into a cumulative running total keyed by
 *  the bet's settled_at timestamp. Pending bets are excluded — we
 *  don't know their outcome yet so they don't move the line. */
function buildPnlSeries(bets: HistoryBet[]): { ts: number; cum: number }[] {
  const settled = bets
    .filter((b) => b.settledAt !== null && b.settledWon !== null)
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
  let running = 0;
  return settled.map((b) => {
    const v = pnl(b);
    if (v !== null) running += v;
    return { ts: b.settledAt!, cum: running };
  });
}

function PnlChart({ series }: { series: { ts: number; cum: number }[] }) {
  if (series.length < 2) return null;
  const W = 600;
  const H = 200;
  const PAD = { top: 18, right: 16, bottom: 28, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xs = series.map((p) => p.ts);
  const ys = series.map((p) => p.cum);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMinRaw = Math.min(0, ...ys);
  const yMaxRaw = Math.max(0, ...ys);
  const yPad = (yMaxRaw - yMinRaw) * 0.12 || 1;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const xToPx = (x: number) =>
    PAD.left + ((x - xMin) / Math.max(1, xMax - xMin)) * innerW;
  const yToPx = (y: number) =>
    PAD.top + ((yMax - y) / Math.max(1, yMax - yMin)) * innerH;
  const linePath = series
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xToPx(p.ts).toFixed(1)},${yToPx(p.cum).toFixed(1)}`,
    )
    .join(" ");
  const zeroY = yToPx(0);
  const lastY = ys[ys.length - 1];
  const lastColor = lastY >= 0 ? "var(--up, #4d8826)" : "var(--down, #c4322d)";
  const fillColor =
    lastY >= 0
      ? "rgba(123, 174, 63, 0.18)"
      : "rgba(248, 113, 113, 0.16)";
  const firstX = xToPx(xs[0]);
  const lastX = xToPx(xs[xs.length - 1]);
  const areaPath = `M${firstX.toFixed(1)},${zeroY.toFixed(1)} ${series
    .map((p) => `L${xToPx(p.ts).toFixed(1)},${yToPx(p.cum).toFixed(1)}`)
    .join(" ")} L${lastX.toFixed(1)},${zeroY.toFixed(1)} Z`;

  // Format the x-axis labels.
  const startDate = new Date(xs[0]).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const endDate = new Date(xs[xs.length - 1]).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

  return (
    <svg
      className="history-chart"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative profit and loss over time"
    >
      {/* tinted area under the line */}
      <path d={areaPath} fill={fillColor} />
      {/* zero baseline */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="3,3"
      />
      <text
        x={PAD.left - 10}
        y={zeroY + 4}
        fontSize={12}
        fontWeight={700}
        fill="var(--muted)"
        textAnchor="end"
      >
        £0
      </text>
      <text
        x={PAD.left - 10}
        y={yToPx(yMax) + 4}
        fontSize={12}
        fontWeight={700}
        fill="var(--muted)"
        textAnchor="end"
      >
        {gbp.format(yMax)}
      </text>
      {yMin < 0 && (
        <text
          x={PAD.left - 10}
          y={yToPx(yMin) + 4}
          fontSize={12}
          fontWeight={700}
          fill="var(--muted)"
          textAnchor="end"
        >
          {gbp.format(yMin)}
        </text>
      )}
      {/* x-axis date labels */}
      <text
        x={PAD.left}
        y={H - 8}
        fontSize={11}
        fontWeight={600}
        fill="var(--muted)"
      >
        {startDate}
      </text>
      <text
        x={W - PAD.right}
        y={H - 8}
        fontSize={11}
        fontWeight={600}
        fill="var(--muted)"
        textAnchor="end"
      >
        {endDate}
      </text>
      {/* line on top */}
      <path
        d={linePath}
        stroke={lastColor}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* a faint dot per settled bet */}
      {series.map((p, i) => (
        <circle
          key={i}
          cx={xToPx(p.ts)}
          cy={yToPx(p.cum)}
          r={2.5}
          fill="var(--bg, white)"
          stroke={lastColor}
          strokeWidth={1.5}
        />
      ))}
      {/* prominent dot on the latest point */}
      <circle
        cx={xToPx(series[series.length - 1].ts)}
        cy={yToPx(lastY)}
        r={5}
        fill={lastColor}
      />
    </svg>
  );
}

interface KindBreakdown {
  kind: string;
  total: number;
  settled: number;
  won: number;
  profit: number;
}

function bucketByKind(bets: HistoryBet[]): KindBreakdown[] {
  const m = new Map<string, KindBreakdown>();
  const label = (k: string) => {
    switch (k) {
      case "outright":
        return "Outright";
      case "top-finish":
        return "Top finish";
      case "round-score":
        return "Round score";
      case "winning-score":
        return "Winning score";
      default:
        return k;
    }
  };
  for (const b of bets) {
    const key = label(b.kind);
    const row = m.get(key) ?? {
      kind: key,
      total: 0,
      settled: 0,
      won: 0,
      profit: 0,
    };
    row.total++;
    if (b.settledAt !== null && b.settledWon !== null) {
      row.settled++;
      if (b.settledWon) {
        row.won++;
        row.profit += b.stake * b.oddsTaken - b.stake;
      } else {
        row.profit -= b.stake;
      }
    }
    m.set(key, row);
  }
  return Array.from(m.values()).sort((a, b) => b.total - a.total);
}

/** Group bets into chunks by tournament-ish bucket. We don't store
 *  tournament_id on bets yet, so we approximate via the placed-at
 *  week. Week boundary = Thursday (the typical PGA Tour event start)
 *  to Wednesday. Anything older than 28 days from the most recent
 *  bet just lands in an "older" bucket. */
function groupByTournamentWeek(
  bets: HistoryBet[],
): Array<{ label: string; bets: HistoryBet[] }> {
  if (bets.length === 0) return [];
  const sorted = [...bets].sort((a, b) => b.placedAt - a.placedAt);
  const buckets = new Map<string, HistoryBet[]>();
  for (const b of sorted) {
    const d = new Date(b.placedAt);
    // Snap to the prior Thursday (UTC).
    const day = d.getUTCDay(); // Sun=0, Thu=4
    const daysBack = (day - 4 + 7) % 7;
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() - daysBack);
    thursday.setUTCHours(0, 0, 0, 0);
    const key = thursday.toISOString().slice(0, 10);
    const arr = buckets.get(key) ?? [];
    arr.push(b);
    buckets.set(key, arr);
  }
  const groups = Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, arr]) => {
      const start = new Date(key + "T00:00:00Z");
      const label = `Week of ${start.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: start.getUTCFullYear() !== new Date().getUTCFullYear() ? "numeric" : undefined,
      })}`;
      return { label, bets: arr };
    });
  return groups;
}

export default function HistoryClient({
  hideList = false,
}: {
  /** When true, suppress the chronological bet list at the bottom —
   *  the /bets page sets this so the list doesn't duplicate the
   *  BetTracker that's already rendered above. */
  hideList?: boolean;
} = {}) {
  const { user, loading: authLoading } = useAuth();
  const [bets, setBets] = useState<HistoryBet[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setBets([]);
      return;
    }
    fetch("/api/bets/history", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setBets(j.bets ?? []))
      .catch(() => setBets([]));
  }, [user, authLoading]);

  const stats = useMemo(() => {
    if (!bets || bets.length === 0)
      return { total: 0, settled: 0, won: 0, profit: 0, stakeSettled: 0 };
    let won = 0;
    let profit = 0;
    let stakeSettled = 0;
    let settled = 0;
    for (const b of bets) {
      if (b.settledAt !== null && b.settledWon !== null) {
        settled++;
        stakeSettled += b.stake;
        if (b.settledWon) {
          won++;
          profit += b.stake * b.oddsTaken - b.stake;
        } else {
          profit -= b.stake;
        }
      }
    }
    return { total: bets.length, settled, won, profit, stakeSettled };
  }, [bets]);

  const series = useMemo(() => (bets ? buildPnlSeries(bets) : []), [bets]);
  const groups = useMemo(() => (bets ? groupByTournamentWeek(bets) : []), [bets]);
  const byKind = useMemo(() => (bets ? bucketByKind(bets) : []), [bets]);

  if (authLoading || bets === null) {
    return <p className="feed-empty">Loading your history…</p>;
  }
  if (!user) {
    return (
      <div className="tipster-create-gate">
        <p>
          Sign in to see your bet history. Tap the auth chip in the top
          right of the live feed.
        </p>
      </div>
    );
  }
  if (bets.length === 0) {
    return (
      <p className="feed-empty">
        You haven&apos;t placed any bets yet. Add one from the live feed
        and your history starts here.
      </p>
    );
  }

  const winRate = stats.settled > 0
    ? Math.round((stats.won / stats.settled) * 100)
    : null;
  const roi = stats.stakeSettled > 0
    ? Math.round((stats.profit / stats.stakeSettled) * 100)
    : null;

  return (
    <section className="history">
      <div className="history-stats">
        <div className="history-stat">
          <div className="history-stat-num">{stats.total}</div>
          <div className="history-stat-label">Total bets</div>
        </div>
        <div className="history-stat">
          <div className="history-stat-num">
            {winRate !== null ? `${winRate}%` : "—"}
          </div>
          <div className="history-stat-label">
            Win rate{" "}
            <span className="history-stat-sub">
              ({stats.won}/{stats.settled})
            </span>
          </div>
        </div>
        <div className="history-stat">
          <div
            className={`history-stat-num ${
              stats.profit > 0
                ? "bets-profit-up"
                : stats.profit < 0
                  ? "bets-profit-down"
                  : ""
            }`}
          >
            {stats.profit >= 0 ? "+" : ""}
            {gbp.format(stats.profit)}
          </div>
          <div className="history-stat-label">
            Profit{" "}
            <span className="history-stat-sub">
              {roi !== null ? `(${roi > 0 ? "+" : ""}${roi}% ROI)` : ""}
            </span>
          </div>
        </div>
      </div>

      {series.length >= 2 && (
        <div className="history-chart-wrap">
          <h3 className="history-section-title">Running P&L</h3>
          <PnlChart series={series} />
        </div>
      )}

      {byKind.length > 0 && (
        <div className="history-breakdown">
          <h3 className="history-section-title">By bet type</h3>
          <ul className="history-breakdown-list">
            {byKind.map((row) => {
              const winRate =
                row.settled > 0
                  ? Math.round((row.won / row.settled) * 100)
                  : null;
              const profitClass =
                row.profit > 0
                  ? "bets-profit-up"
                  : row.profit < 0
                    ? "bets-profit-down"
                    : "";
              return (
                <li key={row.kind} className="history-breakdown-row">
                  <span className="history-breakdown-kind">{row.kind}</span>
                  <span className="history-breakdown-stats">
                    {row.total} bets
                    {row.settled > 0 && (
                      <>
                        {" · "}
                        {winRate}% win{" "}
                        <span className="history-stat-sub">
                          ({row.won}/{row.settled})
                        </span>
                      </>
                    )}
                  </span>
                  {row.settled > 0 && (
                    <span className={`history-breakdown-pnl ${profitClass}`}>
                      {row.profit >= 0 ? "+" : ""}
                      {gbp.format(row.profit)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!hideList && <div className="history-list">
        {groups.map((g) => (
          <div key={g.label} className="history-group">
            <h3 className="history-section-title">{g.label}</h3>
            <ul className="history-bets">
              {g.bets.map((b) => {
                const v = pnl(b);
                const pending = b.settledAt === null;
                const won = b.settledWon === true;
                return (
                  <li key={b.id} className="history-row">
                    <Link
                      href={`/live/bet/${b.id}`}
                      className="history-row-link"
                    >
                      <div className="history-row-main">
                        <div className="history-row-desc">{describe(b)}</div>
                        <div className="history-row-sub">
                          {gbp.format(b.stake)} stake ·{" "}
                          {new Date(b.placedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                          {b.sourceTipId && " · via tipster"}
                          {b.channelId && " · posted as tip"}
                        </div>
                      </div>
                      <div className="history-row-right">
                        <span
                          className={`history-row-pill ${
                            pending
                              ? "history-row-pill-pending"
                              : won
                                ? "history-row-pill-won"
                                : "history-row-pill-lost"
                          }`}
                        >
                          {pending ? "Pending" : won ? "Won" : "Lost"}
                        </span>
                        {v !== null && (
                          <span
                            className={`history-row-pnl ${
                              v > 0
                                ? "bets-profit-up"
                                : v < 0
                                  ? "bets-profit-down"
                                  : ""
                            }`}
                          >
                            {v > 0 ? "+" : ""}
                            {gbp.format(v)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>}
    </section>
  );
}
