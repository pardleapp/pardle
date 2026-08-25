"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Chart from "./Chart";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { DailyWeatherView } from "../_components/WeatherStrip";

export type RoundNum = 1 | 2 | 3 | 4;

export interface Row {
  dgId: string;
  name: string;
  round: RoundNum;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
  noSkill?: boolean;
  projected?: boolean;
  thruHoles?: number;
  currentToPar?: number;
}

interface FetchResp {
  ok: boolean;
  error?: string;
  source?: "historical";
  year?: number;
  eventName?: string;
  count?: number;
  countByRound?: { r1: number; r2: number; r3?: number; r4?: number };
  generatedAt?: number | null;
  rows?: Row[];
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

/** Poll cadence — 60 s is plenty for a golf round; players finish
 *  at roughly 15 min intervals so refreshing more often is waste. */
const POLL_MS = 60_000;

/** "live" resolves to whatever the orchestrator says is active right
 *  now; a numeric year loads the corresponding {slug}-{year}.json. */
type YearTab = "live" | string;

interface TournamentOption {
  slug: string;
  eventName: string;
  historicalYears: number[];
  isLiveNow: boolean;
}

interface TournamentsResp {
  ok: boolean;
  activeTournamentId: string | null;
  activeTournamentName: string | null;
  tournaments: TournamentOption[];
}



export default function Page() {
  const [tab, setTab] = useState<YearTab>("live");
  const [data, setData] = useState<FetchResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  // Which tournament's rows we're looking at. Historical fetch uses
  // ?slug=<slug>&year=<year>; live fetch also passes ?slug so the
  // server can pick the correct venue snapshot even when the
  // orchestrator's active event differs.
  const [slug, setSlug] = useState<string | null>(null);
  // Feeds the PIN Δ + TEE Δ chip columns on the heatmap — same source
  // of truth the course-heatmap page uses. Keyed by tournamentId so a
  // year switch triggers a re-fetch (cached 6h server-side).

  const load = useCallback(async () => {
    try {
      // Historical needs both slug and year; live ignores slug (the
      // server picks the active event via the orchestrator).
      const qs =
        tab === "live"
          ? ""
          : slug
            ? `?slug=${encodeURIComponent(slug)}&year=${tab}`
            : `?year=${tab}`;
      const res = await fetch(`/api/analysis/tee-time-scoring${qs}`, {
        cache: "no-store",
      });
      setData((await res.json()) as FetchResp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, [tab, slug]);

  useEffect(() => {
    setData(null);
    load();
    if (tab !== "live") return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, tab]);

  // Discover which tournaments have onboarded historicals. Called
  // once on mount — the list is small enough to fetch every time
  // and the endpoint is fully cached in memory after the first hit.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/analysis/tournaments", { cache: "no-store" });
        const json = (await res.json()) as TournamentsResp;
        if (!json.ok) return;
        setTournaments(json.tournaments);
        // Default slug: the currently-live tournament if we have one,
        // else the first tournament in the list. Runs only when slug
        // has not been touched by the user (initial mount).
        setSlug((prev) => {
          if (prev) return prev;
          const live = json.tournaments.find((t) => t.isLiveNow);
          return live?.slug ?? json.tournaments[0]?.slug ?? null;
        });
      } catch {
        /* Non-fatal — tournament switcher just won't render. */
      }
    })();
  }, []);

  // Snap the year tab to something the picked tournament actually
  // has. Two cases:
  //   1. user was on "live" then picked a tournament that isn't the
  //      live one → drop to its most recent historical year;
  //   2. user was on year N then picked a tournament that lacks that
  //      year → drop to its most recent historical year.
  // Without this the year row would show nothing selected and the
  // fetch would either 404 or keep serving the previous tournament's
  // data.
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

  const activeTournament =
    tournaments.find((t) => t.slug === slug) ?? null;
  const yearTabs: YearTab[] = [
    ...(activeTournament?.isLiveNow ? (["live"] as YearTab[]) : []),
    ...(activeTournament
      ? [...activeTournament.historicalYears]
          .sort((a, b) => b - a)
          .map((y) => String(y))
      : []),
  ];


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
          // Fill the shell's middle grid track edge-to-edge — no
          // maxWidth cap here (the shell already sizes the track);
          // the shell's column-gap is the gutter to the nav rail.
          padding: "20px 4px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
        }}
      >
        <p style={{ fontSize: 12, color: "oklch(0.5 0.02 150)", margin: "0 0 6px" }}>
          <Link
            href="/analysis"
            style={{ color: "oklch(0.5 0.02 150)", textDecoration: "none" }}
          >
            ← All analyses
          </Link>
        </p>
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          Skill-adjusted score vs tee time
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          Every finisher of a round plotted at their tee time, adjusted for
          pre-tournament skill. Points below zero outperformed baseline,
          above zero under-performed. Refreshes as new players finish.
        </p>
        <p style={{ fontSize: 12, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
          Looking for how each hole played?{" "}
          <Link href="/analysis/hole-scoring" style={{ color: "oklch(0.42 0.13 155)" }}>
            Hole scoring analysis
          </Link>{" "}
          covers length, pin and wind per hole.
        </p>
        {tournaments.length > 0 && (
          <div
            role="tablist"
            aria-label="Tournament"
            style={{
              display: "flex",
              gap: 4,
              marginTop: 12,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            {tournaments.map((t) => {
              const active = slug === t.slug;
              return (
                <button
                  key={t.slug}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSlug(t.slug)}
                  style={{
                    padding: "5px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 6,
                    border: "1px solid oklch(0.85 0.013 95)",
                    background: active ? "oklch(0.35 0.03 150)" : "white",
                    color: active ? "white" : "oklch(0.3 0.02 150)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {t.eventName}
                  {t.isLiveNow && (
                    <span
                      aria-label="Live now"
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "oklch(0.65 0.20 30)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div
          role="tablist"
          aria-label="Year"
          style={{
            display: "flex",
            gap: 4,
            marginTop: 12,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          {yearTabs.map((t) => {
            const active = tab === t;
            const label = t === "live" ? "Live" : t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "1px solid oklch(0.85 0.013 95)",
                  background: active ? "oklch(0.25 0.02 150)" : "white",
                  color: active ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {tab !== "live" && (
          <p
            style={{
              fontSize: 11,
              color: "oklch(0.55 0.02 150)",
              margin: "4px 0 0",
            }}
          >
            {data?.eventName ?? activeTournament?.eventName ?? "Historical"} {tab}.
            Skill baseline is each player&apos;s pre-tournament projection;
            deviation from that is what the y-axis shows.
          </p>
        )}
      {error ? (
        <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
          Couldn&apos;t load data: {error}
        </p>
      ) : (

        !data || !data.ok ? (
          <p style={{ marginTop: 20 }}>
            {!data ? "Loading…" : `Couldn't load data: ${data.error}`}
          </p>
        ) : !data.rows || data.rows.length === 0 ? (
          <p style={{ marginTop: 20 }}>
            Nobody has finished R1 yet — check back after the first group is
            done.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 11, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
              {data.countByRound
                ? [
                    data.countByRound.r1 != null && `R1: ${data.countByRound.r1}`,
                    data.countByRound.r2 != null && `R2: ${data.countByRound.r2}`,
                    data.countByRound.r3 != null && `R3: ${data.countByRound.r3}`,
                    data.countByRound.r4 != null && `R4: ${data.countByRound.r4}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `${data.count} rows`}
              {" · "}
              {data.generatedAt
                ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : ""}
            </p>
            <Chart rows={data.rows} weatherByRound={data.weatherByRound} />
          </>
        )
      )}
      </section>
    </main>
  );
}
