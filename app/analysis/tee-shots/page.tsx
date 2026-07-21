"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { PlayerDrivingProfile } from "@/lib/feed/tee-shots-profile";
import ProfileVisuals from "./ProfileVisuals";

interface RankedPlayer {
  playerId: string;
  name: string;
  shotCount: number;
}

interface IndexResp {
  ok: boolean;
  players?: RankedPlayer[];
  error?: string;
}
interface ProfileResp {
  ok: boolean;
  profile?: PlayerDrivingProfile;
  error?: string;
}

export default function Page() {
  const [players, setPlayers] = useState<RankedPlayer[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<PlayerDrivingProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Load the ranked player index on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tee-shot-profile", { cache: "no-store" });
        const json = (await res.json()) as IndexResp;
        if (alive && json.ok && json.players) {
          setPlayers(json.players);
          // Auto-select the leader — usually gives an immediate visual.
          setSelected(json.players[0]?.playerId ?? null);
        }
      } catch {
        // ignored — surfaces as "no data yet"
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fetch profile whenever the selected player changes.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoadingProfile(true);
    setProfileError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/tee-shot-profile?playerId=${encodeURIComponent(selected)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ProfileResp;
        if (!alive) return;
        if (json.ok && json.profile) {
          setProfile(json.profile);
        } else {
          setProfile(null);
          setProfileError(json.error ?? "no data");
        }
      } catch (err) {
        if (alive) {
          setProfile(null);
          setProfileError(
            err instanceof Error ? err.message : "network error",
          );
        }
      } finally {
        if (alive) setLoadingProfile(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    if (!q) return players.slice(0, 60);
    return players
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [players, query]);

  return (
    <main className="container container-wide v4-theme pv-theme analysis-tee-shots-shell">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          // No maxWidth — fill the shell's middle grid track edge-to-edge.
          // Padding is a small proportional gutter so the content
          // sits ~24-32px inside the nav rail with no dead band.
          padding: "20px 4px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: "oklch(0.5 0.02 150)",
            margin: "0 0 6px",
          }}
        >
          <Link
            href="/analysis"
            style={{ color: "oklch(0.5 0.02 150)", textDecoration: "none" }}
          >
            ← All analyses
          </Link>
        </p>
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          Off-the-tee shot shape
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          Every driver-off-the-tee ball flight from the last two seasons of
          PGA Tour events. Pick a player to see their average shape — height,
          launch angles, spin, curve — and the closest matches in the field.
        </p>

        {!players ? (
          <p style={{ marginTop: 20 }}>Loading players…</p>
        ) : players.length === 0 ? (
          <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
            No tee-shot data yet. Run{" "}
            <code
              style={{
                fontFamily:
                  "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
                fontSize: 12,
                background: "oklch(0.94 0.008 95)",
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              node scripts/backfill-tee-shots.mjs
            </code>{" "}
            to populate the archive.
          </p>
        ) : (
          <div className="ts-shell" style={{ marginTop: 20 }}>
            <aside className="ts-picker">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search player…"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  border: "1px solid oklch(0.85 0.013 95)",
                  borderRadius: 6,
                  boxSizing: "border-box",
                }}
              />
              <ul className="ts-picker-list">

                {filtered.map((p) => {
                  const active = p.playerId === selected;
                  return (
                    <li key={p.playerId}>
                      <button
                        type="button"
                        onClick={() => setSelected(p.playerId)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          fontSize: 13,
                          fontFamily: "inherit",
                          textAlign: "left",
                          background: active
                            ? "oklch(0.25 0.02 150)"
                            : "transparent",
                          color: active ? "white" : "oklch(0.25 0.02 150)",
                          border: "none",
                          borderBottom: "1px solid oklch(0.94 0.008 95)",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {p.name}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: active
                              ? "oklch(0.85 0.02 150)"
                              : "oklch(0.55 0.02 150)",
                            fontFamily:
                              "var(--font-plex-mono), 'IBM Plex Mono', ui-monospace, monospace",
                            flexShrink: 0,
                          }}
                        >
                          {p.shotCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li
                    style={{
                      padding: 10,
                      fontSize: 12,
                      color: "oklch(0.55 0.02 150)",
                    }}
                  >
                    No matches
                  </li>
                )}
              </ul>
            </aside>
            <div className="ts-content">
              {loadingProfile ? (
                <p>Loading profile…</p>
              ) : profileError ? (
                <p style={{ color: "oklch(0.5 0.16 25)" }}>
                  Couldn&apos;t load: {profileError}
                </p>
              ) : profile ? (
                <ProfileVisuals profile={profile} />
              ) : (
                <p style={{ color: "oklch(0.55 0.02 150)" }}>
                  Pick a player.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
