"use client";

/**
 * Odds compare client component.
 *
 * Renders one row per (player, line, round) with a column per
 * book. Best over + best under across books are outlined emerald.
 * Polls the aggregator every 30s so posted price changes surface
 * within the next tick.
 *
 * Books that haven't been integrated yet render as a dashed
 * placeholder cell — makes gaps obvious without silently hiding
 * the column.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BookKey,
  CompareRow,
  OddsCompareResponse,
  RoundScoreQuote,
} from "@/lib/odds-compare/types";
import { BOOKS } from "@/lib/odds-compare/types";

// Design tokens (match sibling analysis tools).
const T = {
  bg: "oklch(0.972 0.009 95)",
  card: "oklch(0.995 0.004 95)",
  soft: "oklch(0.945 0.012 95)",
  line: "oklch(0.90 0.013 95)",
  lineSoft: "oklch(0.94 0.008 95)",
  ink: "oklch(0.26 0.04 155)",
  muted: "oklch(0.50 0.02 150)",
  dim: "oklch(0.62 0.018 150)",
  emerald: "oklch(0.50 0.13 155)",
  emeraldD: "oklch(0.38 0.13 156)",
  emeraldTint: "oklch(0.96 0.04 155)",
  up: "oklch(0.52 0.14 150)",
  down: "oklch(0.57 0.19 28)",
  tang: "oklch(0.66 0.18 45)",
  fontUi: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
};

const POLL_MS = 30_000;

/** Convert decimal odds to American for display — bettors read
 *  American faster in the US context. Positive when underdog,
 *  negative when favourite. */
function americanFromDecimal(dec: number): string {
  if (!Number.isFinite(dec) || dec <= 1) return "-";
  const implied = 1 / dec;
  if (implied > 0.5) {
    // favourite: negative
    return `−${Math.round(100 / (dec - 1))}`;
  }
  return `+${Math.round((dec - 1) * 100)}`;
}

