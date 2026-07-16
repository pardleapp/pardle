import Chart from "./Chart";

export const dynamic = "force-dynamic";

interface Row {
  dgId: string;
  name: string;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
}

interface FetchResp {
  ok: boolean;
  error?: string;
  count?: number;
  generatedAt?: number;
  rows?: Row[];
}

async function loadRows(): Promise<FetchResp> {
  // Fetch server-side from our own API route so the DataGolf key stays
  // on the server. Absolute URL required inside a server component.
  const base =
    process.env.NEXT_PUBLIC_SITE_URL || "https://pardle.app";
  const res = await fetch(`${base}/api/analysis/tee-time-scoring`, {
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return (await res.json()) as FetchResp;
}

export default async function Page() {
  const data = await loadRows();
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
        DataGolf field + skill ratings, live R1 score. Points below zero
        outperformed their skill baseline; above zero underperformed. Cluster
        near a tee-time band tells you conditions changed for that wave.
      </p>
      {!data.ok ? (
        <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
          Couldn&apos;t load data: {data.error}
        </p>
      ) : !data.rows || data.rows.length === 0 ? (
        <p style={{ marginTop: 20 }}>
          No rows yet — R1 might not have live scores populated in DataGolf.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 11, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
            {data.count} players ·{" "}
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
