"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  fitRowCount?: number;
  lowSample?: boolean;
}
interface PlayerForecastResp {
  name: string;
  dgId?: string;
  sgTotal: number;
  formAdjustment: number;
  expectedMean: number;
  expectedMedian: number;
  /** One-σ round-score spread. Sourced from either the player's own
   *  historical rounds at the venue (`player-history`) or the course
   *  baseline (`course-baseline`). */
  roundScoreSigma?: number;
  roundScoreSigmaSource?: "player-history" | "course-baseline";
  /** P(round ≤ score) map keyed by absolute-score string ("64", "65",
   *  ..., "76"). Values are 0..1. Computed from expectedMedian +
   *  roundScoreSigma via a Gaussian approximation. */
  probScoreUnder?: Record<string, number>;
  /** DataGolf's own pre-tournament probability distribution for the
   *  player. Passed through unchanged. */
  dgProbs?: DgProbsInput;
  breakdown: {
    fieldMean: number;
    compressedEdge: number;
    rawCompressedEdge?: number;
    fieldMeanEdge?: number;
    formBump: number;
    skewGap: number;
    teeTimeAdjusted?: boolean;
    teeTimeWind?: { windMph: number; windDirDeg: number };
    formPersistencePerRound?: Array<number | null>;
  };
}
interface ForecastResp {
  ok: boolean;
  error?: string;
  /** Set when the current tour stop is a course the scoring model
   *  hasn't been trained on yet. Rendered as a friendly "we need
   *  history at this venue first" panel, not an error banner. */
  newVenue?: boolean;
  targetRound?: Round;
  par?: number;
  wind?: { windMph: number; windDirDeg: number; source: string };
  historicalRoundMean?: number | null;
  /** Historical median field score for the same round (median-of-
   *  yearly-medians). Books set round-score O/U lines against the
   *  median, so bettors want this alongside the mean. */
  historicalRoundMedian?: number | null;
  /** Course-level mean-median gap in strokes — how right-skewed the
   *  venue's field-round distribution is on average. */
  historicalMeanMedianGap?: number;
  levelShift?: number;
  levelShiftAttenuated?: number;
  levelShiftMode?: LevelShiftMode;
  levelShiftPerRound?: Partial<Record<Round, number>>;
  pinDifficultyAdder?: number;
  modelDelta?: number;
  fieldForecast?: number;
  fieldForecastVsPar?: number;
  /** Field median forecast — derived from `fieldForecast` minus the
   *  venue's typical (mean − median) gap. */
  fieldForecastMedian?: number;
  /** One-σ spread of the field-round-score distribution today. */
  fieldForecastSigma?: number;
  holes?: HoleForecast[];
  players?: PlayerForecastResp[];
  warnings?: string[];
}