export default function CompareTool() {
  const [data, setData] = useState<OddsCompareResponse | null>(null);
  const [round, setRound] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/odds-compare?round=${round}`, {
        cache: "no-store",
      });
      const j = (await res.json()) as OddsCompareResponse;
      if (j.ok !== false) setData(j);
      else setError((j as unknown as { error?: string }).error ?? "fetch failed");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setLoading(false);
    }
  }, [round]);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // For each (player, line) row compute the best over + best under
  // across all books that quoted it. Ties get all winners bordered
  // — better than picking arbitrarily.
  const rowsWithBest = useMemo(() => {
    if (!data?.rows) return [] as (CompareRow & {
      bestOver: number | null;
      bestUnder: number | null;
    })[];
    return data.rows.map((row) => {
      let bestOver: number | null = null;
      let bestUnder: number | null = null;
      for (const q of row.quotes) {
        if (q.over != null && (bestOver == null || q.over > bestOver)) {
          bestOver = q.over;
        }
        if (q.under != null && (bestUnder == null || q.under > bestUnder)) {
          bestUnder = q.under;
        }
      }
      return { ...row, bestOver, bestUnder };
    });
  }, [data]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header row: tournament, round tabs, book health */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: T.muted,
              fontWeight: 800,
              fontFamily: T.fontUi,
            }}
          >
            Live event
          </div>
          <div
            style={{
              fontSize: 20,
              fontFamily: T.fontUi,
              fontWeight: 800,
              color: T.ink,
              marginTop: 2,
            }}
          >
            {data?.tournamentName ?? (loading ? "Loading…" : "No active tournament")}
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Round"
          style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
        >
          {[1, 2, 3, 4].map((r) => {
            const active = round === r;
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRound(r)}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: `1px solid ${T.line}`,
                  background: active ? T.ink : "white",
                  color: active ? "white" : T.ink,
                  cursor: "pointer",
                  fontFamily: T.fontUi,
                }}
              >
                R{r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Book status strip */}
      {data?.bookStatus && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            fontFamily: T.fontUi,
          }}
        >
          {BOOKS.map((b) => {
            const st = data.bookStatus[b.key];
            const good = st?.ok && st.playerCount > 0;
            return (
              <span
                key={b.key}
                title={st?.error ?? `${st?.playerCount ?? 0} players`}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${good ? T.emerald : T.line}`,
                  background: good ? T.emeraldTint : "white",
                  color: good ? T.emeraldD : T.dim,
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: good ? T.emerald : T.line,
                  }}
                />
                {b.label}
                {good && (
                  <span style={{ fontFamily: T.fontMono, color: T.emeraldD, fontWeight: 700 }}>
                    {st.playerCount}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: 12,
            background: "oklch(0.97 0.05 40)",
            border: "1px solid oklch(0.85 0.10 40)",
            borderRadius: 8,
            color: "oklch(0.35 0.15 28)",
            fontFamily: T.fontUi,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      {data && rowsWithBest.length > 0 && (
        <div
          style={{
            borderRadius: 10,
            border: `1px solid ${T.line}`,
            background: "white",
            overflow: "hidden",
            overflowX: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: T.fontUi,
              minWidth: 800,
            }}
          >
            <thead>
              <tr style={{ background: T.soft }}>
                <th style={th("left", 220)}>Player · line</th>
                {BOOKS.map((b) => (
                  <th key={b.key} style={th("right")}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span>{b.label}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: T.dim, letterSpacing: 0.4 }}>
                        {b.kindLabel}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsWithBest.map((row, i) => (
                <tr
                  key={`${row.playerName}-${row.line}`}
                  style={{ background: i % 2 === 0 ? "white" : T.soft }}
                >
                  <td style={{ ...tdBase, textAlign: "left" }}>
                    <span style={{ fontWeight: 800, color: T.ink }}>
                      {row.playerName}
                    </span>
                    <span style={{ marginLeft: 8, color: T.muted, fontFamily: T.fontMono, fontWeight: 700 }}>
                      {row.line.toFixed(1)}
                    </span>
                  </td>
                  {BOOKS.map((b) => {
                    const q = row.quotes.find((x) => x.book === b.key);
                    return (
                      <td key={b.key} style={tdBase}>
                        <OddsPill
                          q={q ?? null}
                          isBestOver={q?.over != null && q.over === row.bestOver}
                          isBestUnder={q?.under != null && q.under === row.bestUnder}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && rowsWithBest.length === 0 && (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            color: T.muted,
            fontFamily: T.fontUi,
          }}
        >
          No round-score O/U lines currently posted for R{round}.
          Books usually post day-of; check back closer to tee times.
        </div>
      )}

      {data?.generatedAt && (
        <div
          style={{
            fontSize: 11,
            color: T.dim,
            fontFamily: T.fontUi,
            textAlign: "right",
          }}
        >
          Last update {new Date(data.generatedAt).toLocaleTimeString()}
          {" · refreshes every 30s"}
        </div>
      )}
    </div>
  );
}

/** One book's over/under pair for one row. Emerald border on the
 *  side that's the best price across books. Dashed placeholder
 *  when the book didn't quote this line. */
function OddsPill({
  q,
  isBestOver,
  isBestUnder,
}: {
  q: RoundScoreQuote | null;
  isBestOver: boolean;
  isBestUnder: boolean;
}) {
  if (!q) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "6px 10px",
          borderRadius: 6,
          border: `1px dashed ${T.line}`,
          color: T.dim,
          fontSize: 12,
          fontFamily: T.fontMono,
        }}
      >
        —
      </span>
    );
  }
  const overStr =
    q.over != null ? americanFromDecimal(q.over) : "—";
  const underStr =
    q.under != null ? americanFromDecimal(q.under) : "—";
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      <span
        style={{
          display: "inline-block",
          padding: "4px 8px",
          borderRadius: 4,
          border: isBestOver ? `1.5px solid ${T.emerald}` : `1px solid ${T.line}`,
          background: isBestOver ? T.emeraldTint : "white",
          color: isBestOver ? T.emeraldD : T.ink,
          fontFamily: T.fontMono,
          fontWeight: isBestOver ? 800 : 700,
          fontSize: 12,
          minWidth: 44,
          textAlign: "center",
        }}
      >
        {overStr}
      </span>
      <span
        style={{
          display: "inline-block",
          padding: "4px 8px",
          borderRadius: 4,
          border: isBestUnder ? `1.5px solid ${T.emerald}` : `1px solid ${T.line}`,
          background: isBestUnder ? T.emeraldTint : "white",
          color: isBestUnder ? T.emeraldD : T.ink,
          fontFamily: T.fontMono,
          fontWeight: isBestUnder ? 800 : 700,
          fontSize: 12,
          minWidth: 44,
          textAlign: "center",
        }}
      >
        {underStr}
      </span>
    </div>
  );
}

function th(
  align: "left" | "right",
  width?: number,
): React.CSSProperties {
  return {
    textAlign: align,
    padding: "10px 10px",
    borderBottom: `1px solid ${T.line}`,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: T.muted,
    fontFamily: T.fontUi,
    whiteSpace: "nowrap",
    width,
  };
}

const tdBase: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: `1px solid ${T.lineSoft}`,
  fontSize: 13.5,
  color: T.ink,
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
