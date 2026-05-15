import type { RecentHole } from "@/lib/feed/recent-holes";

interface Props {
  holes: RecentHole[];
}

function resultClass(result: RecentHole["result"]): string {
  if (result === "eagle" || result === "albatross") return "rhole-eagle";
  if (result === "birdie") return "rhole-birdie";
  if (result === "bogey") return "rhole-bogey";
  if (result === "double" || result === "triple-plus") return "rhole-double";
  return "rhole-par";
}

function toParTag(score: number, par: number): string {
  const d = score - par;
  if (d === 0) return "E";
  if (d > 0) return `+${d}`;
  return `${d}`;
}

export default function RecentHoles({ holes }: Props) {
  if (holes.length === 0) return null;
  return (
    <section className="pcard-section">
      <h3 className="fantasy-section-title">Recent holes</h3>
      <ul className="rhole-list">
        {holes.map((h) => (
          <li key={`${h.round}-${h.holeNumber}`} className={`rhole ${resultClass(h.result)}`}>
            <span className="rhole-hole">
              <span className="rhole-num">{h.holeNumber}</span>
              <span className="rhole-par">par {h.par}</span>
            </span>
            <span className="rhole-body">
              <span className="rhole-emoji" aria-hidden="true">{h.emoji}</span>
              <span className="rhole-text">{h.synopsis}</span>
            </span>
            <span className="rhole-score">
              <strong>{h.score}</strong>
              <span className="rhole-topar">{toParTag(h.score, h.par)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
