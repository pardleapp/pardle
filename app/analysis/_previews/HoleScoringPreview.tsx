/**
 * HoleScoringPreview — a few rows of the setup table as the landing
 * card hero. Static by design: the point is to show the SHAPE of the
 * tool (length / pin / wind lining up against how the hole played),
 * not this week's live numbers, and a card that fetches would be four
 * requests for a thumbnail.
 *
 * Figures are real — East Lake R3 2025.
 */

const ROWS: Array<{
  hole: string;
  length: string;
  dLength: number;
  wind: string;
  windHard: number;
  played: string;
  playedHard: number;
}> = [
  { hole: "H1", length: "521", dLength: 1, wind: "into 7", windHard: 1, played: "+0.43", playedHard: 1 },
  { hole: "H5", length: "436", dLength: -1, wind: "down 7", windHard: -1, played: "−0.27", playedHard: -1 },
  { hole: "H9", length: "268", dLength: 1, wind: "down 6", windHard: -1, played: "+0.27", playedHard: 1 },
  { hole: "H15", length: "220", dLength: 1, wind: "cross 6", windHard: 0, played: "+0.57", playedHard: 1 },
];

function tone(v: number): { background: string; color: string } {
  if (v > 0)
    return { background: "oklch(0.90 0.08 25)", color: "oklch(0.34 0.15 25)" };
  if (v < 0)
    return { background: "oklch(0.91 0.08 150)", color: "oklch(0.30 0.12 150)" };
  return { background: "oklch(0.96 0.005 95)", color: "oklch(0.5 0.02 150)" };
}

const chip: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontWeight: 800,
  fontSize: 9,
  borderRadius: 4,
  padding: "2px 0",
  textAlign: "center",
};

export default function HoleScoringPreview() {
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "16/9",
        background: "oklch(0.975 0.006 95)",
        borderRadius: "10px 10px 0 0",
        overflow: "hidden",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr 1fr 1fr",
          gap: 4,
          fontFamily: "var(--font-archivo), Archivo, system-ui, sans-serif",
          fontSize: 7.5,
          fontWeight: 800,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "oklch(0.55 0.02 150)",
        }}
      >
        <span />
        <span style={{ textAlign: "center" }}>Length</span>
        <span style={{ textAlign: "center" }}>Wind</span>
        <span style={{ textAlign: "center" }}>Played</span>
      </div>
      {ROWS.map((r) => (
        <div
          key={r.hole}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 1fr 1fr 1fr",
            gap: 4,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontWeight: 800,
              fontSize: 9.5,
              color: "oklch(0.26 0.02 150)",
            }}
          >
            {r.hole}
          </span>
          <span style={{ ...chip, ...tone(r.dLength) }}>{r.length}</span>
          <span style={{ ...chip, ...tone(r.windHard) }}>{r.wind}</span>
          <span style={{ ...chip, ...tone(r.playedHard) }}>{r.played}</span>
        </div>
      ))}
    </div>
  );
}
