"use client";

/**
 * Hole scoring analysis.
 *
 * Split out of the tee-time tool, where the hole/hour grid was a
 * second tab and the setup data that explains it was scattered across
 * chip columns inside that grid. The grid is a good forensic object
 * but a poor headline: it asks the reader to infer a hole's story
 * from a row of coloured squares.
 *
 * So the order is inverted here. The setup a committee actually
 * changes each morning — length and wind — leads, with scoring as
 * the outcome column beside it, and the hour-by-hour grid moves
 * behind a disclosure for when someone wants to see how a hole
 * behaved across the waves.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Heatmap, { type Cell } from "../course-heatmap/Heatmap";
import HoleSetup from "./HoleSetup";
import WeatherStrip, {
  type DailyWeatherView,
} from "../_components/WeatherStrip";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { CoursePinSheet, CoursePinHole } from "@/lib/golf-api/pgatour";
import type { HoleBirdieData } from "@/lib/analysis/course-birdies";

const POLL_MS = 90_000;

type YearTab = string;

interface TournamentOption {
  slug: string;
  eventName: string;
  historicalYears: number[];
  isLiveNow: boolean;
}
interface TournamentsResp {
  ok: boolean;
  tournaments: TournamentOption[];
}
interface HeatmapResp {
  ok: boolean;
  error?: string;
  eventName?: string;
  bucketMinutes?: number;
  cells?: Cell[];
  generatedAt?: number | null;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
  tournamentId?: string | null;
  holeBearings?: Record<number, number> | null;
}
interface PinsResp {
  ok: boolean;
  pins?: CoursePinSheet;
}
interface BirdieHistResp {
  ok: boolean;
  holes?: Record<string, HoleBirdieData>;
}

export default function Page() {
  const [tab, setTab] = useState<YearTab>("live");
  const [heat, setHeat] = useState<HeatmapResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [round, setRound] = useState<number>(1);
  const [showGrid, setShowGrid] = useState(false);
  const [pins, setPins] = useState<CoursePinSheet | null>(null);
  const [pinsForTournament, setPinsForTournament] = useState<string | null>(
    null,
  );
  const [birdieHistoryByHole, setBirdieHistoryByHole] = useState<Record<
    string,
    HoleBirdieData
  > | null>(null);

  const load = useCallback(async () => {
    try {
      const qs =
        tab === "live"
          ? ""
          : slug
            ? `?slug=${encodeURIComponent(slug)}&year=${tab}`
            : `?year=${tab}`;
      const res = await fetch(`/api/analysis/course-heatmap${qs}`, {
        cache: "no-store",
      });
      setHeat((await res.json()) as HeatmapResp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, [tab, slug]);

  useEffect(() => {
    setHeat(null);
    load();
    if (tab !== "live") return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, tab]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/analysis/tournaments", {
          cache: "no-store",
        });
        const json = (await res.json()) as TournamentsResp;
        if (!json.ok) return;
        setTournaments(json.tournaments);
        setSlug((prev) => {
          if (prev) return prev;
          const live = json.tournaments.find((t) => t.isLiveNow);
          return live?.slug ?? json.tournaments[0]?.slug ?? null;
        });
      } catch {
        /* switcher just won't render */
      }
    })();
  }, []);

  // Keep the year tab on something the picked tournament has.
  useEffect(() => {
    if (!slug) return;
    const t = tournaments.find((x) => x.slug === slug);
    if (!t) return;
    if (tab === "live" && t.isLiveNow) return;
    if (tab !== "live" && t.historicalYears.includes(Number(tab))) return;
    const years = [...t.historicalYears].sort((a, b) => b - a);
    if (years.length > 0) setTab(String(years[0]));
    else if (t.isLiveNow) setTab("live");
  }, [slug, tab, tournaments]);

  useEffect(() => {
    const tid = heat?.tournamentId;
    if (!tid || tid === pinsForTournament) return;
    setPinsForTournament(tid);
    (async () => {
      try {
        const res = await fetch(
          `/api/course-pins?tournamentId=${encodeURIComponent(tid)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as PinsResp;
        if (json.ok && json.pins) setPins(json.pins);
      } catch {
        /* non-fatal */
      }
    })();
    (async () => {
      try {
        const res = await fetch(
          `/api/course-pin-birdies?tournamentId=${encodeURIComponent(tid)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as BirdieHistResp;
        if (json.ok && json.holes) setBirdieHistoryByHole(json.holes);
      } catch {
        /* opt-in overlay */
      }
    })();
  }, [heat?.tournamentId, pinsForTournament]);

  const activeTournament = tournaments.find((t) => t.slug === slug) ?? null;
  const yearTabs: YearTab[] = [
    ...(activeTournament?.isLiveNow ? (["live"] as YearTab[]) : []),
    ...(activeTournament
      ? [...activeTournament.historicalYears]
          .sort((a, b) => b - a)
          .map((y) => String(y))
      : []),
  ];

  const cells = heat?.cells ?? [];
  const availableRounds = [...new Set(cells.map((c) => c.round))].sort();
  const effectiveRound = availableRounds.includes(round)
    ? round
    : (availableRounds[0] ?? 1);
  const pinsByHole = pins
    ? new Map<number, CoursePinHole>(pins.holes.map((h) => [h.holeNumber, h]))
    : undefined;

  return (
    <main className="container container-wide v4-theme pv-theme analysis-full-shell">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          padding: "20px 4px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
        }}
      >
        <p
          style={{ fontSize: 12, color: "oklch(0.5 0.02 150)", margin: "0 0 6px" }}
        >
          <Link
            href="/analysis"
            style={{ color: "oklch(0.5 0.02 150)", textDecoration: "none" }}
          >
            ← All analyses
          </Link>
        </p>
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>Hole scoring analysis</h2>
        <p
          style={{
            fontSize: 13,
            color: "oklch(0.5 0.02 150)",
            margin: 0,
            maxWidth: 640,
          }}
        >
          What the setup did to each hole, round by round — how far back the
          tees went, which way the wind blew across it, and what the field
          then shot.
        </p>

        <Picker
          label="Tournament"
          options={tournaments.map((t) => ({
            key: t.slug,
            label: t.eventName,
            live: t.isLiveNow,
          }))}
          active={slug}
          onPick={(k) => setSlug(k)}
          tone="oklch(0.35 0.03 150)"
        />
        {yearTabs.length > 0 && (
          <Picker
            label="Year"
            options={yearTabs.map((y) => ({
              key: y,
              label: y === "live" ? "This week" : y,
              live: y === "live",
            }))}
            active={tab}
            onPick={(k) => setTab(k)}
            tone="oklch(0.50 0.13 155)"
          />
        )}

        {error && (
          <p style={{ marginTop: 20, color: "oklch(0.5 0.18 25)" }}>
            Couldn&rsquo;t load data: {error}
          </p>
        )}
        {!error && !heat && <p style={{ marginTop: 20 }}>Loading…</p>}
        {!error && heat && !heat.ok && (
          <p style={{ marginTop: 20 }}>
            Couldn&rsquo;t load data: {heat.error}
          </p>
        )}
        {!error && heat?.ok && cells.length === 0 && (
          <p style={{ marginTop: 20, color: "oklch(0.5 0.02 150)" }}>
            No completed rounds yet — this fills in once the first round
            finishes.
          </p>
        )}

        {!error && heat?.ok && cells.length > 0 && (
          <>
            {availableRounds.length > 1 && (
              <Picker
                label="Round"
                options={availableRounds.map((r) => ({
                  key: String(r),
                  label: `R${r}`,
                }))}
                active={String(effectiveRound)}
                onPick={(k) => setRound(Number(k))}
                tone="oklch(0.25 0.02 150)"
              />
            )}

            <WeatherStrip
              day={heat.weatherByRound?.[String(effectiveRound)] ?? null}
              roundLabel={`R${effectiveRound} weather`}
            />

            <div style={{ marginTop: 18 }}>
              <HoleSetup
                cells={cells}
                round={effectiveRound}
                pinsByHole={pinsByHole}
                holeBearings={heat.holeBearings ?? null}
                weatherByRound={heat.weatherByRound ?? null}
              />
            </div>

            {/* The grid is the detail, not the headline. */}
            <div style={{ marginTop: 26 }}>
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                aria-expanded={showGrid}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  fontSize: 12.5,
                  fontWeight: 800,
                  borderRadius: 8,
                  border: "1px solid oklch(0.85 0.013 95)",
                  background: "white",
                  color: "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    transform: showGrid ? "rotate(90deg)" : "none",
                    transition: "transform .15s",
                  }}
                >
                  ▶
                </span>
                {showGrid ? "Hide" : "Show"} scoring hour by hour
              </button>
              {!showGrid && (
                <p
                  style={{
                    fontSize: 11.5,
                    color: "oklch(0.55 0.02 150)",
                    margin: "8px 2px 0",
                    maxWidth: 620,
                  }}
                >
                  The full grid — every hole against every hour of the day —
                  for checking whether a hole bit one wave harder than
                  another.
                </p>
              )}
              {showGrid && (
                <div style={{ marginTop: 12 }}>
                  <Heatmap
                    cells={cells}
                    bucketMinutes={heat.bucketMinutes ?? 15}
                    weatherByRound={heat.weatherByRound}
                    pinsByHole={pinsByHole}
                    birdieHistoryByHole={birdieHistoryByHole}
                    pinsAvailable={!!pins}
                    holeBearings={heat.holeBearings ?? null}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Picker({
  label,
  options,
  active,
  onPick,
  tone,
}: {
  label: string;
  options: { key: string; label: string; live?: boolean }[];
  active: string | null;
  onPick: (key: string) => void;
  tone: string;
}) {
  if (options.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{
        display: "flex",
        gap: 4,
        marginTop: 12,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "oklch(0.55 0.02 150)",
          marginRight: 2,
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const isActive = active === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(o.key)}
            style={{
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 6,
              border: "1px solid oklch(0.85 0.013 95)",
              background: isActive ? tone : "white",
              color: isActive ? "white" : "oklch(0.3 0.02 150)",
              cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {o.label}
            {o.live && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: isActive ? "white" : "oklch(0.55 0.19 25)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
