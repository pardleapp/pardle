"use client";

/**
 * Client component for the Course History tool.
 *
 * Two panels:
 *   1. Course picker — searchable dropdown of PGA Tour recurring
 *      events. Populated from /api/course-history/events.
 *   2. Rankings table — per-player stats at the selected course.
 *      Sortable columns. Default sort: outperformance descending.
 *
 * Visual language matches the redesigned score-forecast tool
 * (v2 tokens, stepped section headers, mono for numbers).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Design tokens (match ForecastTool) ─────────────────────────────
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

// ── Types mirroring the API ────────────────────────────────────────
interface CuratedCourse {
  courseName: string;
  totalRounds: number;
  yearsPresent: number;
  hostingEvents: string[];
  mostRecentYear: number;
}
interface PlayerCourseStats {
  dgId: number;
  name: string;
  roundsPlayed: number;
  yearsPlayed: number;
  courseName: string;
  atCourseSgOtt: number;
  atCourseSgApp: number;
  atCourseCombined: number;
  baselineSgOtt: number;
  baselineSgApp: number;
  baselineCombined: number;
  outperformanceSgOtt: number;
  outperformanceSgApp: number;
  outperformanceCombined: number;
}
interface CourseHistoryResp {
  ok: boolean;
  error?: string;
  eventName?: string;
  courseName?: string;
  yearsCovered?: number[];
  players?: PlayerCourseStats[];
  hostingEvents?: string[];
}

interface ArchetypeDim {
  dim: string;
  label: string;
  unit: string;
  correlation: number;
  n: number;
  poolMean: number;
  poolStd: number;
  topTailMean: number;
  bottomTailMean: number;
  standardizedTailGap: number;
  tourMean: number;
  tourStd: number;
  interpretation: string;
  isPriority: boolean;
}
interface ArchetypeSamplePlayer {
  name: string;
  playerId: string;
  roundsAtCourse: number;
  outperformanceSgOtt: number;
  stats: Record<string, number | undefined>;
}
interface ArchetypeResp {
  ok: boolean;
  error?: string;
  courseName?: string;
  eligiblePlayers?: number;
  matchedPlayers?: number;
  unmatchedNames?: string[];
  distinguishing?: ArchetypeDim[];
  outperformerTail?: ArchetypeSamplePlayer[];
  underperformerTail?: ArchetypeSamplePlayer[];
}

interface ForecastFit {
  n: number;
  r2Train: number;
  r2Cv: number;
  reliable: boolean;
  betas: {
    intercept: number;
    ballSpeed: number;
    apexHeight: number;
    curve: number;
  };
}
interface ForecastPlayer {
  name: string;
  playerId: string;
  isTrainingSample: boolean;
  roundsAtCourse: number;
  predictedResidualPerRd: number;
  actualResidualPerRd: number | null;
}
interface ForecastResp {
  ok: boolean;
  error?: string;
  courseName?: string;
  fit?: ForecastFit;
  players?: ForecastPlayer[];
}

type SortKey =
  | "outperformanceCombined"
  | "outperformanceSgOtt"
  | "outperformanceSgApp"
  | "atCourseCombined"
  | "atCourseSgOtt"
  | "atCourseSgApp"
  | "baselineCombined"
  | "roundsPlayed"
  | "name"
  | "predictedOtt"
  | "eventEdge"
  | "modelGap";

interface ActiveField {
  tournamentName: string | null;
  dgIds: Set<number>;
}

interface FieldResp {
  ok?: boolean;
  tournamentName?: string | null;
  players?: { dgId?: string | number | null }[];
}

interface SpecialistRow {
  dgId: number;
  name: string;
  course: string;
  rounds: number;
  years: number;
  atCombined: number;
  baselineCombined: number;
  outperformance: number;
  outperformanceOtt: number;
  outperformanceApp: number;
}

interface SpecialistsResp {
  ok: boolean;
  error?: string;
  minRounds?: number;
  totalPairs?: number;
  rows?: SpecialistRow[];
}

type ToolView = "by-course" | "specialists";

// ── Main component ─────────────────────────────────────────────────
export default function CourseHistoryTool() {
  const [courses, setCourses] = useState<CuratedCourse[] | null>(null);
  const [courseQuery, setCourseQuery] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [warming, setWarming] = useState(false);

  const [data, setData] = useState<CourseHistoryResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [archetype, setArchetype] = useState<ArchetypeResp | null>(null);
  const [archetypeLoading, setArchetypeLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastResp | null>(null);
  const [minRounds, setMinRounds] = useState(4);
  const [sortKey, setSortKey] = useState<SortKey>("outperformanceCombined");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [activeFieldChecked, setActiveFieldChecked] = useState(false);
  const [onlyThisWeek, setOnlyThisWeek] = useState(false);

  // Tab state — "By course" is the original per-venue drill-down;
  // "Specialists" is a global table of best/worst (player, course)
  // pairs at a rounds-played threshold.
  const [view, setView] = useState<ToolView>("by-course");
  const [specMinRounds, setSpecMinRounds] = useState(8);
  const [specialists, setSpecialists] = useState<SpecialistsResp | null>(null);
  const [specialistsLoading, setSpecialistsLoading] = useState(false);

  // Load course list. First cold hit can take up to a minute while
  // the server warms the DataGolf/Redis caches, so we show a
  // "Loading courses…" state until we hear back. Default-course
  // selection lives in a separate effect below so it can wait for
  // the active-field fetch too.
  useEffect(() => {
    (async () => {
      setWarming(true);
      try {
        const res = await fetch("/api/course-history/courses");
        const j = (await res.json()) as {
          ok?: boolean;
          courses?: CuratedCourse[];
        };
        if (j.ok && j.courses) setCourses(j.courses);
      } catch {
        /* silent — user can try again */
      } finally {
        setWarming(false);
      }
    })();
  }, []);

  // Auto-select this week's venue once we know it. Runs after either
  // the courses list or the active field lands; only fires when the
  // user hasn't picked a course yet. Match strategy: find the course
  // whose hostingEvents contains the active tournament name — so
  // "FedEx St. Jude Championship" → "TPC Southwind" this week,
  // whichever event is up next week, and so on. Falls back to the
  // most-rounds course if the active field hasn't loaded yet.
  useEffect(() => {
    if (selectedCourse || !courses || courses.length === 0) return;
    let preferred: CuratedCourse | null = null;
    const eventName = activeField?.tournamentName?.trim().toLowerCase() ?? null;
    if (eventName) {
      preferred =
        courses.find((c) =>
          c.hostingEvents.some((e) => e.trim().toLowerCase() === eventName),
        ) ?? null;
    }
    // Only fall back to most-rounds AFTER we've heard back from the
    // active-field endpoint. Otherwise the courses-first race would
    // pin the wrong venue for a beat, then never update once the
    // field lands (selectedCourse is already set).
    if (!preferred && activeFieldChecked) {
      preferred = [...courses].sort((a, b) => b.totalRounds - a.totalRounds)[0];
    }
    if (preferred) {
      setSelectedCourse(preferred.courseName);
      setCourseQuery(preferred.courseName);
    }
  }, [courses, activeField, activeFieldChecked, selectedCourse]);

  // Load the current tour week's field so we can offer a
  // "only this week's players" filter. Silent failure — the toggle
  // just stays disabled if there's no active tournament.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/scoring-model/field", {
          cache: "no-store",
        });
        const j = (await res.json()) as FieldResp;
        if (!j?.ok || !Array.isArray(j.players)) return;
        const ids = new Set<number>();
        for (const p of j.players) {
          const n = typeof p.dgId === "string" ? Number(p.dgId) : p.dgId;
          if (typeof n === "number" && Number.isFinite(n)) ids.add(n);
        }
        setActiveField({
          tournamentName: j.tournamentName ?? null,
          dgIds: ids,
        });
      } catch {
        /* toggle stays hidden */
      } finally {
        setActiveFieldChecked(true);
      }
    })();
  }, []);

  // Load course history when the selected course changes.
  useEffect(() => {
    if (!selectedCourse) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      setArchetype(null);
      try {
        const res = await fetch(
          `/api/course-history?course=${encodeURIComponent(selectedCourse)}`,
        );
        const j = (await res.json()) as CourseHistoryResp;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) {
          setData({
            ok: false,
            error: e instanceof Error ? e.message : "fetch failed",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCourse]);

  // Load ballstriking archetype + forecast once the main history is in.
  // The two fetches run in parallel — archetype for the descriptive
  // signal, forecast for the per-player predicted residual.
  useEffect(() => {
    if (!selectedCourse || !data?.ok) return;
    let cancelled = false;
    (async () => {
      setArchetypeLoading(true);
      setArchetype(null);
      setForecast(null);
      try {
        const [aRes, fRes] = await Promise.all([
          fetch(
            `/api/course-history/archetype?course=${encodeURIComponent(selectedCourse)}`,
          ),
          fetch(
            `/api/course-history/forecast?course=${encodeURIComponent(selectedCourse)}`,
          ),
        ]);
        const [a, f] = await Promise.all([
          aRes.json() as Promise<ArchetypeResp>,
          fRes.json() as Promise<ForecastResp>,
        ]);
        if (!cancelled) {
          setArchetype(a);
          setForecast(f);
        }
      } catch (e) {
        if (!cancelled) {
          setArchetype({
            ok: false,
            error: e instanceof Error ? e.message : "fetch failed",
          });
        }
      } finally {
        if (!cancelled) setArchetypeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCourse, data?.ok]);

  // Load global specialists when the Specialists tab activates or the
  // min-rounds control changes. Cheap in the warm cache path (~1s of
  // Redis GETs), so re-fetching on every threshold change is fine.
  useEffect(() => {
    if (view !== "specialists") return;
    let cancelled = false;
    (async () => {
      setSpecialistsLoading(true);
      try {
        const res = await fetch(
          `/api/course-history/specialists?min=${specMinRounds}`,
        );
        const j = (await res.json()) as SpecialistsResp;
        if (!cancelled) setSpecialists(j);
      } catch (e) {
        if (!cancelled) {
          setSpecialists({
            ok: false,
            error: e instanceof Error ? e.message : "fetch failed",
          });
        }
      } finally {
        if (!cancelled) setSpecialistsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, specMinRounds]);

  const filteredCourses = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    if (!courses) return [];
    // Hide venues with fewer than 12 rounds ever — too small a sample
    // to say anything meaningful about course fit.
    const legible = courses.filter((c) => c.totalRounds >= 12);
    if (!q) return legible.slice(0, 60);
    return legible
      .filter(
        (c) =>
          c.courseName.toLowerCase().includes(q) ||
          c.hostingEvents.some((e) => e.toLowerCase().includes(q)),
      )
      .slice(0, 60);
  }, [courses, courseQuery]);

  const rows = useMemo(() => {
    if (!data?.players) return [];
    let filtered = data.players.filter(
      (p) => p.roundsPlayed >= minRounds,
    );
    // "Only this week's field" filter — surface the intersection of
    // this venue's historical population with the current tour week's
    // starting field. Silently no-op if we couldn't load the field.
    if (onlyThisWeek && activeField && activeField.dgIds.size > 0) {
      filtered = filtered.filter((p) => activeField.dgIds.has(p.dgId));
    }
    // Parent sorter only handles the base course-history columns;
    // predicted/gap are re-sorted inside RankingTable using the
    // forecast lookup (which only exists there).
    const parentHandledKeys: SortKey[] = [
      "outperformanceCombined",
      "outperformanceSgOtt",
      "outperformanceSgApp",
      "atCourseCombined",
      "atCourseSgOtt",
      "atCourseSgApp",
      "baselineCombined",
      "roundsPlayed",
      "name",
    ];
    if (!parentHandledKeys.includes(sortKey)) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortKey === "name") return dir * a.name.localeCompare(b.name);
      const av = a[sortKey as keyof PlayerCourseStats] as number;
      const bv = b[sortKey as keyof PlayerCourseStats] as number;
      return dir * (av - bv);
    });
    return sorted;
  }, [data, minRounds, sortKey, sortDir, onlyThisWeek, activeField]);

  const clickSort = useCallback(
    (k: SortKey) => {
      if (k === sortKey) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortKey(k);
        setSortDir(k === "name" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <TabSwitcher view={view} onChange={setView} />
      {view === "specialists" && (
        <SpecialistsPanel
          data={specialists}
          loading={specialistsLoading}
          minRounds={specMinRounds}
          onMinRoundsChange={setSpecMinRounds}
        />
      )}
      {view === "by-course" && (
        <>
      {/* Setup panel */}
      <div style={panel()}>
        <SectionHeader
          step={1}
          title="Course"
          subtitle="Pick any PGA Tour venue since 2019"
        />
        <div style={{ display: "grid", gap: 16 }}>
          <Field
            label="Course"
            help={
              warming
                ? "First load can take up to a minute — we're warming DataGolf's per-year baselines. Subsequent picks are instant."
                : "Type a course name (or a hosting event's name — e.g. type 'Genesis' to find Riviera)."
            }
          >
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder={
                  warming
                    ? "Warming baselines (~60s)…"
                    : courses
                      ? "Type a course or hosting event…"
                      : "Loading courses…"
                }
                value={courseQuery}
                onChange={(e) => {
                  setCourseQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                onBlur={() =>
                  setTimeout(() => setDropdownOpen(false), 200)
                }
                style={ip()}
                disabled={courses == null}
              />
              {dropdownOpen && filteredCourses.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    maxHeight: 380,
                    overflowY: "auto",
                    background: "white",
                    border: `1px solid ${T.line}`,
                    borderRadius: 8,
                    boxShadow: "0 8px 24px oklch(0 0 0 / 0.10)",
                    zIndex: 20,
                    fontFamily: T.fontUi,
                  }}
                >
                  {filteredCourses.map((c) => (
                    <button
                      key={c.courseName}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedCourse(c.courseName);
                        setCourseQuery(c.courseName);
                        setDropdownOpen(false);
                      }}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "start",
                        gap: 8,
                        padding: "10px 12px",
                        border: "none",
                        background:
                          c.courseName === selectedCourse
                            ? T.emeraldTint
                            : "white",
                        color: T.ink,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: T.fontUi,
                        fontSize: 14,
                        fontWeight: 600,
                        borderBottom: `1px solid ${T.lineSoft}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: T.ink, fontWeight: 700 }}>
                          {c.courseName}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: T.muted,
                            fontWeight: 600,
                            marginTop: 2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {c.hostingEvents.slice(0, 2).join(" · ")}
                          {c.hostingEvents.length > 2
                            ? ` +${c.hostingEvents.length - 2}`
                            : ""}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 12,
                          color: T.muted,
                          fontWeight: 700,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.totalRounds} rds
                        <br />
                        <span style={{ fontSize: 10, color: T.dim }}>
                          {c.yearsPresent} yr
                          {c.yearsPresent === 1 ? "" : "s"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <Field
            label="Min rounds played at course"
            help="Players with fewer than this many rounds at the venue are filtered out — the smaller the sample the noisier the aggregate."
          >
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={minRounds}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1 && v <= 30) {
                  setMinRounds(v);
                }
              }}
              style={{ ...ip(), maxWidth: 120 }}
            />
          </Field>
          {activeField && activeField.dgIds.size > 0 && (
            <ThisWeekToggle
              on={onlyThisWeek}
              onChange={setOnlyThisWeek}
              tournamentName={activeField.tournamentName}
              fieldCount={activeField.dgIds.size}
              matchedCount={rows.length}
              totalPlayers={
                data?.players?.filter((p) => p.roundsPlayed >= minRounds).length ?? 0
              }
            />
          )}
        </div>
      </div>

      {/* Results panel */}
      <div
        style={{
          ...panel(),
          border: `1.5px solid ${T.emerald}`,
          boxShadow: "0 4px 24px oklch(0.4 0.13 155 / 0.10)",
        }}
      >
        <SectionHeader
          step={2}
          title={
            data?.courseName ?? selectedCourse ?? "Course rankings"
          }
          subtitle={
            data?.yearsCovered && data.yearsCovered.length > 0
              ? `${data.yearsCovered[0]}–${data.yearsCovered[data.yearsCovered.length - 1]} · ${data.players?.length ?? 0} players · vs per-year leave-one-out baseline`
              : "Ranked by outperformance (at-course SG − per-year baseline)"
          }
          accent
        />
        {data?.hostingEvents && data.hostingEvents.length > 0 && (
          <div
            style={{
              marginTop: -6,
              marginBottom: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {data.hostingEvents.map((e) => (
              <span
                key={e}
                style={{
                  fontSize: 11,
                  fontFamily: T.fontUi,
                  fontWeight: 700,
                  color: T.emeraldD,
                  background: T.emeraldTint,
                  padding: "3px 8px",
                  borderRadius: 999,
                  letterSpacing: 0.2,
                }}
              >
                {e}
              </span>
            ))}
          </div>
        )}

        {loading && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: T.muted,
              fontFamily: T.fontUi,
            }}
          >
            Loading historical rounds…
          </div>
        )}
        {!loading && data && !data.ok && (
          <div
            style={{
              padding: 20,
              background: "oklch(0.97 0.05 40)",
              border: `1px solid oklch(0.85 0.10 40)`,
              borderRadius: 8,
              color: "oklch(0.35 0.15 28)",
              fontFamily: T.fontUi,
            }}
          >
            {data.error ??
              "Couldn't load course history for this event."}
          </div>
        )}
        {!loading && data?.ok && rows.length > 0 && (
          <>
            <ArchetypePanel
              loading={archetypeLoading}
              archetype={archetype}
              forecast={forecast}
            />
            <RankingTable
              rows={rows}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={clickSort}
              forecast={forecast}
            />
          </>
        )}
        {!loading && data?.ok && rows.length === 0 && (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: T.muted,
              fontFamily: T.fontUi,
            }}
          >
            {onlyThisWeek
              ? `No players in ${activeField?.tournamentName ?? "this week's field"} have ${minRounds}+ rounds at this course. Try lowering the min-rounds filter or turning off "Only this week's field".`
              : "No players meet the minimum-rounds filter. Try lowering it above."}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

// ── Tab switcher ───────────────────────────────────────────────────
function TabSwitcher({
  view,
  onChange,
}: {
  view: ToolView;
  onChange: (v: ToolView) => void;
}) {
  const tabs: { key: ToolView; label: string; sub: string }[] = [
    {
      key: "by-course",
      label: "By course",
      sub: "Pick a venue, see who fits",
    },
    {
      key: "specialists",
      label: "Specialists",
      sub: "Best & worst across every course",
    },
  ];
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: T.soft,
        border: `1px solid ${T.line}`,
        borderRadius: 12,
      }}
    >
      {tabs.map((t) => {
        const on = view === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              padding: "10px 14px",
              border: "none",
              borderRadius: 8,
              background: on ? "white" : "transparent",
              color: on ? T.emeraldD : T.muted,
              boxShadow: on ? "0 1px 2px oklch(0 0 0 / 0.06)" : "none",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: T.fontUi,
              transition: "background 120ms ease",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: -0.005,
              }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: on ? T.muted : T.dim,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              {t.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Specialists panel ──────────────────────────────────────────────
function SpecialistsPanel({
  data,
  loading,
  minRounds,
  onMinRoundsChange,
}: {
  data: SpecialistsResp | null;
  loading: boolean;
  minRounds: number;
  onMinRoundsChange: (v: number) => void;
}) {
  const rows = data?.rows ?? [];
  const total = data?.totalPairs ?? 0;

  const top = useMemo(() => rows.slice(0, 25), [rows]);
  const bottom = useMemo(() => rows.slice(-25).reverse(), [rows]);

  return (
    <div
      style={{
        ...panel(),
        border: `1.5px solid ${T.emerald}`,
        boxShadow: "0 4px 24px oklch(0.4 0.13 155 / 0.10)",
      }}
    >
      <SectionHeader
        step={1}
        title="Course specialists"
        subtitle={
          total
            ? `${total.toLocaleString()} (player, course) pairs meeting the minimum-rounds threshold`
            : "Best and worst course-fit signals across every venue in the archive"
        }
        accent
      />

      <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
        <Field
          label="Minimum rounds at course"
          help="A specialist signal is only reliable with enough sample. 8 rounds is roughly 2 tournaments' worth of data at the same venue."
        >
          <input
            type="number"
            min={1}
            max={40}
            step={1}
            value={minRounds}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1 && v <= 40) {
                onMinRoundsChange(v);
              }
            }}
            style={{ ...ip(), maxWidth: 120 }}
          />
        </Field>
      </div>

      <div
        style={{
          marginBottom: 14,
          padding: "10px 12px",
          background: T.soft,
          border: `1px solid ${T.line}`,
          borderRadius: 8,
          fontSize: 12,
          color: T.muted,
          fontFamily: T.fontUi,
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: T.ink }}>Caveats.</strong> Rows for
        opposite-field / co-sanctioned events (Renaissance Club Scottish
        Open, Keene Trace Barbasol, some Latin/Vidanta stops) can show
        inflated numbers when a player&apos;s baseline is unusually low
        because most of their PGA-side rounds are majors and playoffs.
        Look at the <em>baseline sum</em> column — anything below −1.0
        or above +1.5 for a mid-tier player is a data artifact, not
        signal.
      </div>

      {loading && (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: T.muted,
            fontFamily: T.fontUi,
          }}
        >
          Loading specialists…
        </div>
      )}
      {!loading && data && !data.ok && (
        <div
          style={{
            padding: 20,
            background: "oklch(0.97 0.05 40)",
            border: `1px solid oklch(0.85 0.10 40)`,
            borderRadius: 8,
            color: "oklch(0.35 0.15 28)",
            fontFamily: T.fontUi,
          }}
        >
          {data.error ?? "Couldn't load specialists."}
        </div>
      )}
      {!loading && data?.ok && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
            gap: 16,
          }}
        >
          <SpecialistList
            title="Best overperformers"
            subtitle="Where players consistently beat their form"
            color={T.emerald}
            rows={top}
          />
          <SpecialistList
            title="Worst drags"
            subtitle="Where players consistently fall short"
            color={T.tang}
            rows={bottom}
          />
        </div>
      )}
    </div>
  );
}

function SpecialistList({
  title,
  subtitle,
  color,
  rows,
}: {
  title: string;
  subtitle: string;
  color: string;
  rows: SpecialistRow[];
}) {
  return (
    <div
      style={{
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        background: "white",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: `1px solid ${T.lineSoft}`,
          background: T.soft,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color,
            fontWeight: 800,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: T.muted,
            fontFamily: T.fontUi,
            fontWeight: 600,
            marginTop: 2,
          }}
        >
          {subtitle}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: T.fontUi,
            minWidth: 340,
          }}
        >
          <thead>
            <tr style={{ background: T.card }}>
              <SpecTh label="Player" align="left" />
              <SpecTh label="Course" align="left" />
              <SpecTh label="Rds" />
              <SpecTh label="Base" />
              <SpecTh label="vs" accent color={color} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.dgId}-${r.course}`}
                style={{
                  background: i % 2 === 0 ? "white" : T.soft,
                }}
              >
                <td style={td()}>
                  <span style={{ fontWeight: 800, color: T.ink }}>
                    {r.name}
                  </span>
                </td>
                <td
                  style={{
                    ...td(),
                    textAlign: "left",
                    fontFamily: T.fontUi,
                    fontWeight: 600,
                    color: T.muted,
                    whiteSpace: "normal",
                    fontSize: 12,
                  }}
                >
                  {r.course}
                </td>
                <td style={td(true)}>{r.rounds}</td>
                <td
                  style={{
                    ...td(),
                    color: T.muted,
                  }}
                >
                  {(r.baselineCombined >= 0 ? "+" : "") +
                    r.baselineCombined.toFixed(2)}
                </td>
                <td
                  style={{
                    ...td(),
                    color,
                    fontWeight: 800,
                    background: `${color}0F`,
                  }}
                >
                  {(r.outperformance >= 0 ? "+" : "") +
                    r.outperformance.toFixed(2)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: T.muted,
                    fontFamily: T.fontUi,
                    fontSize: 13,
                  }}
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpecTh({
  label,
  align = "right",
  accent = false,
  color,
}: {
  label: string;
  align?: "left" | "right";
  accent?: boolean;
  color?: string;
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 10px",
        borderBottom: `1px solid ${T.line}`,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: accent && color ? color : T.muted,
        fontFamily: T.fontUi,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </th>
  );
}

// ── Archetype panel ────────────────────────────────────────────────
/** Small helper: format a number to a sensible precision for its
 *  dimension unit. */
function fmtVal(v: number, unit: string): string {
  if (unit === "mph" || unit === "yd" || unit === "ft" || unit === "°") {
    return v.toFixed(1);
  }
  if (unit === "rpm") return Math.round(v).toString();
  return v.toFixed(2);
}

function ArchetypePanel({
  loading,
  archetype,
  forecast,
}: {
  loading: boolean;
  archetype: ArchetypeResp | null;
  forecast: ForecastResp | null;
}) {
  if (loading) {
    return (
      <div
        style={{
          marginBottom: 20,
          padding: 20,
          background: T.soft,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          color: T.muted,
          fontFamily: T.fontUi,
          textAlign: "center",
        }}
      >
        Computing ballstriking archetype…
      </div>
    );
  }
  if (!archetype) return null;
  if (!archetype.ok) return null;

  // Model is ball-speed only, so the archetype panel only shows the
  // ball-speed correlation card. Other dimensions are still
  // computed server-side but hidden here to avoid implying they
  // feed the forecast.
  const dist = (archetype.distinguishing ?? []).filter(
    (d) => d.dim === "ballSpeed",
  );
  const outTail = archetype.outperformerTail ?? [];
  const underTail = archetype.underperformerTail ?? [];

  return (
    <div
      style={{
        marginBottom: 20,
        padding: "18px 20px",
        border: `1px solid ${T.line}`,
        borderRadius: 12,
        background: `linear-gradient(135deg, ${T.emeraldTint} 0%, ${T.card} 100%)`,
        fontFamily: T.fontUi,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: T.emeraldD,
          fontWeight: 800,
          marginBottom: 4,
        }}
      >
        Ballstriking archetype
      </div>
      <h4
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 800,
          color: T.ink,
          marginBottom: 8,
        }}
      >
        How ball speed relates to outperformance here
      </h4>
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 13,
          color: T.muted,
          lineHeight: 1.5,
          maxWidth: 780,
        }}
      >
        Correlation across{" "}
        <strong>{archetype.matchedPlayers}</strong> players
        (matched from{" "}
        <strong>{archetype.eligiblePlayers}</strong> eligible with 8+
        rounds here) between ball speed and per-round OTT
        outperformance. Positive r means bombers over-perform their
        baseline at this venue; negative r means shorter hitters do.
        {" "}
        <span style={{ color: T.dim }}>|r| &lt; 0.15 weak</span> ·{" "}
        <span style={{ color: T.ink, fontWeight: 700 }}>
          0.15–0.3 moderate
        </span>{" "}
        ·{" "}
        <span style={{ color: T.emerald, fontWeight: 800 }}>
          ≥ 0.3 strong
        </span>
        . Apex and shot-curve panels are gone because the WLS forecast
        found neither adds out-of-sample predictive value once ball
        speed is in the model.
      </p>

      {forecast?.ok && forecast.fit && (
        <ForecastFitReadout fit={forecast.fit} />
      )}

      {dist.length === 0 ? (
        <div
          style={{
            padding: 14,
            background: "white",
            border: `1px solid ${T.line}`,
            borderRadius: 8,
            color: T.muted,
            fontSize: 13,
          }}
        >
          Not enough matched players yet to compute a stable
          archetype at this course.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {dist.slice(0, 6).map((d) => (
            <DimensionCard key={d.dim} d={d} />
          ))}
        </div>
      )}

      {(outTail.length > 0 || underTail.length > 0) && (
        <details style={{ marginTop: 6 }}>
          <summary
            style={{
              cursor: "pointer",
              color: T.emerald,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              userSelect: "none",
            }}
          >
            Who&apos;s at each extreme?
          </summary>
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
              gap: 10,
            }}
          >
            <ExtremeList
              label="Top OTT outperformers"
              color={T.emerald}
              players={outTail}
            />
            <ExtremeList
              label="Bottom OTT underperformers"
              color={T.tang}
              players={underTail}
            />
          </div>
          {archetype.unmatchedNames &&
            archetype.unmatchedNames.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: T.dim,
                }}
              >
                Skipped ({archetype.unmatchedNames.length}, no tee-shot
                profile): {archetype.unmatchedNames.slice(0, 10).join(", ")}
                {archetype.unmatchedNames.length > 10 ? "…" : ""}
              </div>
            )}
        </details>
      )}
    </div>
  );
}

