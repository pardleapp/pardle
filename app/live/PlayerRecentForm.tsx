/**
 * Recent-form panel on the player page. Bigger than the inline
 * sparkline used on leaderboard rows + bet cards — shows the same
 * bars plus the full text list of last 5 starts.
 *
 * Each row is a Link into /live/player/[id]/t/[year]/[eventId] when
 * we can resolve a DataGolf event_id for the tournament — i.e. the
 * row drills down into the player's per-round detail at that event.
 *
 * Server component (no client state) — receives the player's recent
 * events as a prop, rendered as a card-style section like the other
 * pcard-* blocks on the page.
 */

import Link from "next/link";
import RecentFormSparkline, {
  type RecentEvent,
} from "./RecentFormSparkline";

function trendFor(recent: RecentEvent[]): "up" | "down" | "flat" {
  if (recent.length < 5) return "flat";
  const scoreOf = (e: RecentEvent) =>
    e.finishPos ?? (e.madeCut ? 80 : 90);
  const newer = (scoreOf(recent[0]) + scoreOf(recent[1]) + scoreOf(recent[2])) / 3;
  const older = (scoreOf(recent[3]) + scoreOf(recent[4])) / 2;
  const diff = older - newer;
  if (diff > 8) return "up";
  if (diff < -8) return "down";
  return "flat";
}

const TREND_COPY = {
  up: "Trending up",
  down: "Drifting",
  flat: "Steady",
};

export default function PlayerRecentForm({
  recent,
  playerId,
  playerName,
  eventIdMap,
}: {
  recent: RecentEvent[];
  /** Orchestrator playerId — used to build the drill-down URL so the
   *  back button returns to this player's page. */
  playerId: string;
  /** Display name — passed in the URL as `?name=` so the drill-down
   *  page can match the right row in the DataGolf payload. */
  playerName: string;
  /** Lookup of (year + tournament) → { eventId, year } so we can
   *  render clickable rows. Sparse: rows with no match render as
   *  plain text. Built server-side from the DG event-list cache. */
  eventIdMap: Record<string, { eventId: number; year: number }>;
}) {
  if (recent.length === 0) return null;
  const trend = trendFor(recent);
  return (
    <section className="pcard-section pcard-form">
      <div className="pcard-form-head">
        <p className="pcard-section-title">Recent form</p>
        <span className={`pcard-form-trend pcard-form-trend-${trend}`}>
          {TREND_COPY[trend]}
        </span>
      </div>
      <div className="pcard-form-spark">
        <RecentFormSparkline recent={recent} trend={trend} mode="full" />
      </div>
      <ul className="pcard-form-list">
        {recent.slice(0, 5).map((e, i) => {
          const lookup = eventIdMap[`${e.season}|${e.tournament}`];
          const inner = (
            <>
              <span
                className={`pcard-form-finish ${
                  e.madeCut ? "" : "pcard-form-finish-mc"
                }`}
              >
                {e.finishText}
              </span>
              <span className="pcard-form-tournament">{e.tournament}</span>
              <span className="pcard-form-season">{e.season}</span>
            </>
          );
          if (lookup) {
            return (
              <li key={i} className="pcard-form-row pcard-form-row-link">
                <Link
                  href={`/live/player/${playerId}/t/${lookup.year}/${lookup.eventId}?name=${encodeURIComponent(playerName)}`}
                  className="pcard-form-row-anchor"
                >
                  {inner}
                </Link>
              </li>
            );
          }
          return (
            <li key={i} className="pcard-form-row">
              {inner}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