interface RoundSg {
  sgOtt?: number | null;
  sgApp?: number | null;
  sgArg?: number | null;
  sgPutt?: number | null;
}
interface DgProbsInput {
  win?: number;
  top3?: number;
  top5?: number;
  top10?: number;
  top20?: number;
  top30?: number;
  makeCut?: number;
  firstRoundLead?: number;
  ev?: number;
}
interface FieldPlayer {
  id: string;
  name: string;
  sgTotal: number | null;
  /** Where sgTotal came from — signals whether the number already
   *  includes course-fit (event-specific) or is season-generic. */
  sgSource: "event-specific" | "season-generic" | null;
  position: string;
  total: string;
  thru: string;
  playerState: string;
  weekRounds: number[];
  /** Index-aligned with weekRounds. Present when DG live stats have
   *  posted an SG breakdown for that finished round. Drives the
   *  persistence-weighted form adjustment on the server. */
  weekRoundsSg: Array<RoundSg | null>;
  teeTimes: Partial<Record<Round, string>>; // "HH:MM"
  /** DataGolf's own pre-tournament probability distribution for this
   *  player. Passed through to the forecast request so the tool can
   *  render our probabilities and theirs side-by-side. */
  dgProbs?: DgProbsInput;
  /** DataGolf dg_id — needed for per-player round-score sigma lookup
   *  in the tournament config. */
  dgId?: string;
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
  /** DataGolf dg_id — captured when the player is picked from the
   *  field. Threaded to the forecast API so it can look up per-
   *  player round-score sigma from the venue historicals. */
  dgId?: string;
  /** DataGolf tail probabilities passed through to the forecast API
   *  so they're echoed alongside our own. */
  dgProbs?: DgProbsInput;
  sgTotal: string;
  /** Signals whether sgTotal already includes course-fit adjustment
   *  (from CSV) or is a season-generic universal rating. Passed to
   *  the server so it can pick the right compression default. */
  sgSource: "event-specific" | "season-generic" | null;
  weekRounds: string;
  /** Per-round SG breakdown captured when the player was picked from
   *  the field. Sent alongside weekRounds when its length matches the
   *  parsed weekRounds count — otherwise dropped so the server
   *  quietly falls back to the vs-par-only form model. */
  weekRoundsSg: Array<RoundSg | null>;
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
  sgSource: null,
  weekRounds: "",
  weekRoundsSg: [],
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
  /** Modal state for the "you're using both level shift AND a pin
   *  adder" double-count warning. Non-null when we're waiting on the
   *  user to confirm or cancel. */
  const [doubleCountConfirm, setDoubleCountConfirm] = useState<
    null | (() => void)
  >(null);
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
          // Empty-string → Number → 0, which would silently zero
          // out the adjustment. Trim first and only parse when
          // non-empty so blanks fall through to server auto-defaults.
          const cfStr = p.compressionFactor.trim();
          const fwStr = p.formWeight.trim();
          const skStr = p.skewAdjustment.trim();
          const cf = cfStr ? Number(cfStr) : NaN;
          const fw = fwStr ? Number(fwStr) : NaN;
          const skew = skStr ? Number(skStr) : NaN;
          const teeHour = p.teeTime ? hhmmToHour(p.teeTime) : null;
          // SG breakdown is sent through only when it lines up with
          // the parsed weekRounds count — protects against a user
          // hand-editing the round CSV to a different length.
          const sgAligned =
            p.includeForm &&
            wr.length > 0 &&
            p.weekRoundsSg.length === wr.length
              ? p.weekRoundsSg
              : undefined;
          const defaultCompression =
            p.sgSource === "event-specific" ? 1.0 : 0.83;
          return {
            name: p.name.trim(),
            dgId: p.dgId,
            sgTotal: sg,
            sgSource: p.sgSource ?? undefined,
            weekRounds: wr.length ? wr : undefined,
            weekRoundsSg: sgAligned,
            formWeight:
              Number.isFinite(fw) && p.includeForm ? fw : 0,
            compressionFactor: Number.isFinite(cf) ? cf : defaultCompression,
            skewAdjustment: Number.isFinite(skew) ? skew : undefined,
            teeHourLocal: teeHour ?? undefined,
            startHole: 1,
            // Pass through DataGolf's pre-tournament probability
            // distribution so runForecast can echo them alongside
            // our own probScoreUnder in the response.
            dgProbs: p.dgProbs,
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

  /** Wraps runIt with the double-count warning. If BOTH a non-typical
   *  Conditions preset (which will apply a level shift) AND a non-
   *  zero manual pin adjustment are set, prompt the user before
   *  running — because both terms compress the "how hard is today"
   *  signal and layering them stacks the effects. */
  const attemptRun = useCallback(() => {
    const manualPinActive =
      pinsSource === "manual" &&
      Math.abs(Number(pinManualAdjustment) || 0) > 0.01;
    const levelShiftActive = conditions !== "typical";
    if (manualPinActive && levelShiftActive) {
      setDoubleCountConfirm(() => () => {
        setDoubleCountConfirm(null);
        void runIt();
      });
      return;
    }
    void runIt();
  }, [pinsSource, pinManualAdjustment, conditions, runIt]);

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
        <SectionHeader
          step={1}
          title="Setup"
          subtitle="Tournament, round, and how the model should read this week's conditions"
        />
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
        <SectionHeader
          step={2}
          title="Players"
          subtitle="Search the field — SG rating, tee time, and week rounds auto-fill"
        />
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
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={attemptRun}
              disabled={running}
              style={{
                ...btnPrimary(),
                minWidth: 200,
                opacity: running ? 0.85 : 1,
                cursor: running ? "wait" : "pointer",
              }}
            >
              {running ? (
                <>
                  <RunningDots />
                  <span>Running forecast</span>
                </>
              ) : (
                <>
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                    →
                  </span>
                  <span>Run forecast</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPlayers((prev) => [...prev, emptyPlayer()])}
              style={{
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 700,
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                background: "white",
                color: T.ink,
                cursor: "pointer",
              }}
            >
              + Add another player
            </button>
          </div>
        </div>
      </div>

      {result && result.ok && <ResultsPanel r={result} />}
      {result && !result.ok && result.newVenue && (
        <div
          style={{
            padding: "20px 22px",
            border: "1px solid oklch(0.90 0.013 95)",
            background: "oklch(0.995 0.004 95)",
            borderRadius: 12,
            display: "grid",
            gap: 8,
            maxWidth: 640,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px 4px 8px",
              borderRadius: 999,
              background: "oklch(0.965 0.04 240)",
              color: "oklch(0.55 0.14 245)",
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              width: "fit-content",
              boxShadow: "inset 0 0 0 1px oklch(0.55 0.14 245)",
            }}
          >
            New venue this week
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "oklch(0.26 0.04 155)",
              letterSpacing: -0.2,
              lineHeight: 1.2,
            }}
          >
            No round-score predictions for this course yet
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
              color: "oklch(0.50 0.02 150)",
              fontWeight: 500,
            }}
          >
            The round-score model fits from a full season of per-hole
            historical data at the venue. We&apos;ll have this course
            once we&apos;ve collected that history — try the course
            fit or ballstriking tools in the meantime.
          </p>
        </div>
      )}
      {result && !result.ok && !result.newVenue && (
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
      {doubleCountConfirm && (
        <DoubleCountModal
          onCancel={() => setDoubleCountConfirm(null)}
          onConfirm={doubleCountConfirm}
        />
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
    const sg = fp.sgTotal;
    // Compression default is source-aware: CSV `final_prediction`
    // already includes course-fit, so applying venue compression on
    // top would double-compress. Season-generic ratings still take
    // the venue compression.
    const defaultCompression =
      fp.sgSource === "event-specific" ? "1.0" : "0.83";
    onChange({
      playerId: fp.id,
      name: fp.name,
      dgId: fp.dgId,
      dgProbs: fp.dgProbs,
      sgTotal: sg != null ? String(sg) : "",
      sgSource: fp.sgSource,
      weekRounds: fp.weekRounds.join(","),
      weekRoundsSg: fp.weekRoundsSg,
      teeTimesByRound: fp.teeTimes,
      teeTime: fp.teeTimes[targetRound] ?? "",
      compressionFactor: defaultCompression,
      // Leave skewAdjustment blank — the server defaults to the
      // venue's own empirical (mean − median) gap when the field
      // is empty. The old skill-tier autoSkew proxy (0.20 / 0.25 /
      // 0.30) turned out to be wrong for a lot of players; venue
      // gap is the only signal we have at defensible sample size.
      skewAdjustment: "",
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
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                sgTotal: v,
                // Don't auto-populate skew from SG tier — venue
                // gap wins by default (blank skew field). User
                // can still override in advanced if they want a
                // player-specific number.
              });
            }}
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
        {!onlyRow && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this player"
            aria-label="Remove player"
            style={{
              ...btn(),
              padding: "8px 10px",
              color: T.muted,
            }}
          >
            ✕
          </button>
        )}
      </div>
      {row.weekRounds && <WeekRoundsRow row={row} />}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={() => onChange({ advancedOpen: !row.advancedOpen })}
          style={{
            background: "none",
            border: "none",
            padding: "4px 2px",
            color: T.emerald,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: T.fontUi,
            fontWeight: 800,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          {row.advancedOpen ? "Hide advanced −" : "Show advanced +"}
        </button>
      </div>
      {row.advancedOpen && (
        <div
          style={{
            marginTop: 10,
            padding: "14px 14px 12px",
            background: "oklch(0.98 0.005 155)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: T.ink,
              fontFamily: T.fontUi,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={row.includeForm}
              onChange={(e) => onChange({ includeForm: e.target.checked })}
            />
            Use form adjustment from this week&apos;s rounds
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
            }}
          >
          <Field
            label="Form weight"
            help="How much this week's rounds shift the projection. 0.2 default per Connolly-Rendleman shrinkage. 0 = ignore form, 0.5 = aggressive."
          >
            <Slider
              min={0}
              max={0.5}
              step={0.05}
              recommended={0.2}
              value={row.formWeight}
              onChange={(v) => onChange({ formWeight: v })}
            />
          </Field>
          <Field
            label="Skill compression"
            help="How much this course flattens the elite-vs-field gap. Default depends on the SG source: event-specific SG (already course-fit-adjusted) uses 1.0; season-generic SG uses 0.83 at bunching courses like this."
          >
            <Slider
              min={0.6}
              max={1.2}
              step={0.01}
              recommended={row.sgSource === "event-specific" ? 1.0 : 0.83}
              value={row.compressionFactor}
              onChange={(v) => onChange({ compressionFactor: v })}
            />
          </Field>
          <Field
            label="Skew adjustment"
            help="Mean-median gap. Blank = use the venue's empirical gap from historicals (usually 0.05–0.20). Override with a positive value to force a wider right tail, negative to flip it."
          >
            <Slider
              min={-0.3}
              max={0.5}
              step={0.01}
              recommended={0}
              value={row.skewAdjustment}
              onChange={(v) => onChange({ skewAdjustment: v })}
            />
          </Field>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────
function ResultsPanel({ r }: { r: ForecastResp }) {
  if (!r.holes || !r.fieldForecast || r.par == null) return null;
  const par = r.par;
  const holes = r.holes;
  const players = r.players;
  return (
    <div
      style={{
        ...panel(),
        border: `1.5px solid ${T.emerald}`,
        boxShadow: "0 4px 24px oklch(0.4 0.13 155 / 0.10)",
      }}
    >
      <SectionHeader
        step={3}
        title={`Round ${r.targetRound} forecast`}
        subtitle={
          players && players.length > 0
            ? `Par ${par} · projected round score`
            : `Par ${par} · field baseline for the round`
        }
        accent
      />
      {players && players.length > 0 ? (
        <>
          <FieldContextBand r={r} />
          <PlayerHero players={players} par={par} />
        </>
      ) : (
        <>
          <HeroForecast r={r} />
          <SecondaryStrip r={r} />
        </>
      )}
      <HoleStrip holes={holes} par={par} />
      {r.warnings && r.warnings.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "oklch(0.97 0.05 40)",
            border: `1px solid oklch(0.85 0.10 40)`,
            borderRadius: 6,
            fontSize: 12,
            color: "oklch(0.35 0.15 28)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {r.warnings.map((w, i) => (
            <div key={i}>⚠︎ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The hero — the answer, at full weight. Huge mono number with a
 *  colour-coded vs-par lockup, elevated on an emerald-tinted card so
 *  it clearly reads as the payoff of the whole tool. */
function HeroForecast({ r }: { r: ForecastResp }) {
  const target = r.fieldForecast ?? 0;
  const live = useCountUp(target, 700);
  const vsPar = r.fieldForecastVsPar ?? 0;
  const under = vsPar < 0;
  const scoreColor = under ? T.up : vsPar > 0 ? T.down : T.ink;
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "26px 26px 22px",
        borderRadius: 14,
        background: `linear-gradient(135deg, ${T.emeraldTint} 0%, ${T.card} 100%)`,
        border: `1px solid ${T.line}`,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 20,
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: T.emeraldD,
            fontWeight: 800,
            fontFamily: T.fontUi,
            marginBottom: 6,
          }}
        >
          Field forecast · R{r.targetRound}
        </div>
        <div
          style={{
            fontSize: "clamp(48px, 8vw, 68px)",
            fontFamily: T.fontMono,
            fontWeight: 800,
            color: T.heroInk,
            lineHeight: 1,
            letterSpacing: -0.02,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {live.toFixed(2)}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: T.fontMono,
              fontWeight: 800,
              fontSize: 20,
              color: scoreColor,
              letterSpacing: -0.01,
            }}
          >
            {vsPar >= 0 ? "+" : ""}
            {vsPar.toFixed(2)}
          </div>
          <div
            style={{
              fontSize: 13,
              color: T.muted,
              fontFamily: T.fontUi,
              fontWeight: 600,
            }}
          >
            vs par {r.par ?? "—"} · {under ? "under" : vsPar > 0 ? "over" : "level"}
          </div>
          {typeof r.fieldForecastSigma === "number" &&
            r.fieldForecastSigma > 0 && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  color: T.dim,
                  fontFamily: T.fontUi,
                  fontWeight: 600,
                }}
              >
                ± <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>
                  {r.fieldForecastSigma.toFixed(2)}
                </span> · one-σ round spread
              </div>
            )}
        </div>
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "white",
          border: `1px solid ${T.line}`,
          textAlign: "right",
          fontFamily: T.fontUi,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
            marginBottom: 4,
          }}
        >
          Model delta
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontWeight: 800,
            fontSize: 18,
            color: T.ink,
          }}
        >
          {(r.modelDelta ?? 0) >= 0 ? "+" : ""}
          {(r.modelDelta ?? 0).toFixed(2)}
        </div>
        <div
          style={{
            fontSize: 10,
            color: T.dim,
            marginTop: 2,
          }}
        >
          vs historical mean
        </div>
      </div>
    </div>
  );
}