/** Summary of the WLS course-fit model: how many training rows it
 *  saw, cross-validated R² (the honest metric), and whether the
 *  reliability floor cleared. Sits above the ranking table so the
 *  reader knows whether to trust the Pred OTT column. */
function ForecastFitReadout({ fit }: { fit: ForecastFit }) {
  const cvColor = fit.reliable ? T.emerald : T.tang;
  return (
    <div
      style={{
        margin: "0 0 14px",
        padding: "12px 14px",
        background: "white",
        border: `1px solid ${fit.reliable ? T.line : T.tang}`,
        borderLeft: `3px solid ${cvColor}`,
        borderRadius: 8,
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
        gap: 12,
        alignItems: "center",
        fontFamily: T.fontUi,
        maxWidth: 780,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          Course-fit forecast
        </div>
        <div
          style={{
            fontSize: 13,
            color: T.ink,
            fontWeight: 700,
            marginTop: 2,
          }}
        >
          Ball speed → predicted SG:OTT (per round)
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          Training rows
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontWeight: 800,
            fontSize: 15,
            color: T.ink,
          }}
        >
          {fit.n}
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          Train R²
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontWeight: 800,
            fontSize: 15,
            color: T.dim,
          }}
        >
          {fit.r2Train.toFixed(2)}
        </div>
      </div>
      <div>
        <div
          style={{
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: T.muted,
            fontWeight: 800,
          }}
        >
          CV R²
        </div>
        <div
          style={{
            fontFamily: T.fontMono,
            fontWeight: 800,
            fontSize: 15,
            color: cvColor,
          }}
        >
          {fit.r2Cv.toFixed(2)}
        </div>
        <div
          style={{
            fontSize: 10,
            color: cvColor,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          {fit.reliable ? "trusted" : "too flimsy"}
        </div>
      </div>
    </div>
  );
}

