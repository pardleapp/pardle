"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types mirroring the API contracts ──────────────────────────────
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
interface PlayerForecastResp {
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
  players?: PlayerForecastResp[];
  warnings?: string[];
}

interface FieldPlayer {
  id: string;
  name: string;
  sgTotal: number | null;
  position: string;
  total: string;
  thru: string;
  playerState: string;
  weekRounds: number[];
  teeTimes: Partial<Record<Round, string>>; // "HH:MM"
}
interface FieldResp {
  ok: boolean;
  tournamentId: string | null;
  tournamentName: string | null;
  players: FieldPlayer[];
}

/** Plain-English "conditions" selector → maps to raw mode + attenuation
 *  under the hood. */
type ConditionsPreset =
  | "same-as-last-round"
  | "based-on-r3"
  | "based-on-r2"
  | "based-on-r1"
  | "average-of-week"
  | "typical"; // ignore this week's data
const CONDITIONS_LABEL: Record<ConditionsPreset, string> = {
  "same-as-last-round": "Conditions like the most recent finished round",
  "based-on-r3": "Conditions like R3",
  "based-on-r2": "Conditions like R2",
  "based-on-r1": "Conditions like R1",
  "average-of-week": "Average of all finished rounds this week",
  typical: "Typical (ignore this week's residuals)",
};

/** Player row in the local state — one per player being projected. */
interface PlayerRow {
  playerId: string; // "" while empty
  name: string;
  sgTotal: string;
  weekRounds: string;
  /** Tee time for the target round in "HH:MM" (local venue time).
   *  Populated from the field endpoint when a player is selected. */
  teeTime: string;
  /** Cache of DG-provided tee times per round so switching target
   *  round auto-updates the tee-time input. */
  teeTimesByRound: Partial<Record<Round, string>>;
  includeForm: boolean;
  advancedOpen: boolean;
  formWeight: string;
  compressionFactor: string;
  skewAdjustment: string;
}

