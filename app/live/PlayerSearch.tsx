"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CachedLeaderboardRow } from "@/lib/feed/store";

interface Props {
  players: CachedLeaderboardRow[];
}

/**
 * Normalise for fuzzy matching: lowercase, strip accents, collapse
 * whitespace. So a typed "garcia" matches "García".
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function totalDisplay(total: string): string {
  if (!total || total === "E") return "E";
  if (total.startsWith("-") || total.startsWith("+")) return total;
  return `+${total}`;
}

export default function PlayerSearch({ players }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside-click + Escape.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const results = useMemo(() => {
    const needle = norm(q);
    if (needle.length === 0) {
      // Show a useful default when the user just opens the box: the
      // leaders + a hint about typing.
      return players.slice(0, 8);
    }
    // Two-pass: exact prefix matches first, then substring matches.
    const prefix: CachedLeaderboardRow[] = [];
    const contains: CachedLeaderboardRow[] = [];
    for (const p of players) {
      const n = norm(p.displayName);
      if (n.startsWith(needle)) prefix.push(p);
      else if (n.includes(needle)) contains.push(p);
    }
    return [...prefix, ...contains].slice(0, 12);
  }, [q, players]);

  return (
    <div ref={wrapRef} className="psearch">
      <input
        ref={inputRef}
        type="text"
        className="psearch-input"
        placeholder="Search a player…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search for a player"
      />
      {open && results.length > 0 && (
        <ul className="psearch-list">
          {results.map((p) => (
            <li key={p.playerId}>
              <Link
                href={`/live/player/${p.playerId}`}
                className="psearch-row"
                onClick={() => {
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="psearch-pos">{p.position || "–"}</span>
                <span className="psearch-name">{p.displayName}</span>
                <span className="psearch-total">
                  {p.playerState === "CUT"
                    ? "CUT"
                    : totalDisplay(p.total)}
                </span>
                <span className="psearch-thru">
                  {p.thru ? p.thru : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && q.length > 0 && results.length === 0 && (
        <p className="psearch-empty">No player matches “{q}”.</p>
      )}
    </div>
  );
}
