"use client";

import { useCallback, useEffect, useState } from "react";
import Chart from "./Chart";

export interface Row {
  dgId: string;
  name: string;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
  noSkill?: boolean;
}

interface FetchResp {
  ok: boolean;
  error?: string;
  count?: number;
  generatedAt?: number;
  rows?: Row[];
}

/** Poll cadence — 60 s is plenty for a golf round; players finish
 *  at roughly 15 min intervals so refreshing more often is waste. */
const POLL_MS = 60_000;

export default function Page() {
  const [data, setData] = useState<FetchResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/tee-time-scoring", {
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResp;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "20px 16px 60px",
        fontFamily:
          "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
        color: "oklch(0.2 0.02 150)",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>
        Skill-adjusted score vs tee time — R1
      </h1>
      <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
        Players who have completed R1 only. Points below zero outperformed
        their skill baseline; above zero underperformed. Graph updates on a
        rolling 60-second poll as more players finish.
      </p>
      {error || (data && !data.ok) ? (
        <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
          Couldn&apos;t load data: {error ?? data?.error}
        </p>
      ) : !data ? (
        <p style={{ marginTop: 20 }}>Loading…</p>
      ) : !data.rows || data.rows.length === 0 ? (
        <p style={{ marginTop: 20 }}>
          Nobody has finished R1 yet — check back after the first group is
          done.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 11, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
            {data.count} players finished ·{" "}
            {data.generatedAt
              ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
              : ""}
          </p>
          <Chart rows={data.rows} />
        </>
      )}
    </main>
  );
}
