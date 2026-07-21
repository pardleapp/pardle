"use client";

/**
 * Ranked list of the players whose average tee shot is closest to
 * the target player. Uses the /api/tee-shot-similar endpoint which
 * scores by std-normalised euclidean distance across the profile
 * dimensions.
 */

import { useEffect, useState } from "react";

interface DimensionGap {
  self: number;
  other: number;
  gapStd: number;
}

interface Match {
  playerId: string;
  playerName: string;
  shotCount: number;
  cosine: number;
  distance: number;
  dimensionGap: Record<string, DimensionGap>;
}

interface Resp {
  ok: boolean;
  target?: { playerId: string; playerName: string; shotCount: number };
  matches?: Match[];
  error?: string;
}

interface Props {
  playerId: string;
}

const GAP_LABELS: Array<{ key: string; label: string; unit: string }> = [
  { key: "ballSpeed", label: "ball speed", unit: "mph" },
  { key: "carry", label: "carry", unit: "yd" },
  { key: "apexHeight", label: "apex", unit: "ft" },
  { key: "curve", label: "curve", unit: "yd" },
];

/** Format the two biggest gaps into a short "same shape, but …" line. */
function gapSummary(m: Match): string {
  const rows = GAP_LABELS.map(({ key, label, unit }) => {
    const g = m.dimensionGap[key];
    if (!g) return null;
    const diff = g.other - g.self;
    return { label, unit, diff, absStd: Math.abs(g.gapStd) };
  })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.absStd - a.absStd)
    .slice(0, 2);
  return rows
    .map((r) => {
      const sign = r.diff > 0 ? "+" : "−";
      return `${sign}${Math.abs(r.diff).toFixed(1)} ${r.unit} ${r.label}`;
    })
    .join(" · ");
}

export default function SimilarList({ playerId }: Props) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/tee-shot-similar?playerId=${encodeURIComponent(playerId)}&limit=10`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as Resp;
        if (!alive) return;
        if (!json.ok) {
          setError(json.error ?? "no similar players");
          setData(null);
        } else {
          setData(json);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "network error");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [playerId]);

  return (
    <div
      style={{
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 10,
        background: "white",
        padding: 14,
        marginTop: 12,
      }}
    >
      <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>
        Closest drivers on tour
      </h3>
      <p
        style={{
          fontSize: 11,
          color: "oklch(0.5 0.02 150)",
          margin: "0 0 10px",
        }}
      >
        Ranked by how far each player&apos;s mean radar profile sits from
        this one in normalised distance space — smaller number = more
        similar. The line beside each name calls out the two biggest
        differences.
      </p>
      {loading ? (
        <p style={{ fontSize: 12, color: "oklch(0.5 0.02 150)" }}>
          Comparing profiles…
        </p>
      ) : error ? (
        <p style={{ fontSize: 12, color: "oklch(0.5 0.16 25)" }}>
          {error}
        </p>
      ) : !data?.matches?.length ? (
        <p style={{ fontSize: 12, color: "oklch(0.5 0.02 150)" }}>
          No matches found — need more players in the archive.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {data.matches.map((m, i) => (
            <li
              key={m.playerId}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                alignItems: "baseline",
                padding: "6px 4px",
                borderBottom: "1px solid oklch(0.94 0.008 95)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "oklch(0.5 0.02 150)",
                  fontFamily:
                    "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
                  width: 22,
                }}
              >
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "oklch(0.2 0.02 150)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {m.playerName}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "oklch(0.5 0.02 150)",
                  }}
                >
                  {gapSummary(m)}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "oklch(0.35 0.02 150)",
                  fontFamily:
                    "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
                  textAlign: "right",
                  flexShrink: 0,
                }}
                title={`cosine ${m.cosine.toFixed(3)} · ${m.shotCount} drives`}
              >
                {m.distance.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
