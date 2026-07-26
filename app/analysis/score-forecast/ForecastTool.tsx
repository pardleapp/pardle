"use client";

import { useCallback, useEffect, useState } from "react";

// ── Types mirroring the API contract ───────────────────────────────
type Round = 1 | 2 | 3 | 4;
type LevelShiftMode = "average" | "most-recent" | "most-recent-post-cut";

interface HoleForecast {
  hole: number;
  par: number;
  yards: number;
  cluster: string | null;
  windMph: number;
  windDirDeg: number;
  headwind: number;
  avgVsPar: number;
  clusterResidual: number;
  windDelta: number;
  yardsDelta: number;
}
interface PlayerForecast {
  name: string;
  sgTotal: number;
  formAdjustment: number;
  expectedMean: number;
  expectedMedian: number;
  breakdown: {
    fieldMean: number;
    compressedEdge: number;
    formBump: number;
    skewGap: number;
  };
}
interface ForecastResp {
  ok: boolean;
  error?: string;
  targetRound?: Round;
  par?: number;
  wind?: { windMph: number; windDirDeg: number; source: string };
  historicalRoundMean?: number | null;
  levelShift?: number;
  levelShiftAttenuated?: number;
  levelShiftMode?: LevelShiftMode;
  levelShiftPerRound?: Partial<Record<Round, number>>;
  pinDifficultyAdder?: number;
  modelDelta?: number;
  fieldForecast?: number;
  fieldForecastVsPar?: number;
  holes?: HoleForecast[];
  players?: PlayerForecast[];
  warnings?: string[];
}

// ── Player input row ───────────────────────────────────────────────
interface PlayerRow {
  name: string;
  sgTotal: string; // form state; parsed to number on send
  weekRounds: string; // comma-sep list of vs-par values, e.g. "-2,-2,-6"
  formWeight: string;
  compressionFactor: string;
  skewAdjustment: string;
}

const emptyPlayer = (): PlayerRow => ({
  name: "",
  sgTotal: "",
  weekRounds: "",
  formWeight: "0.2",
  compressionFactor: "0.83",
  skewAdjustment: "",
});