/** Slim horizontal strip of ancillary metrics — small, muted, factual;
 *  supports the hero without competing with it. */
function SecondaryStrip({ r }: { r: ForecastResp }) {
  const items: Array<{ label: string; value: string; sub?: string }> = [
    {
      label: "Historical mean",
      value: r.historicalRoundMean?.toFixed(2) ?? "—",
      sub: "avg field score, this round",
    },
    {
      label: "Historical median",
      value: r.historicalRoundMedian?.toFixed(2) ?? "—",
      sub:
        typeof r.historicalMeanMedianGap === "number"
          ? `gap ${r.historicalMeanMedianGap >= 0 ? "+" : ""}${r.historicalMeanMedianGap.toFixed(2)} strokes`
          : undefined,
    },
    {
      label: "Field median (today)",
      value: r.fieldForecastMedian?.toFixed(2) ?? "—",
      sub: "mean minus venue skew",
    },
    {
      label: "Wind",
      value: r.wind
        ? `${r.wind.windMph.toFixed(1)} mph`
        : "—",
      sub: r.wind
        ? `from ${r.wind.windDirDeg.toFixed(0)}° · ${r.wind.source}`
        : undefined,
    },
    {
      label: "Level shift",
      value:
        (r.levelShift ?? 0) >= 0
          ? `+${(r.levelShift ?? 0).toFixed(2)}`
          : (r.levelShift ?? 0).toFixed(2),
      sub:
        r.levelShiftAttenuated !== r.levelShift
          ? `attenuated → ${r.levelShiftAttenuated?.toFixed(2)}`
          : r.levelShiftMode,
    },
    {
      label: "Pin adder",
      value:
        (r.pinDifficultyAdder ?? 0) >= 0
          ? `+${(r.pinDifficultyAdder ?? 0).toFixed(2)}`
          : (r.pinDifficultyAdder ?? 0).toFixed(2),
      sub: (r.pinDifficultyAdder ?? 0) !== 0 ? "manual override" : "auto (cluster-matched)",
    },
  ];
  return (
    <div
      style={{
        marginBottom: 20,
        padding: "12px 16px",
        borderRadius: 10,
        background: T.soft,
        border: `1px solid ${T.line}`,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
        fontFamily: T.fontUi,
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: T.muted,
              fontWeight: 800,
            }}
          >
            {it.label}
          </div>
          <div
            style={{
              fontFamily: T.fontMono,
              fontSize: 16,
              fontWeight: 700,
              color: T.ink,
              letterSpacing: -0.01,
            }}
          >
            {it.value}
          </div>
          {it.sub && (
            <div
              style={{
                fontSize: 11,
                color: T.dim,
                fontWeight: 500,
              }}
            >
              {it.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Slim context band that sits ABOVE the player hero when at least
 *  one player is projected. Shows the field baseline (small),
 *  followed by the ancillary metrics as a horizontal row. This is
 *  the "for reference, here's what the average player shoots" band
 *  — the player projection is the star, this is just supporting. */
function FieldContextBand({ r }: { r: ForecastResp }) {
  const fieldForecast = r.fieldForecast ?? 0;
  const vsPar = r.fieldForecastVsPar ?? 0;
  const sigma = r.fieldForecastSigma;
  const modelDelta = r.modelDelta ?? 0;
  const pinAdd = r.pinDifficultyAdder ?? 0;
  return (
    <div
      className="pv-field-context"
      style={{
        marginBottom: 18,
        padding: "12px 16px",
        background: T.soft,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 20,
        alignItems: "center",
        fontFamily: T.fontUi,
      }}
    >
      {/* Mobile layout: stack the two cells vertically, drop the
          right-border divider, and gap them with a dashed rule. The
          auto-1fr grid was pinching both cells at phone widths. */}
      <style>{`
        @media (max-width: 640px) {
          .pv-field-context {
            grid-template-columns: 1fr !important;
            gap: 10px !important;
          }
          .pv-field-context .pv-field-context-left {
            padding-right: 0 !important;
            padding-bottom: 10px !important;
            border-right: none !important;
            border-bottom: 1px dashed ${T.line} !important;
          }
        }
      `}</style>
      <div
        className="pv-field-context-left"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingRight: 20,
          borderRight: `1px solid ${T.line}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          Field baseline · R{r.targetRound}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 22,
              fontWeight: 800,
              color: T.ink,
              letterSpacing: -0.01,
            }}
          >
            {fieldForecast.toFixed(2)}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 14,
              fontWeight: 700,
              color: vsPar < 0 ? T.up : vsPar > 0 ? T.down : T.ink,
            }}
          >
            {vsPar >= 0 ? "+" : ""}
            {vsPar.toFixed(2)}
          </span>
          {typeof sigma === "number" && sigma > 0 && (
            <span
              style={{
                fontSize: 12,
                color: T.dim,
                fontWeight: 600,
              }}
            >
              ± {sigma.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 14,
        }}
      >
        <MiniStat
          label="Model Δ"
          value={
            (modelDelta >= 0 ? "+" : "") + modelDelta.toFixed(2)
          }
        />
        <MiniStat
          label="Historical"
          value={r.historicalRoundMean?.toFixed(2) ?? "—"}
        />
        <MiniStat
          label="Wind"
          value={r.wind ? `${r.wind.windMph.toFixed(1)} mph` : "—"}
          sub={r.wind ? `from ${r.wind.windDirDeg.toFixed(0)}°` : undefined}
        />
        <MiniStat
          label="Level shift"
          value={
            (r.levelShift ?? 0) >= 0
              ? `+${(r.levelShift ?? 0).toFixed(2)}`
              : (r.levelShift ?? 0).toFixed(2)
          }
        />
        <MiniStat
          label="Pin adder"
          value={
            pinAdd !== 0
              ? (pinAdd >= 0 ? "+" : "") + pinAdd.toFixed(2)
              : "auto"
          }
        />
      </div>
    </div>
  );
}

function MiniStat({
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
        display: "flex",
        flexDirection: "column",
        gap: 1,
        fontFamily: T.fontUi,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: T.muted,
          fontWeight: 800,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 14,
          fontWeight: 700,
          color: T.ink,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 10,
            color: T.dim,
            fontWeight: 500,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/** PlayerHero — the star of the results panel when at least one
 *  player has been projected. Each player renders as a big card:
 *  huge name, huge mean/median mono numbers with colour-coded
 *  vs-par lockups, and a breakdown row of SG / edge / form / tee
 *  time. This is the payoff a bettor actually cares about. */
function PlayerHero({
  players,
  par,
}: {
  players: NonNullable<ForecastResp["players"]>;
  par: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        marginBottom: 18,
      }}
    >
      {players.map((p, i) => (
        <PlayerHeroCard key={i} player={p} par={par} />
      ))}
    </div>
  );
}

function PlayerHeroCard({
  player,
  par,
}: {
  player: NonNullable<ForecastResp["players"]>[number];
  par: number;
}) {
  const meanTarget = player.expectedMean;
  const medTarget = player.expectedMedian;
  const meanLive = useCountUp(meanTarget, 700);
  const medLive = useCountUp(medTarget, 700);
  const meanVsPar = meanTarget - par;
  const medVsPar = medTarget - par;
  const under = medVsPar < 0;
  const railColor = under ? T.emerald : medVsPar > 0 ? T.tang : T.line;
  return (
    <div
      style={{
        padding: "24px 26px",
        borderRadius: 14,
        background: `linear-gradient(135deg, ${T.emeraldTint} 0%, ${T.card} 100%)`,
        border: `1px solid ${T.line}`,
        borderLeft: `5px solid ${railColor}`,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: T.emeraldD,
            fontWeight: 800,
            fontFamily: T.fontUi,
            marginBottom: 4,
          }}
        >
          Round projection
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: T.heroInk,
            letterSpacing: -0.005,
            fontFamily: T.fontUi,
            lineHeight: 1.1,
          }}
        >
          {player.name}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
        }}
      >
        <PlayerHeroScore
          label="Expected mean"
          value={meanLive}
          vsPar={meanVsPar}
          help="Long-run average if this player played the round 1,000 times"
        />
        <PlayerHeroScore
          label="Expected median"
          value={medLive}
          vsPar={medVsPar}
          accent
          help="Middle outcome — the typical round. Use for UNDER bets."
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
          padding: "12px 14px",
          background: T.card,
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          fontFamily: T.fontUi,
        }}
      >
        <BreakdownStat
          label="Season SG"
          value={player.sgTotal}
          format={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
        />
        <BreakdownStat
          label="Edge vs field"
          value={player.breakdown.compressedEdge}
          format={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
          sub={
            typeof player.breakdown.rawCompressedEdge === "number" &&
            typeof player.breakdown.fieldMeanEdge === "number" &&
            Math.abs(player.breakdown.fieldMeanEdge) >= 0.01
              ? `${player.breakdown.rawCompressedEdge >= 0 ? "+" : ""}${player.breakdown.rawCompressedEdge.toFixed(2)} vs tour, field averages ${player.breakdown.fieldMeanEdge >= 0 ? "+" : ""}${player.breakdown.fieldMeanEdge.toFixed(2)}`
              : "vs tour baseline"
          }
        />
        <BreakdownStat
          label="Form"
          value={player.formAdjustment}
          format={(v) => (v >= 0 ? "+" : "") + v.toFixed(2)}
        />
        <BreakdownStat
          label="Field @ tee"
          value={player.breakdown.fieldMean}
          format={(v) => v.toFixed(2)}
          sub={
            player.breakdown.teeTimeAdjusted
              ? "tee-time-adjusted"
              : "day average"
          }
        />
      </div>

      <PlayerProbabilityStrip player={player} />
    </div>
  );
}

/** P(under a book O/U line) — six .5-line probability chips
 *  centred on the player's expected median. Values come straight
 *  from probScoreUnder in the forecast response, which is keyed on
 *  the .5 threshold ("68.5") so what the reader sees here is what
 *  a book actually prices. Chip closest to the median is emerald-
 *  tinted so the reader can eyeball where the tool "expects" the
 *  book line to sit. */
function PlayerProbabilityStrip({
  player,
}: {
  player: NonNullable<ForecastResp["players"]>[number];
}) {
  const probs = player.probScoreUnder ?? {};
  const sigma = player.roundScoreSigma;
  const source = player.roundScoreSigmaSource;
  const median = player.expectedMedian;
  if (!probs || Object.keys(probs).length === 0) return null;
  // Six .5 thresholds spanning median-2.5 through median+2.5 —
  // exactly the range a bettor eyeballs against the book's line.
  const centreLine = Math.floor(median) + 0.5;
  const shown = [
    centreLine - 2,
    centreLine - 1,
    centreLine,
    centreLine + 1,
    centreLine + 2,
    centreLine + 3,
  ];
  return (
    <div
      style={{
        padding: "14px 16px",
        background: T.card,
        borderRadius: 8,
        border: `1px solid ${T.line}`,
        fontFamily: T.fontUi,
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          Probability of shooting under the O/U line
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: T.dim,
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
          title={
            source === "player-history"
              ? "σ from this player's actual rounds at this venue"
              : "σ falls back to the venue's course-average — no venue history for this player"
          }
        >
          σ {sigma?.toFixed(2)} ·{" "}
          {source === "player-history" ? "player history" : "course baseline"}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${shown.length}, 1fr)`,
          gap: 8,
        }}
      >
        {shown.map((line) => {
          const p = probs[line.toFixed(1)];
          if (typeof p !== "number") return <div key={line} />;
          // Highlight whichever line sits closest to the expected
          // median — that's where a book would most likely peg the
          // O/U.
          const isCentre = line === centreLine;
          return (
            <div
              key={line}
              style={{
                textAlign: "center",
                padding: "10px 6px",
                borderRadius: 6,
                background: isCentre ? T.emeraldTint : T.soft,
                border: `1px solid ${isCentre ? T.emerald : T.line}`,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: isCentre ? T.emeraldD : T.muted,
                  fontWeight: 800,
                }}
              >
                Under {line.toFixed(1)}
              </div>
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontWeight: 800,
                  fontSize: 20,
                  color: T.heroInk,
                  lineHeight: 1,
                  marginTop: 6,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {(p * 100).toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One of the two big score columns inside PlayerHeroCard. */
function PlayerHeroScore({
  label,
  value,
  vsPar,
  accent = false,
  help,
}: {
  label: string;
  value: number;
  vsPar: number;
  accent?: boolean;
  help?: string;
}) {
  const color = vsPar < 0 ? T.up : vsPar > 0 ? T.down : T.ink;
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: accent ? T.emeraldD : T.muted,
          fontWeight: 800,
          fontFamily: T.fontUi,
          marginBottom: 6,
        }}
        title={help}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "clamp(40px, 6vw, 56px)",
          fontFamily: T.fontMono,
          fontWeight: 800,
          color: T.heroInk,
          lineHeight: 1,
          letterSpacing: -0.02,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(2)}
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          fontFamily: T.fontUi,
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 16,
            fontWeight: 800,
            color,
            letterSpacing: -0.01,
          }}
        >
          {vsPar >= 0 ? "+" : ""}
          {vsPar.toFixed(2)}
        </span>
        <span
          style={{
            fontSize: 12,
            color: T.muted,
            fontWeight: 600,
          }}
        >
          vs par
        </span>
      </div>
    </div>
  );
}

function BreakdownStat({
  label,
  value,
  format,
  sub,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  sub?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: T.muted,
          fontWeight: 800,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 15,
          fontWeight: 800,
          color: T.ink,
          letterSpacing: -0.01,
        }}
      >
        {format(value)}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: T.dim, fontWeight: 500 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 18-hole colour-coded strip — an inviting expandable panel that
 *  shows each hole's projected score at a glance. Emerald for
 *  under-par holes, tang for over-par, saturation scaled to
 *  magnitude. Closed by default; expanding reveals per-hole detail. */
function HoleStrip({
  holes,
  par,
}: {
  holes: NonNullable<ForecastResp["holes"]>;
  par: number;
}) {
  const [open, setOpen] = useState(false);
  // Amplitude for colour scaling — clip at 0.4 vs par (a routinely
  // hard hole) so a truly brutal one doesn't wash the rest out.
  const cap = 0.4;
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: T.soft,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: T.fontUi,
          color: T.ink,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: T.muted,
            }}
          >
            Per-hole projection
          </span>
          {!open && (
            <div
              style={{
                display: "flex",
                gap: 2,
                flex: 1,
                minWidth: 0,
              }}
            >
              {holes.map((h) => {
                const mag = Math.min(1, Math.abs(h.avgVsPar) / cap);
                const bg =
                  h.avgVsPar < 0
                    ? `oklch(${0.86 - 0.2 * mag} 0.13 155)`
                    : h.avgVsPar > 0
                      ? `oklch(${0.86 - 0.2 * mag} 0.15 40)`
                      : T.soft;
                return (
                  <div
                    key={h.hole}
                    title={`H${h.hole} · ${(h.avgVsPar >= 0 ? "+" : "") + h.avgVsPar.toFixed(3)} vs par`}
                    style={{
                      flex: 1,
                      minWidth: 6,
                      height: 22,
                      borderRadius: 3,
                      background: bg,
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: T.emerald,
            fontFamily: T.fontUi,
          }}
        >
          {open ? "Hide detail ▲" : "Expand ▼"}
        </span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 10,
            padding: 14,
            border: `1px solid ${T.line}`,
            borderRadius: 10,
            background: T.card,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 8,
            }}
          >
            {holes.map((h) => {
              const mag = Math.min(1, Math.abs(h.avgVsPar) / cap);
              const chipBg =
                h.avgVsPar < 0
                  ? `oklch(${0.94 - 0.06 * mag} 0.08 155)`
                  : h.avgVsPar > 0
                    ? `oklch(${0.95 - 0.06 * mag} 0.10 40)`
                    : T.soft;
              const chipInk =
                h.avgVsPar < 0
                  ? T.up
                  : h.avgVsPar > 0
                    ? T.down
                    : T.ink;
              return (
                <div
                  key={h.hole}
                  style={{
                    padding: "10px 8px",
                    background: chipBg,
                    border: `1px solid ${T.line}`,
                    borderRadius: 8,
                    textAlign: "center",
                    fontFamily: T.fontUi,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: 0.5,
                        color: T.muted,
                        fontWeight: 800,
                      }}
                    >
                      H{h.hole}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: T.dim,
                        fontFamily: T.fontMono,
                        fontWeight: 700,
                      }}
                    >
                      P{h.par}·{h.yards.toFixed(0)}y
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: 15,
                      fontWeight: 800,
                      color: chipInk,
                      letterSpacing: -0.01,
                    }}
                  >
                    {h.avgVsPar >= 0 ? "+" : ""}
                    {h.avgVsPar.toFixed(2)}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 9,
                      color: T.dim,
                      fontFamily: T.fontMono,
                      fontWeight: 600,
                    }}
                  >
                    W {h.headwind >= 0 ? "+" : ""}
                    {h.headwind.toFixed(0)}
                  </div>
                  {h.lowSample && (
                    <div
                      title={`Thin historical sample (${h.fitRowCount ?? "few"} rows) — projection carries extra uncertainty.`}
                      style={{
                        marginTop: 3,
                        fontSize: 8.5,
                        letterSpacing: 0.4,
                        color: T.tang,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        fontFamily: T.fontUi,
                      }}
                    >
                      ⚠ thin sample
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: `1px dashed ${T.line}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
              fontFamily: T.fontUi,
              fontSize: 11,
              color: T.muted,
            }}
          >
            <span>
              Round total{" "}
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontWeight: 800,
                  fontSize: 14,
                  color: T.ink,
                }}
              >
                {holes
                  .reduce((a, h) => a + h.avgVsPar, 0)
                  .toFixed(2)}{" "}
                vs par {par}
              </span>
            </span>
            <span style={{ display: "inline-flex", gap: 12 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: T.up,
                    borderRadius: 2,
                  }}
                />
                Under par
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: T.down,
                    borderRadius: 2,
                  }}
                />
                Over par
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Design tokens (mirrors design-handoff/social-v2.css) ──────────
// Kept as plain constants so the file stays self-contained — the
// tool is under /analysis and doesn't ship the pv-theme wrapper.
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
  heroInk: "oklch(0.16 0.04 155)",
  fontUi: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
};

// ── Style helpers ──────────────────────────────────────────────────
function panel(): React.CSSProperties {
  return {
    padding: 20,
    border: `1px solid ${T.line}`,
    borderRadius: 12,
    background: T.card,
    boxShadow: "0 1px 0 oklch(0 0 0 / 0.02)",
  };
}
function helpText(): React.CSSProperties {
  return {
    fontSize: 13,
    color: T.muted,
    marginBottom: 14,
    lineHeight: 1.55,
    fontFamily: T.fontUi,
  };
}
function ip(minWidth = 100): React.CSSProperties {
  return {
    padding: "9px 11px",
    fontSize: 14,
    color: T.ink,
    border: `1px solid ${T.line}`,
    borderRadius: 6,
    background: "white",
    minWidth,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
}
function btn(): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    border: `1px solid ${T.line}`,
    borderRadius: 6,
    background: "white",
    color: T.ink,
    cursor: "pointer",
  };
}
function btnPrimary(): React.CSSProperties {
  return {
    padding: "12px 22px",
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: 0.2,
    border: `1px solid ${T.emeraldD}`,
    borderRadius: 8,
    background: T.emerald,
    color: "white",
    cursor: "pointer",
    boxShadow: "0 2px 6px oklch(0.4 0.13 155 / 0.30)",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
  };
}
function th(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `1px solid ${T.line}`,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: T.muted,
    fontFamily: T.fontUi,
  };
}
function td(strong = false): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderBottom: `1px solid ${T.lineSoft}`,
    fontSize: 14,
    color: T.ink,
    fontFamily: strong ? T.fontUi : T.fontMono,
    fontWeight: strong ? 700 : 600,
  };
}

/** Three pulsing dots used as the loading state on the primary CTA. */
function RunningDots() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        gap: 4,
        alignItems: "center",
      }}
    >
      <style>{`
        @keyframes pv-fc-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .pv-fc-dot {
          width: 6px; height: 6px; border-radius: 50%; background: white;
          animation: pv-fc-bounce 1s ease-in-out infinite;
        }
        .pv-fc-dot:nth-child(2) { animation-delay: 0.15s; }
        .pv-fc-dot:nth-child(3) { animation-delay: 0.3s; }
      `}</style>
      <span className="pv-fc-dot" />
      <span className="pv-fc-dot" />
      <span className="pv-fc-dot" />
    </span>
  );
}

/** Warning modal that fires when the user tries to run the forecast
 *  with BOTH a non-typical Conditions preset (which applies a level
 *  shift) AND a non-zero manual pin adjustment. Both terms compress
 *  the "how hard is today" signal in overlapping ways — layering them
 *  double-counts. The modal lets the user cancel to un-stack the two
 *  or proceed anyway if they really do mean to add both. */
function DoubleCountModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0.2 0.04 155 / 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: "100%",
          background: T.card,
          border: `1px solid ${T.line}`,
          borderRadius: 12,
          padding: 22,
          boxShadow: "0 12px 40px oklch(0 0 0 / 0.3)",
          fontFamily: T.fontUi,
          color: T.ink,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: T.tang,
            fontWeight: 800,
            marginBottom: 6,
          }}
        >
          Heads up · possible double count
        </div>
        <h4
          style={{
            fontSize: 18,
            fontWeight: 800,
            margin: "0 0 10px",
          }}
        >
          You&apos;re combining a level shift with a manual pin
          adjustment
        </h4>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.55,
            margin: "0 0 16px",
            color: T.ink,
          }}
        >
          The <strong>Conditions</strong> preset already carries a
          per-hole level shift over from the reference round(s), which
          captures overall course softness including pin-position
          effects. Adding a <strong>manual pin adjustment</strong> on
          top stacks the two — the projection will be shifted more
          than either knob alone would suggest.
        </p>
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            margin: "0 0 18px",
            color: T.muted,
          }}
        >
          Usually you want <em>either</em>: (a) Conditions preset +
          automated pins, or (b) &quot;Typical setup&quot; conditions
          + manual pin adjustment.
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              background: "white",
              color: T.ink,
              cursor: "pointer",
            }}
          >
            Let me fix it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 800,
              border: `1px solid ${T.tang}`,
              borderRadius: 8,
              background: T.tang,
              color: "white",
              cursor: "pointer",
            }}
          >
            Run anyway
          </button>
        </div>
      </div>
    </div>
  );
}

/** Numbered stepped section header — the visual spine of the tool.
 *  Setup → Players → Results should read as a numbered progression. */
function SectionHeader({
  step,
  title,
  subtitle,
  accent = false,
}: {
  step: number;
  title: string;
  subtitle?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: accent ? T.emerald : T.soft,
          color: accent ? "white" : T.ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: T.fontMono,
          fontWeight: 800,
          fontSize: 14,
          flexShrink: 0,
          border: accent ? "none" : `1px solid ${T.line}`,
        }}
      >
        {step}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: T.fontUi,
            fontSize: accent ? 22 : 18,
            fontWeight: 800,
            color: T.ink,
            letterSpacing: -0.005,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <div
            style={{
              fontSize: 12,
              color: T.muted,
              fontFamily: T.fontUi,
              fontWeight: 600,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/** Animated count-up for the hero forecast number — nudges it from 0
 *  to its final value over ~600ms on first render, so the hero has a
 *  moment of "live model" motion when the result appears. Uses a rAF
 *  ease-out; skips if the user prefers reduced motion. */
function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const targetRef = useRef(target);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target);
      targetRef.current = target;
      return;
    }
    const from = targetRef.current === target ? 0 : targetRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else targetRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}
/** SG persistence weights — must match server-side constants in
 *  lib/scoring-model/forecast.ts. Used purely for display so users
 *  can see WHY a given round is worth more or less than face value. */
const SG_PERSIST_WEIGHTS = { ott: 0.65, app: 0.6, arg: 0.4, putt: 0.3 };
const SG_PERSIST_NEUTRAL =
  (SG_PERSIST_WEIGHTS.ott +
    SG_PERSIST_WEIGHTS.app +
    SG_PERSIST_WEIGHTS.arg +
    SG_PERSIST_WEIGHTS.putt) /
  4;

function effectivePersistenceFactor(sg: RoundSg): number | null {
  const ott = Math.abs(sg.sgOtt ?? 0);
  const app = Math.abs(sg.sgApp ?? 0);
  const arg = Math.abs(sg.sgArg ?? 0);
  const putt = Math.abs(sg.sgPutt ?? 0);
  const total = ott + app + arg + putt;
  if (total < 0.05) return null;
  const eff =
    (ott * SG_PERSIST_WEIGHTS.ott +
      app * SG_PERSIST_WEIGHTS.app +
      arg * SG_PERSIST_WEIGHTS.arg +
      putt * SG_PERSIST_WEIGHTS.putt) /
    total;
  return eff / SG_PERSIST_NEUTRAL;
}

function fmtSgVal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

/** Render the row that used to be "Rounds this week: -2,-2,-6" —
 *  now shows per-round SG breakdown from DataGolf live stats plus
 *  the persistence factor the model will apply to that round.
 *
 *  Each round renders as a premium data tile:
 *   - Large score chip (top-right, colour-coded by scoring)
 *   - Aligned OTT / APP / ARG / PUTT grid with tiny signed bars
 *     that show visually how much each category contributed
 *   - Persistence factor as a labelled footer
 */
function WeekRoundsRow({ row }: { row: PlayerRow }) {
  const rounds = parseCsvNumbers(row.weekRounds);
  const sgArr = row.weekRoundsSg;
  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: T.muted,
          fontWeight: 800,
          fontFamily: T.fontUi,
        }}
      >
        Rounds this week (auto-filled)
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {rounds.map((vsPar, i) => {
          const sg = sgArr[i] ?? null;
          const persist = sg ? effectivePersistenceFactor(sg) : null;
          const chipColor =
            vsPar < 0 ? T.up : vsPar > 0 ? T.down : T.ink;
          const chipBg =
            vsPar < 0
              ? "oklch(0.94 0.06 155)"
              : vsPar > 0
                ? "oklch(0.95 0.08 40)"
                : T.soft;
          return (
            <div
              key={i}
              style={{
                border: `1px solid ${T.line}`,
                borderRadius: 10,
                padding: 12,
                background: T.card,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: T.fontUi,
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: T.muted,
                  }}
                >
                  Round {i + 1}
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: chipBg,
                    color: chipColor,
                    fontFamily: T.fontMono,
                    fontWeight: 800,
                    fontSize: 15,
                    letterSpacing: -0.01,
                    border: `1px solid ${chipColor}`,
                    minWidth: 46,
                    textAlign: "center",
                  }}
                >
                  {vsPar >= 0 ? "+" : ""}
                  {vsPar}
                </span>
              </div>
              {sg ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 6,
                    }}
                  >
                    <SgCategoryRow label="OTT" value={sg.sgOtt} />
                    <SgCategoryRow label="APP" value={sg.sgApp} />
                    <SgCategoryRow label="ARG" value={sg.sgArg} />
                    <SgCategoryRow label="PUTT" value={sg.sgPutt} />
                  </div>
                  {persist != null && (
                    <div
                      style={{
                        marginTop: 2,
                        paddingTop: 8,
                        borderTop: `1px dashed ${T.line}`,
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        fontFamily: T.fontUi,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          letterSpacing: 0.6,
                          textTransform: "uppercase",
                          color: T.muted,
                          fontWeight: 800,
                        }}
                      >
                        Persistence
                      </span>
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 14,
                          fontWeight: 800,
                          color:
                            persist > 1.05
                              ? T.emerald
                              : persist < 0.95
                                ? T.down
                                : T.ink,
                        }}
                      >
                        {persist.toFixed(2)}×
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: T.dim,
                    fontStyle: "italic",
                    fontFamily: T.fontUi,
                  }}
                >
                  SG breakdown not posted yet
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One row in the SG grid — label + signed mono value + tiny bar.
 *  Bar length is proportional to |SG|, capped at +/-3 strokes so a
 *  hot round doesn't crush the smaller categories. */
function SgCategoryRow({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const v = value ?? null;
  const cap = 3;
  const mag = v == null ? 0 : Math.min(1, Math.abs(v) / cap);
  const barColor = v == null ? T.line : v >= 0 ? T.up : T.down;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
        fontFamily: T.fontUi,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: 0.6,
            fontWeight: 800,
            color: T.muted,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 13,
            fontWeight: 700,
            color: v == null ? T.dim : v >= 0 ? T.up : T.down,
            letterSpacing: -0.01,
          }}
        >
          {fmtSgVal(v)}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 4,
          background: T.soft,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: v != null && v < 0 ? `${50 - mag * 50}%` : "50%",
            width: `${mag * 50}%`,
            top: 0,
            bottom: 0,
            background: barColor,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: T.line,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Slider — horizontal range control for the advanced-panel numeric
 * parameters. Renders:
 *   - current value (mono, bold) with a "reset" affordance when the
 *     user has moved off Pardle's recommendation
 *   - the range input itself (native, restyled globally via <style>)
 *   - an emerald tick on the track at the recommended value
 *   - a caption underneath: "Pardle recommends X"
 *
 * Value is a STRING (mirrors the parent state) so callers can still
 * represent an "auto" state as `""`; when empty we position the
 * thumb at the recommendation but tag the display with "auto".
 */
function Slider({
  min,
  max,
  step,
  value,
  onChange,
  recommended,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: string;
  onChange: (next: string) => void;
  recommended: number;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toFixed(2));
  const isAuto = value.trim() === "";
  const parsed = isAuto ? recommended : Number(value);
  const displayed = Number.isFinite(parsed) ? parsed : recommended;
  const clamped = Math.min(max, Math.max(min, displayed));
  const pct = ((clamped - min) / (max - min)) * 100;
  const recPct = ((recommended - min) / (max - min)) * 100;
  const isRec = Math.abs(clamped - recommended) < step / 2;
  const emerald = "oklch(0.42 0.15 155)";
  const track = "oklch(0.88 0.008 95)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <style>{`
        .pv-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 22px;
          background: transparent;
          margin: 0;
          padding: 0;
          cursor: pointer;
        }
        .pv-slider:focus { outline: none; }
        .pv-slider::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 3px;
          background: transparent;
        }
        .pv-slider::-moz-range-track {
          height: 6px;
          border-radius: 3px;
          background: transparent;
        }
        .pv-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${emerald};
          border: 2px solid white;
          box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
          margin-top: -6px;
          cursor: grab;
        }
        .pv-slider::-webkit-slider-thumb:active { cursor: grabbing; }
        .pv-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${emerald};
          border: 2px solid white;
          box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
          cursor: grab;
        }
      `}</style>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 15,
            fontWeight: 700,
            color: "oklch(0.24 0.04 155)",
          }}
        >
          {fmt(clamped)}
          {isAuto && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "oklch(0.5 0.02 150)",
                marginLeft: 6,
                letterSpacing: 0.3,
                fontFamily: "inherit",
              }}
            >
              · AUTO
            </span>
          )}
        </span>
        {!isRec && !isAuto && (
          <button
            type="button"
            onClick={() => onChange("")}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              color: emerald,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            reset
          </button>
        )}
      </div>
      <div style={{ position: "relative", height: 22 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: 6,
            borderRadius: 3,
            background: track,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: 6,
            borderRadius: 3,
            background: emerald,
            width: `${pct}%`,
            pointerEvents: "none",
          }}
        />
        <div
          title={`Pardle recommends ${fmt(recommended)}`}
          style={{
            position: "absolute",
            left: `${recPct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 2,
            height: 14,
            background: "oklch(0.24 0.04 155)",
            borderRadius: 1,
            pointerEvents: "none",
          }}
        />
        <input
          className="pv-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: "relative", zIndex: 2 }}
        />
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: "oklch(0.5 0.02 150)",
          letterSpacing: 0.2,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        <span>{fmt(min)}</span>
        <span
          style={{
            fontFamily: "inherit",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 700,
            color: "oklch(0.4 0.03 155)",
          }}
        >
          Pardle recommends {fmt(recommended)}
        </span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
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
  const [hover, setHover] = useState(false);
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
          fontSize: 12,
          fontWeight: 600,
          color: "oklch(0.5 0.02 150)",
          letterSpacing: 0.3,
          textTransform: "uppercase",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {label}
        {help && (
          <span
            role="tooltip"
            aria-label={help}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocus={() => setHover(true)}
            onBlur={() => setHover(false)}
            tabIndex={0}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: "1px solid oklch(0.7 0.03 155)",
              color: "oklch(0.5 0.03 155)",
              background: "white",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "serif",
              cursor: "help",
              lineHeight: 1,
            }}
          >
            i
            {hover && (
              <span
                role="tooltip"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  zIndex: 40,
                  background: "oklch(0.22 0.03 155)",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  textTransform: "none",
                  letterSpacing: 0,
                  lineHeight: 1.45,
                  width: 280,
                  boxShadow: "0 6px 20px oklch(0 0 0 / 0.25)",
                  pointerEvents: "none",
                }}
              >
                {help}
              </span>
            )}
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
        padding: 14,
        border: "1px solid oklch(0.9 0.008 95)",
        borderRadius: 6,
        background: "white",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "oklch(0.5 0.02 150)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{ fontSize: 12, color: "oklch(0.5 0.02 150)", marginTop: 5 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
