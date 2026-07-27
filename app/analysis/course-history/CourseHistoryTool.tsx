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
interface CuratedEvent {
  eventId: number;
  eventName: string;
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
  eventId?: number;
  eventName?: string;
  courseName?: string;
  yearsCovered?: number[];
  players?: PlayerCourseStats[];
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
  | "name";

// ── Main component ─────────────────────────────────────────────────
export default function CourseHistoryTool() {
  const [events, setEvents] = useState<CuratedEvent[] | null>(null);
  const [eventQuery, setEventQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [data, setData] = useState<CourseHistoryResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [minRounds, setMinRounds] = useState(4);
  const [sortKey, setSortKey] = useState<SortKey>("outperformanceCombined");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Load event list
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/course-history/events");
        const j = (await res.json()) as {
          ok?: boolean;
          events?: CuratedEvent[];
        };
        if (j.ok && j.events) {
          setEvents(j.events);
          // Auto-select 3M Open (event 525) if present so the tool
          // has data on first paint. Otherwise pick the first.
          const preferred =
            j.events.find((e) => e.eventId === 525) ?? j.events[0];
          if (preferred) {
            setSelectedEventId(preferred.eventId);
            setEventQuery(preferred.eventName);
          }
        }
      } catch {
        /* silent — user can try again */
      }
    })();
  }, []);

  // Load course history when event changes
  useEffect(() => {
    if (selectedEventId == null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      try {
        const res = await fetch(
          `/api/course-history?eventId=${selectedEventId}`,
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
  }, [selectedEventId]);

  const filteredEvents = useMemo(() => {
    const q = eventQuery.trim().toLowerCase();
    if (!events) return [];
    if (!q) return events.slice(0, 40);
    return events
      .filter((e) => e.eventName.toLowerCase().includes(q))
      .slice(0, 40);
  }, [events, eventQuery]);

  const rows = useMemo(() => {
    if (!data?.players) return [];
    const filtered = data.players.filter(
      (p) => p.roundsPlayed >= minRounds,
    );
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortKey === "name") return dir * a.name.localeCompare(b.name);
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return dir * (av - bv);
    });
    return sorted;
  }, [data, minRounds, sortKey, sortDir]);

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

  const selectedEvent = events?.find((e) => e.eventId === selectedEventId);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Setup panel */}
      <div style={panel()}>
        <SectionHeader
          step={1}
          title="Course"
          subtitle="Pick any PGA Tour recurring event since 2019"
        />
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="Event / course">
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder={events ? "Type to search…" : "Loading events…"}
                value={eventQuery}
                onChange={(e) => {
                  setEventQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                onBlur={() =>
                  setTimeout(() => setDropdownOpen(false), 200)
                }
                style={ip()}
                disabled={events == null}
              />
              {dropdownOpen && filteredEvents.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    maxHeight: 320,
                    overflowY: "auto",
                    background: "white",
                    border: `1px solid ${T.line}`,
                    borderRadius: 8,
                    boxShadow: "0 8px 24px oklch(0 0 0 / 0.10)",
                    zIndex: 20,
                    fontFamily: T.fontUi,
                  }}
                >
                  {filteredEvents.map((ev) => (
                    <button
                      key={ev.eventId}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedEventId(ev.eventId);
                        setEventQuery(ev.eventName);
                        setDropdownOpen(false);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        border: "none",
                        background:
                          ev.eventId === selectedEventId
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
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {ev.eventName}
                      </span>
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: 12,
                          color: T.muted,
                          fontWeight: 700,
                        }}
                      >
                        {ev.mostRecentYear}
                      </span>
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
            data?.courseName
              ? `${data.courseName}`
              : selectedEvent?.eventName ?? "Course rankings"
          }
          subtitle={
            data?.yearsCovered && data.yearsCovered.length > 0
              ? `${data.yearsCovered[0]}–${data.yearsCovered[data.yearsCovered.length - 1]} · ${data.players?.length ?? 0} players · vs per-year leave-one-out baseline`
              : "Ranked by outperformance (at-course SG − per-year baseline)"
          }
          accent
        />

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
          <RankingTable
            rows={rows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={clickSort}
          />
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
            No players meet the minimum-rounds filter. Try lowering
            it above.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ranking table ──────────────────────────────────────────────────
function RankingTable({
  rows,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: PlayerCourseStats[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
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
          minWidth: 800,
        }}
      >
        <thead>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
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
            </tr>
          ))}
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
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  sortable?: boolean;
  align?: "left" | "right";
  accent?: boolean;
}) {
  const isActive = sortKey === k;
  return (
    <th
      onClick={sortable ? () => onSort(k) : undefined}
      style={{
        textAlign: align,
        padding: "10px 10px",
        borderBottom: `1px solid ${T.line}`,
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
}: {
  value: number;
  sign?: boolean;
  accent?: boolean;
  muted?: boolean;
  strong?: boolean;
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
      }}
    >
      {display}
    </td>
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
