"use client";

/**
 * Last-N-starts sparkline + trend arrow + (optional) finish list.
 *
 * Two display modes:
 *   "compact" — small inline bars + trend arrow only. Fits on a
 *               leaderboard row or bet card next to the player name.
 *   "full"    — bars + arrow + textual finish list (T8 · MC · T22).
 *               Used on the player page and bet-placement screen
 *               where there's room for context.
 *
 * Each bar's height is the inverse of finish position (better finish
 * = taller bar) clamped to the field. CUT/MC = 1px stump bar so the
 * gap reads visually as "missed cut" rather than "no event".
 */

export interface RecentEvent {
  season: number;
  tournament: string;
  finishText: string;
  finishPos: number | null;
  madeCut: boolean;
}

interface Props {
  recent: RecentEvent[];
  trend?: "up" | "down" | "flat";
  mode?: "compact" | "full";
  /** Show the textual finish list below the bars in `full` mode. */
  showList?: boolean;
}

const MAX_BARS = 8;

function barHeightPct(e: RecentEvent): number {
  if (!e.madeCut) return 8; // stump for MC / CUT
  const pos = e.finishPos ?? 80;
  // 1st = 100%, T10 ≈ 85%, T30 ≈ 60%, T60 ≈ 30%, MC stump
  if (pos <= 1) return 100;
  if (pos <= 5) return 90;
  if (pos <= 10) return 80;
  if (pos <= 20) return 65;
  if (pos <= 30) return 55;
  if (pos <= 50) return 40;
  if (pos <= 80) return 25;
  return 15;
}

function barColor(e: RecentEvent): string {
  if (!e.madeCut) return "var(--spark-mc, #b94b4b)";
  const pos = e.finishPos ?? 80;
  if (pos <= 5) return "var(--spark-elite, #2f8d3f)";
  if (pos <= 20) return "var(--spark-good, #7bae3f)";
  if (pos <= 50) return "var(--spark-mid, #b8b25b)";
  return "var(--spark-weak, #c97a2a)";
}

export default function RecentFormSparkline({
  recent,
  trend = "flat",
  mode = "compact",
  showList = false,
}: Props) {
  if (!recent || recent.length === 0) return null;
  // Pad with placeholder bars on the left when the player has fewer
  // than MAX_BARS starts so the sparkline always reads as fixed-width.
  const bars = recent.slice(0, MAX_BARS).reverse(); // oldest first → newest last
  const arrow =
    trend === "up" ? "↗" : trend === "down" ? "↘" : "→";
  const arrowCls =
    trend === "up"
      ? "spark-arrow-up"
      : trend === "down"
        ? "spark-arrow-down"
        : "spark-arrow-flat";

  return (
    <div className={`recent-form recent-form-${mode}`}>
      <div className="recent-form-bars" aria-hidden="true">
        {bars.map((e, i) => (
          <span
            key={i}
            className="recent-form-bar"
            style={{
              height: `${barHeightPct(e)}%`,
              background: barColor(e),
            }}
            title={`${e.tournament}: ${e.finishText}`}
          />
        ))}
      </div>
      <span className={`recent-form-arrow ${arrowCls}`} aria-hidden="true">
        {arrow}
      </span>
      {mode === "full" && showList && (
        <span className="recent-form-list">
          {recent
            .slice(0, 5)
            .map((e) => e.finishText)
            .reverse()
            .join(" · ")}
        </span>
      )}
    </div>
  );
}