function parseCsvNumbers(s: string): number[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

// ── Component ──────────────────────────────────────────────────────
export default function ForecastTool() {
  const [tournamentId, setTournamentId] = useState<string>("R2026525");
  const [targetRound, setTargetRound] = useState<Round>(4);
  /** Yardage source: "auto" reads from the pin sheet (Pardle's
   *  predicted yardage for the round); "manual" opens a 18-hole grid. */
  const [yardsMode, setYardsMode] = useState<"auto" | "manual">("auto");
  const [yardsByHole, setYardsByHole] = useState<Record<number, string>>({});
  const [pinDifficultyAdder, setPinDifficultyAdder] = useState<string>("0");
  const [levelShiftMode, setLevelShiftMode] = useState<LevelShiftMode | "auto">(
    "auto",
  );
  const [levelShiftAttenuation, setLevelShiftAttenuation] =
    useState<string>("1");
  const [useHrrr, setUseHrrr] = useState<boolean>(true);
  const [windOverride, setWindOverride] = useState<boolean>(false);
  const [windMph, setWindMph] = useState<string>("");
  const [windDirDeg, setWindDirDeg] = useState<string>("");
  const [players, setPlayers] = useState<PlayerRow[]>([emptyPlayer()]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ForecastResp | null>(null);

  const runIt = useCallback(async () => {
    setRunning(true);
    try {
      const holes: Record<number, { yards?: number }> = {};
      if (yardsMode === "manual") {
        for (let h = 1; h <= 18; h++) {
          const y = yardsByHole[h]?.trim();
          const yn = y ? Number(y) : undefined;
          if (typeof yn === "number" && Number.isFinite(yn)) {
            holes[h] = { yards: yn };
          }
        }
      }
      const body: Record<string, unknown> = {
        tournamentId,
        targetRound,
        holes,
        // Auto-fetch pin sheet yards + pin coords unless the user
        // opted into manual yardage entry (in which case honour their
        // per-hole values; missing holes still fall back to pin sheet
        // in "auto" mode).
        autoYardageAndPins: yardsMode === "auto",
        pinDifficultyAdder: Number(pinDifficultyAdder) || 0,
        useHrrr,
        levelShiftAttenuation: Number(levelShiftAttenuation) || 1,
      };
      if (levelShiftMode !== "auto") body.levelShiftMode = levelShiftMode;
      if (windOverride) {
        const w = Number(windMph);
        const d = Number(windDirDeg);
        if (Number.isFinite(w) && Number.isFinite(d)) {
          body.windOverride = { windMph: w, windDirDeg: d };
        }
      }
      const parsedPlayers = players
        .map((p) => {
          const sg = Number(p.sgTotal);
          if (!p.name.trim() || !Number.isFinite(sg)) return null;
          const wr = parseCsvNumbers(p.weekRounds);
          const cf = Number(p.compressionFactor);
          const fw = Number(p.formWeight);
          const skew = Number(p.skewAdjustment);
          return {
            name: p.name.trim(),
            sgTotal: sg,
            weekRounds: wr.length ? wr : undefined,
            formWeight: Number.isFinite(fw) ? fw : 0.2,
            compressionFactor: Number.isFinite(cf) ? cf : 0.83,
            skewAdjustment: Number.isFinite(skew) ? skew : undefined,
          };
        })
        .filter(Boolean);
      if (parsedPlayers.length) body.players = parsedPlayers;

      const res = await fetch("/api/scoring-model/forecast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ForecastResp;
      setResult(json);
    } finally {
      setRunning(false);
    }
  }, [
    tournamentId,
    targetRound,
    yardsMode,
    yardsByHole,
    pinDifficultyAdder,
    levelShiftMode,
    levelShiftAttenuation,
    useHrrr,
    windOverride,
    windMph,
    windDirDeg,
    players,
  ]);

  // Kick off once so users see a baseline result immediately.
  useEffect(() => {
    void runIt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Setup panel ────────────────────────────────────────── */}
      <div style={panel()}>
        <h3 style={h3()}>Setup</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Field label="Tournament ID">
            <input
              value={tournamentId}
              onChange={(e) => setTournamentId(e.target.value)}
              style={ip()}
            />
          </Field>
          <Field label="Target round">
            <select
              value={targetRound}
              onChange={(e) => setTargetRound(Number(e.target.value) as Round)}
              style={ip()}
            >
              <option value={1}>R1</option>
              <option value={2}>R2</option>
              <option value={3}>R3</option>
              <option value={4}>R4</option>
            </select>
          </Field>
          <Field label="Setup adjustment (total strokes)">
            <input
              type="number"
              step="0.1"
              value={pinDifficultyAdder}
              onChange={(e) => setPinDifficultyAdder(e.target.value)}
              style={ip()}
              title="Catch-all for setup effects the model can't otherwise see (green firmness, rough length, novel pins outside any historical cluster). Set to 0 if the pin sheet is fully known."
            />
          </Field>
          <Field label="Yardage source">
            <select
              value={yardsMode}
              onChange={(e) =>
                setYardsMode(e.target.value as "auto" | "manual")
              }
              style={ip()}
            >
              <option value="auto">Pardle's predicted (from pin sheet)</option>
              <option value="manual">Manual entry per hole</option>
            </select>
          </Field>
          <Field label="Level shift mode">
            <select
              value={levelShiftMode}
              onChange={(e) =>
                setLevelShiftMode(
                  e.target.value as LevelShiftMode | "auto",
                )
              }
              style={ip()}
            >
              <option value="auto">Auto (post-cut for R3/R4)</option>
              <option value="average">Average all prior rounds</option>
              <option value="most-recent">Most-recent only</option>
              <option value="most-recent-post-cut">
                Most-recent post-cut only
              </option>
            </select>
          </Field>
          <Field label="Level shift attenuation (0–1)">
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={levelShiftAttenuation}
              onChange={(e) => setLevelShiftAttenuation(e.target.value)}
              style={ip()}
            />
          </Field>
          <Field label="HRRR wind">
            <select
              value={useHrrr ? "yes" : "no"}
              onChange={(e) => setUseHrrr(e.target.value === "yes")}
              style={ip()}
            >
              <option value="yes">Use HRRR (default)</option>
              <option value="no">GFS blend</option>
            </select>
          </Field>
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={windOverride}
              onChange={(e) => setWindOverride(e.target.checked)}
            />
            Manual wind override
          </label>
          {windOverride && (
            <>
              <Field label="Wind mph">
                <input
                  type="number"
                  step="0.5"
                  value={windMph}
                  onChange={(e) => setWindMph(e.target.value)}
                  style={ip(120)}
                />
              </Field>
              <Field label="Wind FROM deg">
                <input
                  type="number"
                  step="1"
                  value={windDirDeg}
                  onChange={(e) => setWindDirDeg(e.target.value)}
                  style={ip(120)}
                />
              </Field>
            </>
          )}
        </div>
      </div>

      {/* ── Manual yardage grid (only when opted in) ─────────── */}
      {yardsMode === "manual" && (
        <div style={panel()}>
          <h3 style={h3()}>Yardage per hole</h3>
          <p style={helpText()}>
            Enter yards for every hole. Any blank hole falls back to the
            pin sheet if available, else the fit's historical mean.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
              gap: 8,
            }}
          >
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <div
                key={h}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 6,
                  border: "1px solid oklch(0.9 0.008 95)",
                  borderRadius: 6,
                  background: "white",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "oklch(0.35 0.03 155)",
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                  }}
                >
                  H{h}
                </div>
                <input
                  placeholder="yds"
                  type="number"
                  value={yardsByHole[h] ?? ""}
                  onChange={(e) =>
                    setYardsByHole((prev) => ({
                      ...prev,
                      [h]: e.target.value,
                    }))
                  }
                  style={{ ...ip(), fontSize: 13, padding: "4px 6px" }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Players ────────────────────────────────────────────── */}
      <div style={panel()}>
        <h3 style={h3()}>Players (optional)</h3>
        <p style={helpText()}>
          Add players to see expected mean / median. weekRounds is a
          comma-separated list of vs-par scores this week (e.g.{" "}
          <code>-2,-2,-6</code> for R1/R2/R3). formWeight is the
          Bayesian shrinkage weight (0 = ignore recent; 0.2 default
          per Connolly-Rendleman shrinkage).
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {players.map((p, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1.4fr 0.7fr 1fr 0.6fr 0.6fr 0.6fr auto",
                gap: 6,
                alignItems: "center",
                padding: 8,
                border: "1px solid oklch(0.9 0.008 95)",
                borderRadius: 6,
                background: "white",
              }}
            >
              <input
                placeholder="Name"
                value={p.name}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                style={ip()}
              />
              <input
                placeholder="SG total"
                type="number"
                step="0.05"
                value={p.sgTotal}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, sgTotal: e.target.value } : x,
                    ),
                  )
                }
                style={ip()}
              />
              <input
                placeholder="Week rounds (vs par)"
                value={p.weekRounds}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, weekRounds: e.target.value } : x,
                    ),
                  )
                }
                style={ip()}
              />
              <input
                placeholder="Form w"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={p.formWeight}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, formWeight: e.target.value } : x,
                    ),
                  )
                }
                style={ip()}
                title="Bayesian shrinkage weight on this week's rounds (0-1)"
              />
              <input
                placeholder="Comp"
                type="number"
                step="0.05"
                min="0"
                max="1.2"
                value={p.compressionFactor}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx
                        ? { ...x, compressionFactor: e.target.value }
                        : x,
                    ),
                  )
                }
                style={ip()}
                title="Compression on SG edge (0.83 default for bunching courses)"
              />
              <input
                placeholder="Skew"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={p.skewAdjustment}
                onChange={(e) =>
                  setPlayers((prev) =>
                    prev.map((x, i) =>
                      i === idx
                        ? { ...x, skewAdjustment: e.target.value }
                        : x,
                    ),
                  )
                }
                style={ip()}
                title="Mean-median gap (blank = auto by SG tier)"
              />
              <button
                type="button"
                onClick={() =>
                  setPlayers((prev) =>
                    prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
                  )
                }
                style={btn()}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPlayers((prev) => [...prev, emptyPlayer()])}
            style={btnPrimary()}
          >
            + Add player
          </button>
        </div>
      </div>

      {/* ── Run + results ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={runIt}
          disabled={running}
          style={{ ...btnPrimary(), padding: "10px 20px", fontSize: 15 }}
        >
          {running ? "Running…" : "Run forecast"}
        </button>
      </div>

      {result && result.ok && (
        <ResultsPanel r={result} />
      )}
      {result && !result.ok && (
        <div
          style={{
            padding: 12,
            border: "1px solid oklch(0.85 0.15 28)",
            background: "oklch(0.97 0.05 28)",
            borderRadius: 6,
            color: "oklch(0.3 0.15 28)",
          }}
        >
          Error: {result.error}
        </div>
      )}
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────

function ResultsPanel({ r }: { r: ForecastResp }) {
  if (!r.holes || !r.fieldForecast) return null;
  return (
    <div style={panel()}>
      <h3 style={h3()}>Results — R{r.targetRound}</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Stat
          label="Field forecast"
          value={r.fieldForecast!.toFixed(2)}
          sub={`${(r.fieldForecastVsPar ?? 0) >= 0 ? "+" : ""}${(r.fieldForecastVsPar ?? 0).toFixed(2)} vs par ${r.par}`}
        />
        <Stat
          label="Historical mean"
          value={r.historicalRoundMean?.toFixed(2) ?? "—"}
        />
        <Stat
          label="Wind"
          value={
            r.wind
              ? `${r.wind.windMph.toFixed(1)} mph ${r.wind.windDirDeg.toFixed(0)}°`
              : "—"
          }
          sub={r.wind?.source}
        />
        <Stat
          label="Level shift"
          value={r.levelShift?.toFixed(2) ?? "0.00"}
          sub={
            r.levelShiftAttenuated !== r.levelShift
              ? `attenuated → ${r.levelShiftAttenuated?.toFixed(2)}`
              : r.levelShiftMode
          }
        />
      </div>

      {/* Per-round residual breakdown */}
      {r.levelShiftPerRound &&
        Object.keys(r.levelShiftPerRound).length > 0 && (
          <div style={{ marginBottom: 16, fontSize: 12 }}>
            <span style={{ color: "oklch(0.5 0.02 150)" }}>
              Per-round residuals:
            </span>
            {Object.entries(r.levelShiftPerRound).map(([rr, v]) => (
              <span
                key={rr}
                style={{
                  marginLeft: 8,
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 700,
                }}
              >
                R{rr}: {v!.toFixed(3)} / hole
              </span>
            ))}
          </div>
        )}

      {/* Players table */}
      {r.players && r.players.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>
            Player projections
          </h4>
          <div
            style={{
              overflowX: "auto",
              border: "1px solid oklch(0.9 0.008 95)",
              borderRadius: 6,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "oklch(0.97 0.005 95)" }}>
                  <th style={th()}>Player</th>
                  <th style={th()}>SG</th>
                  <th style={th()}>Compressed edge</th>
                  <th style={th()}>Form bump</th>
                  <th style={th()}>Skew gap</th>
                  <th style={th()}>Expected mean</th>
                  <th style={th()}>Expected median</th>
                </tr>
              </thead>
              <tbody>
                {r.players.map((p, i) => (
                  <tr key={i}>
                    <td style={td(true)}>{p.name}</td>
                    <td style={td()}>{p.sgTotal.toFixed(2)}</td>
                    <td style={td()}>
                      {p.breakdown.compressedEdge >= 0 ? "+" : ""}
                      {p.breakdown.compressedEdge.toFixed(2)}
                    </td>
                    <td style={td()}>
                      {p.formAdjustment >= 0 ? "+" : ""}
                      {p.formAdjustment.toFixed(2)}
                    </td>
                    <td style={td()}>−{p.breakdown.skewGap.toFixed(2)}</td>
                    <td style={{ ...td(), fontWeight: 700 }}>
                      {p.expectedMean.toFixed(2)}
                    </td>
                    <td style={{ ...td(), fontWeight: 800 }}>
                      {p.expectedMedian.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-hole table */}
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
          Per-hole breakdown ({r.holes.length} holes)
        </summary>
        <div
          style={{
            marginTop: 8,
            overflowX: "auto",
            border: "1px solid oklch(0.9 0.008 95)",
            borderRadius: 6,
          }}
        >
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ background: "oklch(0.97 0.005 95)" }}>
                <th style={th()}>H</th>
                <th style={th()}>Par</th>
                <th style={th()}>Yds</th>
                <th style={th()}>Cluster</th>
                <th style={th()}>Head</th>
                <th style={th()}>Cluster res</th>
                <th style={th()}>Wind Δ</th>
                <th style={th()}>Yards Δ</th>
                <th style={th()}>Total vs par</th>
              </tr>
            </thead>
            <tbody>
              {r.holes.map((h) => (
                <tr key={h.hole}>
                  <td style={td(true)}>{h.hole}</td>
                  <td style={td()}>{h.par}</td>
                  <td style={td()}>{h.yards.toFixed(0)}</td>
                  <td style={td()}>{h.cluster ?? "—"}</td>
                  <td style={td()}>{h.headwind.toFixed(1)}</td>
                  <td style={td()}>
                    {h.clusterResidual >= 0 ? "+" : ""}
                    {h.clusterResidual.toFixed(3)}
                  </td>
                  <td style={td()}>
                    {h.windDelta >= 0 ? "+" : ""}
                    {h.windDelta.toFixed(3)}
                  </td>
                  <td style={td()}>
                    {h.yardsDelta >= 0 ? "+" : ""}
                    {h.yardsDelta.toFixed(3)}
                  </td>
                  <td
                    style={{
                      ...td(),
                      fontWeight: 700,
                      color:
                        h.avgVsPar < 0
                          ? "oklch(0.4 0.15 155)"
                          : h.avgVsPar > 0
                            ? "oklch(0.45 0.15 28)"
                            : "inherit",
                    }}
                  >
                    {h.avgVsPar >= 0 ? "+" : ""}
                    {h.avgVsPar.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {r.warnings && r.warnings.length > 0 && (
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "oklch(0.45 0.15 28)",
          }}
        >
          {r.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────
function panel(): React.CSSProperties {
  return {
    padding: 16,
    border: "1px solid oklch(0.9 0.008 95)",
    borderRadius: 8,
    background: "oklch(0.99 0.003 95)",
  };
}
function h3(): React.CSSProperties {
  return {
    margin: "0 0 8px",
    fontSize: 16,
    fontFamily: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
  };
}
function helpText(): React.CSSProperties {
  return {
    fontSize: 12,
    color: "oklch(0.5 0.02 150)",
    marginBottom: 12,
    lineHeight: 1.5,
  };
}
function ip(minWidth = 100): React.CSSProperties {
  return {
    padding: "6px 8px",
    fontSize: 13,
    border: "1px solid oklch(0.85 0.013 95)",
    borderRadius: 4,
    background: "white",
    minWidth,
    fontFamily: "inherit",
  };
}
function btn(): React.CSSProperties {
  return {
    padding: "4px 8px",
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid oklch(0.85 0.013 95)",
    borderRadius: 4,
    background: "white",
    cursor: "pointer",
  };
}
function btnPrimary(): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 700,
    border: "1px solid oklch(0.25 0.15 155)",
    borderRadius: 6,
    background: "oklch(0.35 0.15 155)",
    color: "white",
    cursor: "pointer",
  };
}
function th(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "1px solid oklch(0.9 0.008 95)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "oklch(0.35 0.03 155)",
  };
}
function td(strong = false): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderBottom: "1px solid oklch(0.94 0.008 95)",
    fontFamily: strong
      ? "inherit"
      : "var(--font-mono, monospace)",
    fontWeight: strong ? 700 : 500,
  };
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "oklch(0.5 0.02 150)",
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 6,
        background: "white",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "oklch(0.5 0.02 150)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{ fontSize: 11, color: "oklch(0.5 0.02 150)", marginTop: 4 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
