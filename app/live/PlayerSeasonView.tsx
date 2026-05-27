/**
 * PlayerSeasonView — per-player season summary + recent form +
 * round-by-round table. Built from the JSON datasets the GitHub
 * Action keeps fresh; no live API hits. Renders the same content
 * the off-week /players/[id] page used to render inline; shared
 * with /live/player/[id] so every player click lands on a useful
 * page regardless of whether a tournament is currently on.
 *
 * Server component — no interactivity, just data display.
 */

import type { RecentForm } from "@/lib/feed/recent-form";
import type { SeasonRoundsEntry } from "@/lib/feed/season-rounds";

interface Props {
  entry: SeasonRoundsEntry;
  recentForm: RecentForm | null;
  /** Optional heading shown above the section — defaults to no
   *  heading so the caller can label it however they want. */
  heading?: string;
}

function fmtSg(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v * 100) / 100;
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}`;
}

function fmtDate(d: string): string {
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mi = Number(parts[1]) - 1;
  if (mi < 0 || mi > 11) return d;
  return `${parts[2]} ${months[mi]}`;
}

export default function PlayerSeasonView({
  entry,
  recentForm,
  heading,
}: Props) {
  const rounds = entry.rounds;
  const events = new Set(rounds.map((r) => r.eventId));
  const eagles = rounds.reduce((s, r) => s + r.eagles, 0);
  const sub67 = rounds.filter((r) => r.score > 0 && r.score < 67).length;
  const red = rounds.filter((r) => r.vsPar < 0).length;
  const totalSg = rounds.reduce((s, r) => s + (r.sgTotal ?? 0), 0);
  const avgSg = rounds.length > 0 ? totalSg / rounds.length : 0;

  return (
    <section className="player-season">
      {heading && <h3 className="fantasy-section-title">{heading}</h3>}
      <p className="player-season-sub">
        {events.size} starts · {rounds.length} rounds · 2026 season
      </p>

      <div className="player-season-grid">
        <Stat
          label="Avg SG / round"
          value={fmtSg(avgSg)}
          tone={avgSg >= 0.1 ? "up" : avgSg <= -0.1 ? "down" : "none"}
        />
        <Stat
          label="Sub-67 rounds"
          value={String(sub67)}
          tone={sub67 >= 3 ? "up" : "none"}
        />
        <Stat
          label="Rounds in red"
          value={String(red)}
          tone={red >= rounds.length / 2 ? "up" : "none"}
        />
        <Stat
          label="Eagles"
          value={String(eagles)}
          tone={eagles >= 2 ? "up" : "none"}
        />
      </div>

      {recentForm && recentForm.recent.length > 0 && (
        <>
          <h3 className="player-season-section">Recent form</h3>
          <ul className="player-season-form">
            {recentForm.recent.map((r, i) => (
              <li
                key={`${r.season}-${r.tournament}-${i}`}
                className={`player-season-form-row ${r.madeCut ? "" : "player-season-form-missed"}`}
              >
                <span className="player-season-form-finish">
                  {r.finishText}
                </span>
                <span className="player-season-form-tournament">
                  {r.tournament}
                </span>
                <span className="player-season-form-season">{r.season}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="player-season-section">Round-by-round</h3>
      <ul className="player-season-rounds">
        {rounds.map((r, i) => (
          <li
            key={`${r.eventId}-${r.round}-${i}`}
            className="player-season-round"
          >
            <div className="player-season-round-head">
              <span className="player-season-round-date">
                {fmtDate(r.date)}
              </span>
              <span className="player-season-round-tournament">
                {r.tournament}
              </span>
              <span className="player-season-round-tag">R{r.round}</span>
            </div>
            <div className="player-season-round-stats">
              <span
                className={`player-season-round-score ${
                  r.vsPar < 0
                    ? "player-season-round-score-up"
                    : r.vsPar > 0
                      ? "player-season-round-score-down"
                      : ""
                }`}
              >
                {r.score} ({r.vsPar >= 0 ? "+" : ""}
                {r.vsPar})
              </span>
              {r.eagles > 0 && (
                <span className="player-season-round-chip" title="Eagles">
                  🦅 {r.eagles}
                </span>
              )}
              {r.birdies > 0 && (
                <span className="player-season-round-chip" title="Birdies">
                  🐦 {r.birdies}
                </span>
              )}
              {r.doubles > 0 && (
                <span
                  className="player-season-round-chip"
                  title="Doubles or worse"
                >
                  💥 {r.doubles}
                </span>
              )}
              <span className="player-season-round-sg">
                {fmtSg(r.sgTotal)} SG
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "none";
}) {
  return (
    <div className="player-season-stat">
      <div
        className={`player-season-stat-num${
          tone === "up"
            ? " player-season-stat-up"
            : tone === "down"
              ? " player-season-stat-down"
              : ""
        }`}
      >
        {value}
      </div>
      <div className="player-season-stat-lbl">{label}</div>
    </div>
  );
}