const emptyPlayer = (): PlayerRow => ({
  playerId: "",
  name: "",
  sgTotal: "",
  weekRounds: "",
  teeTime: "",
  teeTimesByRound: {},
  includeForm: true,
  advancedOpen: false,
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

/** Parse "HH:MM" → fractional local hour (14.5 for 14:30). */
function hhmmToHour(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h + min / 60;
}

// ── Component ──────────────────────────────────────────────────────
export default function ForecastTool() {
  const [field, setField] = useState<FieldResp | null>(null);
  const [targetRound, setTargetRound] = useState<Round>(4);
  const [conditions, setConditions] = useState<ConditionsPreset>(
    "same-as-last-round",
  );
  const [yardsSource, setYardsSource] = useState<
    "auto" | "delta-from-prior"
  >("auto");
  const [yardsDeltaSource, setYardsDeltaSource] = useState<Round>(3);
  const [yardsDeltaTotal, setYardsDeltaTotal] = useState<string>("0");
  /** Pin difficulty source: "auto" auto-matches from the pin sheet's
   *  pinByRound coords; "manual" turns off cluster matching and lets
   *  the user set a single total-round stroke adjustment. */
  const [pinsSource, setPinsSource] = useState<"auto" | "manual">("auto");
  const [pinManualAdjustment, setPinManualAdjustment] = useState<string>("0");
  const [useHrrr, setUseHrrr] = useState<boolean>(true);
  const [windOverride, setWindOverride] = useState<boolean>(false);
  const [windMph, setWindMph] = useState<string>("");
  const [windDirDeg, setWindDirDeg] = useState<string>("");
  const [players, setPlayers] = useState<PlayerRow[]>([emptyPlayer()]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ForecastResp | null>(null);

  // Load field roster on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/scoring-model/field");
        const json = (await res.json()) as FieldResp;
        setField(json);
      } catch {
        /* no field — user can still enter SG manually */
      }
    })();
  }, []);

  // ── Translate ConditionsPreset → API level-shift params ─────────
  const conditionsToApi = useCallback(
    (
      preset: ConditionsPreset,
    ): { mode?: LevelShiftMode; attenuation: number } => {
      switch (preset) {
        case "same-as-last-round":
          return { mode: "most-recent-post-cut", attenuation: 1 };
        case "based-on-r3":
          return { mode: "most-recent-post-cut", attenuation: 1 };
        case "based-on-r2":
          return { mode: "most-recent", attenuation: 1 };
        case "based-on-r1":
          return { mode: "most-recent", attenuation: 1 };
        case "average-of-week":
          return { mode: "average", attenuation: 1 };
        case "typical":
          return { mode: undefined, attenuation: 0 };
      }
    },
    [],
  );

  const runIt = useCallback(async () => {
    setRunning(true);
    try {
      const conditionsApi = conditionsToApi(conditions);
      const body: Record<string, unknown> = {
        tournamentId: field?.tournamentId ?? undefined,
        targetRound,
        useHrrr,
        levelShiftAttenuation: conditionsApi.attenuation,
      };
      if (conditionsApi.mode) body.levelShiftMode = conditionsApi.mode;
      // Yardage source
      if (yardsSource === "delta-from-prior") {
        const d = Number(yardsDeltaTotal);
        body.yardsDeltaFromRound = {
          sourceRound: yardsDeltaSource,
          totalDeltaYards: Number.isFinite(d) ? d : 0,
        };
        body.autoYardage = false;
      } else {
        body.autoYardage = true;
      }
      // Pin source
      if (pinsSource === "manual") {
        body.autoPins = false;
        body.pinDifficultyAdder = Number(pinManualAdjustment) || 0;
      } else {
        body.autoPins = true;
      }
      if (windOverride) {
        const w = Number(windMph);
        const dir = Number(windDirDeg);
        if (Number.isFinite(w) && Number.isFinite(dir)) {
          body.windOverride = { windMph: w, windDirDeg: dir };
        }
      }
      const parsedPlayers = players
        .map((p) => {
          const sg = Number(p.sgTotal);
          if (!p.name.trim() || !Number.isFinite(sg)) return null;
          const wr = p.includeForm ? parseCsvNumbers(p.weekRounds) : [];
          const cf = Number(p.compressionFactor);
          const fw = Number(p.formWeight);
          const skew = Number(p.skewAdjustment);
          const teeHour = p.teeTime ? hhmmToHour(p.teeTime) : null;
          return {
            name: p.name.trim(),
            sgTotal: sg,
            weekRounds: wr.length ? wr : undefined,
            formWeight:
              Number.isFinite(fw) && p.includeForm ? fw : 0,
            compressionFactor: Number.isFinite(cf) ? cf : 0.83,
            skewAdjustment: Number.isFinite(skew) ? skew : undefined,
            teeHourLocal: teeHour ?? undefined,
            startHole: 1,
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
    field,
    targetRound,
    conditions,
    conditionsToApi,
    yardsSource,
    yardsDeltaSource,
    yardsDeltaTotal,
    pinsSource,
    pinManualAdjustment,
    useHrrr,
    windOverride,
    windMph,
    windDirDeg,
    players,
    hhmmToHour, // eslint-disable-line
  ]);

  // Fire once the field roster is loaded so users see a baseline
  // (needs at least the tournamentId).
  useEffect(() => {
    if (field?.tournamentId) void runIt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.tournamentId]);

  // When the target round changes, refresh each picked player's
  // tee-time input from their cached teeTimesByRound.
  useEffect(() => {
    setPlayers((prev) =>
      prev.map((p) => {
        if (!p.playerId) return p;
        const tt = p.teeTimesByRound[targetRound] ?? "";
        return tt !== p.teeTime ? { ...p, teeTime: tt } : p;
      }),
    );
  }, [targetRound]);

  const setPlayerRow = (idx: number, patch: Partial<PlayerRow>) =>
    setPlayers((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Setup panel ────────────────────────────────────────── */}
      <div style={panel()}>
        <h3 style={h3()}>Setup</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Field label="Tournament">
            <div
              style={{
                ...ip(),
                display: "flex",
                alignItems: "center",
                background: "oklch(0.97 0.005 155)",
                color: "oklch(0.3 0.03 155)",
                fontWeight: 600,
              }}
            >
              {field?.tournamentName ?? "Loading…"}
            </div>
          </Field>
          <Field label="Round to forecast">
            <select
              value={targetRound}
              onChange={(e) => setTargetRound(Number(e.target.value) as Round)}
              style={ip()}
            >
              <option value={1}>Round 1</option>
              <option value={2}>Round 2</option>
              <option value={3}>Round 3</option>
              <option value={4}>Round 4</option>
            </select>
          </Field>
          <Field
            label="Conditions"
            help="How much do this week's finished rounds tell us about scoring for the forecast round?"
          >
            <select
              value={conditions}
              onChange={(e) =>
                setConditions(e.target.value as ConditionsPreset)
              }
              style={ip()}
            >
              {(
                [
                  "same-as-last-round",
                  "based-on-r3",
                  "based-on-r2",
                  "based-on-r1",
                  "average-of-week",
                  "typical",
                ] as ConditionsPreset[]
              ).map((c) => (
                <option key={c} value={c}>
                  {CONDITIONS_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Yardage"
            help="Pardle's prediction reads the pin sheet; delta lets you say 'course plays X yards longer/shorter than a prior round'."
          >
            <select
              value={yardsSource}
              onChange={(e) =>
                setYardsSource(
                  e.target.value as "auto" | "delta-from-prior",
                )
              }
              style={ip()}
            >
              <option value="auto">Pardle's prediction</option>
              <option value="delta-from-prior">
                Manual delta from a prior round
              </option>
            </select>
          </Field>
          {yardsSource === "delta-from-prior" && (
            <>
              <Field label="Delta from round">
                <select
                  value={yardsDeltaSource}
                  onChange={(e) =>
                    setYardsDeltaSource(Number(e.target.value) as Round)
                  }
                  style={ip()}
                >
                  <option value={1}>R1</option>
                  <option value={2}>R2</option>
                  <option value={3}>R3</option>
                  <option value={4}>R4</option>
                </select>
              </Field>
              <Field label="Total delta (yards)">
                <input
                  type="number"
                  step="5"
                  value={yardsDeltaTotal}
                  onChange={(e) => setYardsDeltaTotal(e.target.value)}
                  style={ip()}
                  placeholder="+100 = 100 yds longer"
                />
              </Field>
            </>
          )}
          <Field
            label="Pins"
            help="Pardle auto-matches each hole's pin position to its historical cluster. Choose manual to skip that and add a single total-round stroke adjustment for pin difficulty (e.g. +0.5 if you think today's sheet is harder than the model would say)."
          >
            <select
              value={pinsSource}
              onChange={(e) =>
                setPinsSource(e.target.value as "auto" | "manual")
              }
              style={ip()}
            >
              <option value="auto">Pardle's automated clusters</option>
              <option value="manual">Manual scoring adjustment</option>
            </select>
          </Field>
          {pinsSource === "manual" && (
            <Field label="Pin adjustment (total strokes for the round)">
              <input
                type="number"
                step="0.1"
                value={pinManualAdjustment}
                onChange={(e) => setPinManualAdjustment(e.target.value)}
                style={ip()}
                placeholder="+0.5 = 0.5 stroke harder"
              />
            </Field>
          )}
          <Field label="Wind">
            <select
              value={
                windOverride ? "override" : useHrrr ? "hrrr" : "gfs-blend"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "override") setWindOverride(true);
                else {
                  setWindOverride(false);
                  setUseHrrr(v === "hrrr");
                }
              }}
              style={ip()}
            >
              <option value="hrrr">Auto (HRRR forecast)</option>
              <option value="gfs-blend">Auto (GFS blend)</option>
              <option value="override">Manual override</option>
            </select>
          </Field>
        </div>
        {windOverride && (
          <div
            style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
          >
            <Field label="Wind mph">
              <input
                type="number"
                step="0.5"
                value={windMph}
                onChange={(e) => setWindMph(e.target.value)}
                style={ip(120)}
              />
            </Field>
            <Field label="Wind FROM (deg)">
              <input
                type="number"
                step="1"
                value={windDirDeg}
                onChange={(e) => setWindDirDeg(e.target.value)}
                style={ip(120)}
              />
            </Field>
          </div>
        )}
      </div>

      {/* ── Players ────────────────────────────────────────────── */}
      <div style={panel()}>
        <h3 style={h3()}>Players</h3>
        <p style={helpText()}>
          Search a player from the field. Strokes-gained rating auto-fills
          from Pardle's pre-tournament model. Rounds played this week
          also auto-fill so form adjustment works out of the box.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {players.map((p, idx) => (
            <PlayerCard
              key={idx}
              row={p}
              field={field}
              targetRound={targetRound}
              onChange={(patch) => setPlayerRow(idx, patch)}
              onRemove={() =>
                setPlayers((prev) =>
                  prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev,
                )
              }
              onlyRow={players.length === 1}
            />
          ))}
          <button
            type="button"
            onClick={() => setPlayers((prev) => [...prev, emptyPlayer()])}
            style={{ ...btnPrimary(), alignSelf: "flex-start" }}
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

      {result && result.ok && <ResultsPanel r={result} />}
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

// ── PlayerCard ────────────────────────────────────────────────────
function PlayerCard({
  row,
  field,
  targetRound,
  onChange,
  onRemove,
  onlyRow,
}: {
  row: PlayerRow;
  field: FieldResp | null;
  targetRound: Round;
  onChange: (patch: Partial<PlayerRow>) => void;
  onRemove: () => void;
  onlyRow: boolean;
}) {
  const [query, setQuery] = useState<string>(row.name);
  useEffect(() => {
    setQuery(row.name);
  }, [row.name]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !field) return [] as FieldPlayer[];
    return field.players
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [field, query]);

  const applyPlayer = (fp: FieldPlayer) => {
    onChange({
      playerId: fp.id,
      name: fp.name,
      sgTotal: fp.sgTotal != null ? String(fp.sgTotal) : "",
      weekRounds: fp.weekRounds.join(","),
      teeTimesByRound: fp.teeTimes,
      teeTime: fp.teeTimes[targetRound] ?? "",
    });
    setQuery(fp.name);
    setDropdownOpen(false);
  };

  return (
    <div
      style={{
        padding: 12,
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 8,
        background: "white",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 0.8fr auto",
          gap: 10,
          alignItems: "end",
        }}
      >
        <Field label="Player">
          <input
            type="search"
            placeholder="Type to search field…"
            value={query}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            onChange={(e) => {
              setQuery(e.target.value);
              setDropdownOpen(true);
              // Clear the underlying player when the search text changes
              // — this is the user typing, not a selection.
              if (row.playerId && e.target.value !== row.name) {
                onChange({ playerId: "", name: e.target.value, sgTotal: "" });
              } else {
                onChange({ name: e.target.value });
              }
            }}
            style={ip()}
          />
          {dropdownOpen && matches.length > 0 && (
            <div
              style={{
                position: "absolute",
                zIndex: 10,
                marginTop: 2,
                background: "white",
                border: "1px solid oklch(0.85 0.013 95)",
                borderRadius: 6,
                boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
                maxHeight: 260,
                overflowY: "auto",
                minWidth: 260,
              }}
            >
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyPlayer(m)}
                  style={{
                    display: "flex",
                    width: "100%",
                    padding: "6px 10px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ flex: 1 }}>{m.name}</span>
                  {m.sgTotal != null && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 700,
                        color: "oklch(0.4 0.15 155)",
                      }}
                    >
                      SG {m.sgTotal >= 0 ? "+" : ""}
                      {m.sgTotal.toFixed(2)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Season SG">
          <input
            type="number"
            step="0.05"
            placeholder={row.playerId ? "auto" : "type or pick"}
            value={row.sgTotal}
            onChange={(e) => onChange({ sgTotal: e.target.value })}
            style={ip()}
          />
        </Field>
        <Field
          label="Tee time"
          help="Local time (HH:MM). When set, the model reads HRRR wind at the specific hour this player will face each hole — late tee times facing a building afternoon wind get a properly harder projection than a day-avg forecast."
        >
          <input
            placeholder="HH:MM"
            value={row.teeTime}
            onChange={(e) => onChange({ teeTime: e.target.value })}
            style={ip()}
          />
        </Field>
        <button type="button" onClick={onRemove} disabled={onlyRow} style={btn()}>
          ✕
        </button>
      </div>
      {row.weekRounds && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "oklch(0.5 0.02 150)",
          }}
        >
          Rounds this week (auto-filled):{" "}
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 700,
              color: "oklch(0.3 0.02 150)",
            }}
          >
            {row.weekRounds}
          </span>{" "}
          — used for form adjustment when the toggle below is on.
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 12,
          alignItems: "center",
          fontSize: 12,
          color: "oklch(0.45 0.02 155)",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={row.includeForm}
            onChange={(e) => onChange({ includeForm: e.target.checked })}
          />
          Use form adjustment from this week's rounds
        </label>
        <button
          type="button"
          onClick={() => onChange({ advancedOpen: !row.advancedOpen })}
          style={{ ...btn(), fontSize: 11 }}
        >
          {row.advancedOpen ? "Hide" : "Show"} advanced
        </button>
      </div>
      {row.advancedOpen && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: "oklch(0.98 0.005 155)",
            borderRadius: 6,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <Field
            label="Form weight"
            help="How much this week's rounds shift the projection. 0.2 default per Connolly-Rendleman shrinkage. 0 = ignore form, 0.5 = aggressive."
          >
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={row.formWeight}
              onChange={(e) => onChange({ formWeight: e.target.value })}
              style={ip()}
            />
          </Field>
          <Field
            label="Skill compression"
            help="How much this course flattens the elite-vs-field gap. 0.83 default at bunching courses like this one. 1.0 = no compression."
          >
            <input
              type="number"
              step="0.05"
              min="0"
              max="1.2"
              value={row.compressionFactor}
              onChange={(e) =>
                onChange({ compressionFactor: e.target.value })
              }
              style={ip()}
            />
          </Field>
          <Field
            label="Skew adjustment"
            help="Mean-median gap. Auto by SG tier: elite ~0.20, mid ~0.25, below-avg ~0.30. Higher = more optimistic median vs mean."
          >
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              placeholder="auto"
              value={row.skewAdjustment}
              onChange={(e) => onChange({ skewAdjustment: e.target.value })}
              style={ip()}
            />
          </Field>
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
                  <th style={th()}>Edge</th>
                  <th style={th()}>Form bump</th>
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
    width: "100%",
    boxSizing: "border-box",
  };
}
function btn(): React.CSSProperties {
  return {
    padding: "4px 10px",
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
    fontFamily: strong ? "inherit" : "var(--font-mono, monospace)",
    fontWeight: strong ? 700 : 500,
  };
}
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        position: "relative",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "oklch(0.5 0.02 150)",
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}
        title={help}
      >
        {label}
        {help && (
          <span
            style={{
              marginLeft: 4,
              color: "oklch(0.6 0.02 150)",
              fontWeight: 600,
              cursor: "help",
            }}
            title={help}
          >
            ⓘ
          </span>
        )}
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
