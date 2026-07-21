"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { PlayerDrivingProfile } from "@/lib/feed/tee-shots-profile";
import ProfileVisuals, { COMPARE_COLORS } from "./ProfileVisuals";

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

const MAX_COMPARE = 4;

export default function Page() {
  const [players, setPlayers] = useState<RankedPlayer[] | null>(null);
  const [query, setQuery] = useState("");
  // Ordered list of selected player IDs. Index 0 is the "primary"
  // (drives stats card, similar list, scatter). Additional entries
  // only overlay their arcs on the ball-flight card.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [profiles, setProfiles] = useState<PlayerDrivingProfile[]>([]);
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
          if (json.players[0]) {
            setSelectedIds([json.players[0].playerId]);
          }
        }
      } catch {
        // ignored — surfaces as "no data yet"
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fetch every selected player's profile in parallel whenever the
  // selection list changes. Results preserve the selection order so
  // the primary player stays at index 0.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setProfiles([]);
      return;
    }
    let alive = true;
    setLoadingProfile(true);
    setProfileError(null);
    (async () => {
      try {
        const results = await Promise.all(
          selectedIds.map((id) =>
            fetch(
              `/api/tee-shot-profile?playerId=${encodeURIComponent(id)}`,
              { cache: "no-store" },
            )
              .then((r) => r.json() as Promise<ProfileResp>)
              .catch(() => ({ ok: false }) as ProfileResp),
          ),
        );
        if (!alive) return;
        const loaded = results
          .map((r) => (r.ok && r.profile ? r.profile : null))
          .filter((p): p is PlayerDrivingProfile => p != null);
        if (loaded.length === 0) {
          setProfiles([]);
          setProfileError("no data");
        } else {
          setProfiles(loaded);
        }
      } catch (err) {
        if (alive) {
          setProfiles([]);
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
  }, [selectedIds]);

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = query.trim().toLowerCase();
    // Default view: every player with a big-enough sample to trust
    // their radar profile. Search view: broader — any match, even
    // low-sample players, because the user has typed a name.
    const MIN_SHOTS = 100;
    if (!q) return players.filter((p) => p.shotCount >= MIN_SHOTS);
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, query]);

  const onPickPlayer = useCallback(
    (playerId: string) => {
      setSelectedIds((prev) => {
        if (!compareMode) {
          return prev[0] === playerId ? prev : [playerId];
        }
        // Compare mode — toggle inclusion (respecting the cap).
        if (prev.includes(playerId)) {
          const next = prev.filter((id) => id !== playerId);
          // Never leave the selection empty; fall back to the
          // deselected player as primary if it was the last one.
          return next.length > 0 ? next : [playerId];
        }
        if (prev.length >= MAX_COMPARE) return prev;
        return [...prev, playerId];
      });
    },
    [compareMode],
  );

  const onToggleCompare = useCallback(() => {
    setCompareMode((prev) => {
      const next = !prev;
      // Leaving compare mode drops back to the primary player.
      if (!next) {
        setSelectedIds((ids) => (ids.length > 1 ? [ids[0]] : ids));
      }
      return next;
    });
  }, []);

  const selectionIndex = useMemo(() => {
    const map = new Map<string, number>();
    selectedIds.forEach((id, i) => map.set(id, i));
    return map;
  }, [selectedIds]);

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
          PGA Tour events. Pick a player to see their average shape — or turn
          on Compare to overlay up to {MAX_COMPARE} players&apos; flight paths.
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
              <button
                type="button"
                onClick={onToggleCompare}
                aria-pressed={compareMode}
                style={{
                  width: "100%",
                  marginTop: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  border: "1px solid oklch(0.85 0.013 95)",
                  borderRadius: 6,
                  background: compareMode
                    ? "oklch(0.25 0.02 150)"
                    : "white",
                  color: compareMode ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
                title={
                  compareMode
                    ? "Compare on — click players to add/remove"
                    : "Compare off — click to pick multiple players"
                }
              >
                <span>
                  Compare{" "}
                  {compareMode && selectedIds.length > 1
                    ? `· ${selectedIds.length}/${MAX_COMPARE}`
                    : ""}
                </span>
                <span
                  style={{
                    width: 22,
                    height: 12,
                    background: compareMode ? "white" : "oklch(0.88 0.013 95)",
                    borderRadius: 999,
                    position: "relative",
                    transition: "background 100ms",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 1,
                      left: compareMode ? 11 : 1,
                      width: 10,
                      height: 10,
                      background: compareMode
                        ? "oklch(0.25 0.02 150)"
                        : "white",
                      border: "1px solid oklch(0.7 0.013 95)",
                      borderRadius: 999,
                      transition: "left 100ms",
                    }}
                  />
                </span>
              </button>
              <ul className="ts-picker-list">
                {filtered.map((p) => {
                  const selIdx = selectionIndex.get(p.playerId);
                  const active = selIdx != null;
                  const isPrimary = selIdx === 0;
                  const color =
                    selIdx != null
                      ? COMPARE_COLORS[selIdx % COMPARE_COLORS.length]
                      : null;
                  return (
                    <li key={p.playerId}>
                      <button
                        type="button"
                        onClick={() => onPickPlayer(p.playerId)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          fontSize: 13,
                          fontFamily: "inherit",
                          textAlign: "left",
                          background: isPrimary
                            ? "oklch(0.25 0.02 150)"
                            : active
                              ? "oklch(0.96 0.008 95)"
                              : "transparent",
                          color: isPrimary
                            ? "white"
                            : "oklch(0.25 0.02 150)",
                          border: "none",
                          borderBottom:
                            "1px solid oklch(0.94 0.008 95)",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              flexShrink: 0,
                              background: color ?? "transparent",
                              border: color
                                ? "none"
                                : "1px solid oklch(0.85 0.013 95)",
                            }}
                          />
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p.name}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: isPrimary
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
              {loadingProfile && profiles.length === 0 ? (
                <p>Loading profile…</p>
              ) : profileError && profiles.length === 0 ? (
                <p style={{ color: "oklch(0.5 0.16 25)" }}>
                  Couldn&apos;t load: {profileError}
                </p>
              ) : profiles.length > 0 ? (
                <ProfileVisuals profiles={profiles} />
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
