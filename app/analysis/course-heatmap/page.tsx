"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { Cell } from "./Heatmap";
import GreensGrid from "./GreensGrid";
import PinSheetModal from "./PinSheetModal";
import { R1_CLUSTER_BY_TOURNAMENT } from "./r1-estimated-pins";
import type { DailyWeatherView } from "../_components/WeatherStrip";
import type {
  CoursePinSheet,
  CoursePinHole,
  TournamentPuttSheet,
} from "@/lib/golf-api/pgatour";
import type { HoleBirdieData } from "@/lib/analysis/course-birdies";

interface FetchResp {
  ok: boolean;
  error?: string;
  source?: "historical";
  year?: number;
  eventName?: string;
  tournamentId?: string;
  bucketMinutes?: number;
  cells?: Cell[];
  generatedAt?: number | null;
  roundRanges?: Record<
    number,
    { minMins: number; maxMins: number; cellCount: number }
  >;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

interface PinsResp {
  ok: boolean;
  cached?: boolean;
  pins?: CoursePinSheet;
  error?: string;
}

interface PuttsResp {
  ok: boolean;
  cached?: boolean;
  putts?: TournamentPuttSheet;
  error?: string;
}

interface BirdieHistResp {
  ok: boolean;
  cached?: boolean;
  yearsCovered?: number[];
  holes?: Record<string, HoleBirdieData>;
  error?: string;
}

const POLL_MS = 60_000;
type YearTab =
  | "live"
  | "2025"
  | "2024"
  | "2023"
  | "2022"
  | "2021"
  | "2020"
  | "2019";
const YEAR_TABS: YearTab[] = [
  "live",
  "2025",
  "2024",
  "2023",
  "2022",
  "2021",
  "2020",
  "2019",
];

export default function Page() {
  const [tab, setTab] = useState<YearTab>("live");
  const [data, setData] = useState<FetchResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<CoursePinSheet | null>(null);
  const [pinsForTournament, setPinsForTournament] = useState<string | null>(null);
  const [putts, setPutts] = useState<TournamentPuttSheet | null>(null);
  const [puttsLoading, setPuttsLoading] = useState(false);
  const [openHole, setOpenHole] = useState<number | null>(null);
  const [birdieHistoryByHole, setBirdieHistoryByHole] = useState<Record<
    string,
    HoleBirdieData
  > | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = tab === "live" ? "" : `?year=${tab}`;
      const res = await fetch(`/api/analysis/course-heatmap${qs}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResp;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, [tab]);

  useEffect(() => {
    // Reset the previous tab's data so we don't briefly render stale
    // cells from another year while the new fetch is in flight.
    setData(null);
    setPins(null);
    setPinsForTournament(null);
    setPutts(null);
    setPuttsLoading(false);
    setOpenHole(null);
    setBirdieHistoryByHole(null);
    load();
    // Only the live tab polls; historical files never change.
    if (tab !== "live") return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, tab]);

  // Fetch pin sheet + putt sheet whenever we get a tournamentId.
  // Cached 6h Redis-side. Pin sheet is small + fast; putt sheet is
  // ~30s cold (240 shotDetailsV3 calls) so we fire it in the
  // background right away so the modal has data ready when opened.
  useEffect(() => {
    const tid = data?.tournamentId;
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
        /* pin-sheet failure is non-fatal — the heatmap still renders. */
      }
    })();
    setPuttsLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/hole-putts?tournamentId=${encodeURIComponent(tid)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as PuttsResp;
        if (json.ok && json.putts) setPutts(json.putts);
      } catch {
        /* putt overlay is non-fatal; modal will fall back to no overlay */
      } finally {
        setPuttsLoading(false);
      }
    })();
    // Multi-season birdie history — cheap after warm cache, so fire
    // right away rather than waiting for the modal to open.
    (async () => {
      try {
        const res = await fetch(
          `/api/course-pin-birdies?tournamentId=${encodeURIComponent(tid)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as BirdieHistResp;
        if (json.ok && json.holes) setBirdieHistoryByHole(json.holes);
      } catch {
        /* history overlay is opt-in; failing silently is fine */
      }
    })();
  }, [data?.tournamentId, pinsForTournament]);

  /** Augment the pin sheet with an estimated R1 pin for holes the
   *  orchestrator hasn't published yet — we plot the centroid of the
   *  cluster the pin sits on per the pre-round SHOTLINK sheet. Only
   *  fires for holes with a null R1 in the raw sheet AND a mapping
   *  in R1_CLUSTER_BY_TOURNAMENT for the active tournament. When the
   *  orchestrator's real coord lands, this fallback silently retires. */
  const augmentedPins: CoursePinSheet | null = (() => {
    if (!pins) return pins;
    const tid = data?.tournamentId;
    if (!tid) return pins;
    const map = R1_CLUSTER_BY_TOURNAMENT[tid];
    if (!map) return pins;
    let anyChange = false;
    const augmentedHoles = pins.holes.map((h) => {
      const existingR1 = h.pinByRound?.[1];
      if (existingR1) return h;
      const letter = map[h.holeNumber];
      if (!letter) return h;
      const birdie = birdieHistoryByHole?.[String(h.holeNumber)];
      if (!birdie) return h;
      const idx = letter.charCodeAt(0) - 65;
      const cluster = birdie.clusters[idx];
      if (!cluster) return h;
      anyChange = true;
      return {
        ...h,
        pinByRound: {
          ...h.pinByRound,
          1: {
            x: cluster.centroid.x,
            y: cluster.centroid.y,
            frameEnh: true,
            estimated: true,
          },
        },
      };
    });
    return anyChange ? { ...pins, holes: augmentedHoles } : pins;
  })();

  /** Merge the raw pin sheet with per-hole/per-round scoring derived
   *  from the heatmap cells we already have. PGA Tour's own
   *  scoringAverage field on courseStats is empty for historical
   *  events; the cells we render the heatmap from carry the same
   *  signal so we fill scoringByRound here rather than fetching
   *  again. Weighted by player count per bucket so a sparse morning
   *  window doesn't skew the round total. */
  const openHoleData: CoursePinHole | null = (() => {
    if (openHole == null) return null;
    const base = pins?.holes.find((h) => h.holeNumber === openHole) ?? null;
    if (!base) return null;
    if (!data?.cells) return base;
    const merged: CoursePinHole["scoringByRound"] = { ...base.scoringByRound };
    for (let round = 1; round <= 4; round++) {
      // Skip if PGA Tour already had a real value for this round.
      const existing = merged[round];
      if (existing?.vsPar != null || existing?.avg != null) continue;
      let sum = 0;
      let n = 0;
      for (const cell of data.cells) {
        if (cell.round !== round || cell.hole !== openHole) continue;
        sum += cell.avgVsPar * cell.count;
        n += cell.count;
      }
      if (n === 0) continue;
      const vsPar = sum / n;
      const avg = base.par != null ? base.par + vsPar : null;
      merged[round] = { avg, vsPar };
    }
    return { ...base, scoringByRound: merged };
  })();

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
          // Fill the shell's middle grid track edge-to-edge — the
          // shell column-gap already provides the gutter between the
          // nav rail and this content.
          padding: "20px 4px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
          minWidth: 0,
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
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          Course &amp; pin guide
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          Every green on the property — this week&apos;s R1-R4 pin
          positions overlaid on the aerial. Click a card for putt
          paths, multi-season birdie history, and per-round scoring.
          The <b>PIN Δ</b> chip flags any hole where one cluster
          stands ≥10pp above or below the other clusters&apos;
          birdie rate; the <b>TEE Δ</b> chip flags holes whose tee
          markers moved &gt;30 yd across the tournament.
        </p>
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
          {YEAR_TABS.map((t) => {
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
            {data?.eventName ?? "3M Open"} {tab} — TPC Twin Cities. Historical
            data; won&apos;t refresh.
          </p>
        )}
        {error ? (
          <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
            Couldn&apos;t load pin data: {error}
          </p>
        ) : (
          <>
            {tab === "live" && !pins && (
              <p
                style={{
                  fontSize: 12,
                  color: "oklch(0.55 0.02 150)",
                  marginTop: 8,
                }}
              >
                Loading this week&apos;s pin sheet…
              </p>
            )}
            <GreensGrid
              pinsByHole={
                augmentedPins
                  ? new Map(
                      augmentedPins.holes.map((h) => [h.holeNumber, h]),
                    )
                  : undefined
              }
              birdieHistoryByHole={birdieHistoryByHole}
              onHoleClick={pins ? (h) => setOpenHole(h) : undefined}
            />
          </>
        )}
      </section>
      {openHoleData && (
        <PinSheetModal
          hole={openHoleData}
          currentTournamentId={data?.tournamentId ?? null}
          puttsForHole={putts?.puttsByHole[openHoleData.holeNumber] ?? []}
          puttsGreenImageUrl={
            putts?.greenImageByHole[openHoleData.holeNumber] ?? null
          }
          puttsLoading={puttsLoading && (putts?.puttsByHole[openHoleData.holeNumber]?.length ?? 0) === 0}
          birdieHistory={
            birdieHistoryByHole?.[String(openHoleData.holeNumber)] ?? null
          }
          onClose={() => setOpenHole(null)}
        />
      )}
    </main>
  );
}
