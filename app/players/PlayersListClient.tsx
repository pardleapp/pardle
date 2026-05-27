"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface PlayerSummary {
  key: string;
  name: string;
  starts: number;
  rounds: number;
  eagles: number;
  sub67: number;
  red: number;
  avgSg: number;
  lastEvent: string | null;
  lastDate: string | null;
}

type SortKey = "active" | "name" | "sg" | "eagles";

interface Props {
  players: PlayerSummary[];
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function fmtSg(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}`;
}

export default function PlayersListClient({ players }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("active");

  const filtered = useMemo(() => {
    const q = normalise(query.trim());
    const subset = q
      ? players.filter((p) => normalise(p.name).includes(q))
      : players;
    const out = [...subset];
    if (sort === "name") {
      out.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "sg") {
      out.sort((a, b) => b.avgSg - a.avgSg);
    } else if (sort === "eagles") {
      out.sort((a, b) => b.eagles - a.eagles);
    }
    return out;
  }, [players, query, sort]);

  return (
    <section className="players-page">
      <div className="players-page-head">
        <h2 className="players-page-title">PGA Tour players</h2>
        <p className="players-page-sub">
          {players.length} players · 2026 season data
        </p>
      </div>

      <div className="players-controls">
        <input
          className="players-search"
          type="search"
          placeholder="Search a player…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
        <div className="players-sort" role="tablist" aria-label="Sort players">
          {(
            [
              { k: "active", label: "Most active" },
              { k: "sg", label: "Best SG" },
              { k: "eagles", label: "Most eagles" },
              { k: "name", label: "A → Z" },
            ] as const
          ).map((s) => (
            <button
              key={s.k}
              type="button"
              role="tab"
              aria-selected={sort === s.k}
              className={`players-sort-btn${sort === s.k ? " players-sort-btn-on" : ""}`}
              onClick={() => setSort(s.k)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="feed-empty" style={{ padding: 24 }}>
          No players match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <ul className="players-list">
          {filtered.map((p) => (
            <li key={p.key}>
              <Link href={`/players/${p.key}`} className="players-row">
                <span className="players-row-name">{p.name}</span>
                <span className="players-row-stats">
                  <span
                    className={`players-row-sg ${
                      p.avgSg > 0.1
                        ? "players-row-sg-up"
                        : p.avgSg < -0.1
                          ? "players-row-sg-down"
                          : ""
                    }`}
                    title="Avg strokes-gained total per round this season"
                  >
                    {fmtSg(p.avgSg)} SG
                  </span>
                  <span className="players-row-meta">
                    {p.starts} starts · {p.eagles} eagles · {p.red} red rounds
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