function ExtremeList({
  label,
  color,
  players,
}: {
  label: string;
  color: string;
  players: ArchetypeSamplePlayer[];
}) {
  return (
    <div
      style={{
        padding: 12,
        background: "white",
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color,
          fontWeight: 800,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {players.map((p) => (
          <div
            key={p.playerId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              fontSize: 12.5,
            }}
          >
            <span
              style={{
                fontFamily: T.fontUi,
                color: T.ink,
                fontWeight: 700,
              }}
            >
              {p.name}
            </span>
            <span
              style={{
                fontFamily: T.fontMono,
                color,
                fontWeight: 700,
              }}
            >
              {p.outperformanceSgOtt >= 0 ? "+" : ""}
              {p.outperformanceSgOtt.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One dimension card in the archetype panel. Layout:
 *   - Top row: label + KEY badge + big r value + strength tag
 *   - Bar: horizontal correlation bar with 0 in the middle,
 *     +/-0.15 and +/-0.3 as landmarks, and a dot marker at the
 *     dimension's r
 *   - Two-column top-tail vs bottom-tail readout with tangible
 *     values in the dimension's own units
 *   - One-line English interpretation
 *   - Meta row: n, tour average
 */
function DimensionCard({ d }: { d: ArchetypeDim }) {
  const positive = d.correlation >= 0;
  const strong = Math.abs(d.correlation) >= 0.3;
  const moderate = Math.abs(d.correlation) >= 0.15 && !strong;
  const flat = Math.abs(d.correlation) < 0.05;
  const color = flat ? T.dim : positive ? T.emerald : T.tang;
  const strengthLabel = strong
    ? "STRONG"
    : moderate
      ? "MODERATE"
      : flat
        ? "FLAT"
        : "WEAK";
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "white",
        border: `1px solid ${T.line}`,
        borderLeft: `3px solid ${flat ? T.line : color}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
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
          {d.label}
          {d.isPriority && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 4,
                background: T.emeraldTint,
                color: T.emeraldD,
                fontSize: 8.5,
                letterSpacing: 0.6,
              }}
            >
              KEY
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.6,
            color: flat ? T.dim : color,
            fontWeight: 800,
          }}
        >
          {strengthLabel}
        </div>
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 22,
          fontWeight: 800,
          color,
          letterSpacing: -0.01,
          marginTop: 2,
        }}
      >
        r {d.correlation >= 0 ? "+" : ""}
        {d.correlation.toFixed(2)}
      </div>
      <CorrelationBar r={d.correlation} />
      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          fontFamily: T.fontUi,
          fontSize: 11,
          color: T.muted,
        }}
      >
        <div>
          <div
            style={{
              color: T.emerald,
              fontWeight: 700,
              fontSize: 9.5,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Top tail
          </div>
          <div
            style={{
              fontFamily: T.fontMono,
              fontWeight: 700,
              color: T.ink,
              fontSize: 13,
            }}
          >
            {fmtVal(d.topTailMean, d.unit)}{" "}
            <span style={{ color: T.dim, fontWeight: 600 }}>
              {d.unit}
            </span>
          </div>
        </div>
        <div>
          <div
            style={{
              color: T.tang,
              fontWeight: 700,
              fontSize: 9.5,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Bottom tail
          </div>
          <div
            style={{
              fontFamily: T.fontMono,
              fontWeight: 700,
              color: T.ink,
              fontSize: 13,
            }}
          >
            {fmtVal(d.bottomTailMean, d.unit)}{" "}
            <span style={{ color: T.dim, fontWeight: 600 }}>
              {d.unit}
            </span>
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          color: T.ink,
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {flat ? (
          <span style={{ color: T.muted }}>
            No clear signal — this dimension doesn&apos;t predict
            outperformance here.
          </span>
        ) : (
          <>
            Course-fit players show{" "}
            <span style={{ color, fontWeight: 800 }}>
              {d.interpretation}
            </span>
            .
          </>
        )}
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: 11,
          color: T.dim,
          fontFamily: T.fontUi,
        }}
      >
        n={d.n} · tour avg{" "}
        <span style={{ fontFamily: T.fontMono, fontWeight: 700 }}>
          {fmtVal(d.tourMean, d.unit)}
        </span>
      </div>
    </div>
  );
}

/** Horizontal correlation bar. −0.5 → +0.5 range on the axis so
 *  moderate/strong signals show meaningfully. Middle at 0. Weak/
 *  moderate boundaries at ±0.15, moderate/strong at ±0.3 — drawn as
 *  faint vertical tick lines. The value itself renders as a filled
 *  segment (bar) from 0 to r plus a dot marker at r. Colour matches
 *  card colour (emerald for +, tang for −, dim for flat). */
function CorrelationBar({ r }: { r: number }) {
  const SCALE_MAX = 0.5;
  const flat = Math.abs(r) < 0.05;
  const color = flat ? T.dim : r >= 0 ? T.emerald : T.tang;
  // Clamp r into the display range so extreme values don't overflow.
  const clamped = Math.max(-SCALE_MAX, Math.min(SCALE_MAX, r));
  // Positions as percentages along the bar (0% = -0.5, 100% = +0.5).
  const pct = (v: number) => ((v + SCALE_MAX) / (2 * SCALE_MAX)) * 100;
  const rPct = pct(clamped);
  const midPct = 50;
  // Filled segment goes from mid to r's position.
  const barLeft = Math.min(midPct, rPct);
  const barWidth = Math.abs(rPct - midPct);
  return (
    <div
      style={{
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 4,
          background: T.soft,
          border: `1px solid ${T.line}`,
        }}
      >
        {/* moderate boundaries at +/-0.15 */}
        {[pct(-0.3), pct(-0.15), pct(0.15), pct(0.3)].map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p}%`,
              top: -1,
              bottom: -1,
              width: 1,
              background: T.line,
            }}
          />
        ))}
        {/* midline (0) */}
        <div
          style={{
            position: "absolute",
            left: `${midPct}%`,
            top: -2,
            bottom: -2,
            width: 1.5,
            background: T.dim,
          }}
        />
        {/* filled segment from 0 to r */}
        <div
          style={{
            position: "absolute",
            top: 1,
            bottom: 1,
            left: `${barLeft}%`,
            width: `${barWidth}%`,
            background: color,
            borderRadius: 2,
            opacity: flat ? 0.35 : 1,
          }}
        />
        {/* marker dot at r */}
        <div
          style={{
            position: "absolute",
            top: -3,
            left: `calc(${rPct}% - 6px)`,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: color,
            border: "2px solid white",
            boxShadow: "0 1px 2px oklch(0 0 0 / 0.2)",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: T.dim,
          fontFamily: T.fontMono,
          fontWeight: 700,
          letterSpacing: 0.3,
        }}
      >
        <span>−0.5</span>
        <span>−0.3</span>
        <span>0</span>
        <span>+0.3</span>
        <span>+0.5</span>
      </div>
    </div>
  );
}

// ── This-week field toggle ─────────────────────────────────────────
/** Pill toggle for "restrict the rankings table to players actually
 *  teeing off this week". Renders inline with the other setup
 *  controls so the two filters (min rounds + this-week) live in one
 *  place. Hidden entirely when there's no active tour week. */
function ThisWeekToggle({
  on,
  onChange,
  tournamentName,
  fieldCount,
  matchedCount,
  totalPlayers,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  tournamentName: string | null;
  fieldCount: number;
  matchedCount: number;
  totalPlayers: number;
}) {
  return (
    <Field
      label="Filter by this week's field"
      help={
        on
          ? `Showing ${matchedCount} of ${fieldCount} players in ${tournamentName ?? "this week's field"} who have prior rounds at this course.`
          : tournamentName
            ? `Toggle on to hide players not teeing off in ${tournamentName} this week. Historical rankings shown across all ${totalPlayers} players otherwise.`
            : "Toggle on to hide players not teeing off this week."
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: T.fontUi,
          border: `1.5px solid ${on ? T.emerald : T.line}`,
          borderRadius: 999,
          background: on ? T.emeraldTint : "white",
          color: on ? T.emeraldD : T.ink,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 30,
            height: 16,
            borderRadius: 999,
            background: on ? T.emerald : T.line,
            position: "relative",
            flexShrink: 0,
            transition: "background 120ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: on ? 16 : 2,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "white",
              boxShadow: "0 1px 2px oklch(0 0 0 / 0.2)",
              transition: "left 120ms ease",
            }}
          />
        </span>
        <span>
          Only this week&apos;s field
          {tournamentName && (
            <span
              style={{
                marginLeft: 6,
                color: on ? T.emeraldD : T.muted,
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              · {tournamentName}
            </span>
          )}
        </span>
      </button>
    </Field>
  );
}

// ── Ranking table ──────────────────────────────────────────────────
/** Normalise a display name for cross-source lookup (matches the
 *  server-side normaliser in lib/course-history/forecast.ts). */
function normalisePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function RankingTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  forecast,
}: {
  rows: PlayerCourseStats[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  forecast: ForecastResp | null;
}) {
  // Build the name → predicted-residual lookup once per render.
  const predByName = useMemo(() => {
    const m = new Map<string, number>();
    if (!forecast?.ok || !forecast.players) return m;
    for (const p of forecast.players) {
      m.set(normalisePlayerName(p.name), p.predictedResidualPerRd);
    }
    return m;
  }, [forecast]);
  const forecastReliable = forecast?.ok && forecast.fit?.reliable === true;
  const showForecast = forecastReliable && predByName.size > 0;

  // If sorting by predicted or gap, re-sort in memory since the parent
  // sorter only knows about the base course-history columns.
  const orderedRows = useMemo(() => {
    if (
      sortKey !== "predictedOtt" &&
      sortKey !== "modelGap" &&
      sortKey !== "eventEdge"
    ) {
      return rows;
    }
    const dir = sortDir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const pa = predByName.get(normalisePlayerName(a.name)) ?? -Infinity;
      const pb = predByName.get(normalisePlayerName(b.name)) ?? -Infinity;
      // Event edge = pred × 4; monotonic in pred, so it sorts the
      // same order as predictedOtt but we keep it as a separate key
      // so the column header shows the sort chevron in the right
      // place.
      if (sortKey === "predictedOtt" || sortKey === "eventEdge") {
        return dir * (pa - pb);
      }
      // modelGap = actual − predicted (positive = over-shot our model)
      const ga = a.outperformanceSgOtt - pa;
      const gb = b.outperformanceSgOtt - pb;
      return dir * (ga - gb);
    });
  }, [rows, sortKey, sortDir, predByName]);

  return (
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
          minWidth: showForecast ? 1050 : 800,
        }}
      >
        <thead>
          {showForecast && (
            <tr style={{ background: T.soft }}>
              <GroupTh span={2} label="" />
              <GroupTh span={7} label="Historical" />
              <GroupTh span={3} label="Model forecast" accent />
            </tr>
          )}
          <tr style={{ background: T.soft }}>
            <Th sortable label="Player" k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <Th sortable label="Rds" k="roundsPlayed" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="At course OTT" k="atCourseSgOtt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="At course APP" k="atCourseSgApp" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="At course sum" k="atCourseCombined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="Baseline sum" k="baselineCombined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="Δ OTT" k="outperformanceSgOtt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="Δ APP" k="outperformanceSgApp" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th sortable label="Outperf." k="outperformanceCombined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} accent />
            {showForecast && (
              <>
                <Th sortable label="Pred OTT/rd" k="predictedOtt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} accent divider />
                <Th sortable label="Event Δ" k="eventEdge" sortKey={sortKey} sortDir={sortDir} onSort={onSort} accent />
                <Th sortable label="Perf. delta" k="modelGap" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {orderedRows.map((p, i) => {
            const pred = predByName.get(normalisePlayerName(p.name));
            const gap =
              typeof pred === "number"
                ? p.outperformanceSgOtt - pred
                : null;
            return (
              <tr
                key={p.dgId}
                style={{
                  background: i % 2 === 0 ? "white" : T.soft,
                }}
              >
                <td style={td()}>
                  <span style={{ fontWeight: 800, color: T.ink }}>
                    {p.name}
                  </span>
                </td>
                <td style={{ ...td(true) }}>{p.roundsPlayed}</td>
                <SgCell value={p.atCourseSgOtt} />
                <SgCell value={p.atCourseSgApp} />
                <SgCell value={p.atCourseCombined} strong />
                <SgCell value={p.baselineCombined} muted />
                <SgCell value={p.outperformanceSgOtt} sign />
                <SgCell value={p.outperformanceSgApp} sign />
                <SgCell value={p.outperformanceCombined} sign accent />
                {showForecast && (
                  <>
                    {typeof pred === "number" ? (
                      <SgCell value={pred} sign accent divider />
                    ) : (
                      <td
                        style={{
                          ...td(),
                          color: T.dim,
                          borderLeft: `2px solid ${T.line}`,
                        }}
                      >
                        —
                      </td>
                    )}
                    {typeof pred === "number" ? (
                      <SgCell value={pred * 4} sign accent />
                    ) : (
                      <td style={{ ...td(), color: T.dim }}>—</td>
                    )}
                    {typeof gap === "number" ? (
                      <SgCell value={gap} sign muted />
                    ) : (
                      <td style={{ ...td(), color: T.dim }}>—</td>
                    )}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  sortable = false,
  align = "right",
  accent = false,
  divider = false,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  sortable?: boolean;
  align?: "left" | "right";
  accent?: boolean;
  divider?: boolean;
}) {
  const isActive = sortKey === k;
  return (
    <th
      onClick={sortable ? () => onSort(k) : undefined}
      style={{
        textAlign: align,
        padding: "10px 10px",
        borderBottom: `1px solid ${T.line}`,
        borderLeft: divider ? `2px solid ${T.line}` : undefined,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: isActive ? T.emeraldD : accent ? T.emeraldD : T.muted,
        fontFamily: T.fontUi,
        cursor: sortable ? "pointer" : "default",
        whiteSpace: "nowrap",
        userSelect: "none",
        background: accent && !isActive ? T.emeraldTint : undefined,
      }}
    >
      {label}
      {sortable && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 9,
            opacity: isActive ? 1 : 0.35,
          }}
        >
          {isActive ? (sortDir === "desc" ? "▼" : "▲") : "▼"}
        </span>
      )}
    </th>
  );
}

function SgCell({
  value,
  sign = false,
  accent = false,
  muted = false,
  strong = false,
  divider = false,
}: {
  value: number;
  sign?: boolean;
  accent?: boolean;
  muted?: boolean;
  strong?: boolean;
  divider?: boolean;
}) {
  const color = sign
    ? value > 0.02
      ? T.up
      : value < -0.02
        ? T.down
        : T.muted
    : muted
      ? T.muted
      : T.ink;
  const bg = accent ? T.emeraldTint : "transparent";
  const display =
    (sign && value >= 0 ? "+" : "") + value.toFixed(2);
  return (
    <td
      style={{
        ...td(strong),
        color,
        background: bg,
        fontWeight: accent || strong ? 800 : 600,
        borderLeft: divider ? `2px solid ${T.line}` : undefined,
      }}
    >
      {display}
    </td>
  );
}

/** Column-group header cell — spans multiple data columns to make
 *  the split between historical stats and model-forecast columns
 *  obvious at a glance. Small, muted, uppercase — not a data
 *  header, just a grouping label. */
function GroupTh({
  label,
  span,
  accent = false,
}: {
  label: string;
  span: number;
  accent?: boolean;
}) {
  return (
    <th
      colSpan={span}
      style={{
        textAlign: label ? "center" : "left",
        padding: label ? "8px 10px 4px" : 0,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: accent ? T.emeraldD : T.dim,
        fontFamily: T.fontUi,
        background: accent ? T.emeraldTint : undefined,
        borderLeft: accent ? `2px solid ${T.line}` : undefined,
        borderBottom: label ? `1px solid ${T.line}` : undefined,
      }}
    >
      {label}
    </th>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────
function panel(): React.CSSProperties {
  return {
    padding: 20,
    border: `1px solid ${T.line}`,
    borderRadius: 12,
    background: T.card,
    boxShadow: "0 1px 0 oklch(0 0 0 / 0.02)",
  };
}
function ip(): React.CSSProperties {
  return {
    padding: "9px 11px",
    fontSize: 14,
    color: T.ink,
    border: `1px solid ${T.line}`,
    borderRadius: 6,
    background: "white",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
}
function td(strong = false): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderBottom: `1px solid ${T.lineSoft}`,
    fontSize: 13.5,
    fontFamily: strong ? T.fontUi : T.fontMono,
    fontWeight: strong ? 800 : 600,
    color: T.ink,
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  };
}

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
        marginBottom: 14,
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
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
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
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: T.muted,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          fontFamily: T.fontUi,
        }}
      >
        {label}
      </span>
      {children}
      {help && (
        <span
          style={{
            fontSize: 11,
            color: T.dim,
            fontFamily: T.fontUi,
            lineHeight: 1.5,
          }}
        >
          {help}
        </span>
      )}
    </label>
  );
}
