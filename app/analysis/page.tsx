import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import CoursePinPreview from "./_previews/CoursePinPreview";
import TeeTimePreview from "./_previews/TeeTimePreview";
import TeeShotPreview from "./_previews/TeeShotPreview";

export const metadata = {
  title: `Tools — ${BRAND.name}`,
  description:
    "Deep-dive analytical views — course conditions, tee-time effects, skill-adjusted performance.",
};

export const dynamic = "force-dynamic";

interface Card {
  href: string;
  title: string;
  blurb: string;
  status: "live" | "coming-soon";
  Preview: React.ComponentType;
}

const CARDS: Card[] = [
  {
    href: "/analysis/course-heatmap",
    title: "Course & pin guide",
    blurb:
      "Every green on the property at a glance — this week's four pin positions overlaid on each aerial. Click any card for putt paths, multi-season birdie history, and per-round scoring.",
    status: "live",
    Preview: CoursePinPreview,
  },
  {
    href: "/analysis/tee-time-scoring",
    title: "Tee time vs skill-adjusted score",
    blurb:
      "Scatter of every finisher's round score minus their pre-tournament skill projection, plotted against tee time. Toggle to a field-scoring heatmap by hole and hour to see which waves had it easier and which holes bit hardest.",
    status: "live",
    Preview: TeeTimePreview,
  },
  {
    href: "/analysis/tee-shots",
    title: "Off-the-tee shot shape",
    blurb:
      "Every driver-off-the-tee ball flight from the last two seasons. Pick a player to see their average shape, dispersion cloud, and the closest matches in the field ranked by radar profile.",
    status: "live",
    Preview: TeeShotPreview,
  },
];

export default function AnalysisIndex() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          maxWidth: 1280,
          margin: "20px 0",
          padding: "0 16px 60px",
        }}
      >
        <h2
          style={{
            fontSize: 24,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
            marginBottom: 6,
          }}
        >
          Tools
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "oklch(0.5 0.02 150)",
            margin: "0 0 22px",
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
            lineHeight: 1.5,
          }}
        >
          Deep-dive views on how a tournament&apos;s playing — who&apos;s
          out-performing their pre-round skill, how much conditions
          shifted across the day, etc. Numbers-heavy; refreshes as
          rounds complete.
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 18,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(400px, 1fr))",
          }}
        >
          {CARDS.map((card) => {
            const isLive = card.status === "live";
            const Preview = card.Preview;
            const CardEl = (
              <article
                style={{
                  border: "1px solid oklch(0.9 0.008 95)",
                  borderRadius: 10,
                  background: "white",
                  transition:
                    "border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease",
                  cursor: isLive ? "pointer" : "not-allowed",
                  opacity: isLive ? 1 : 0.55,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Preview />
                <div style={{ padding: "20px 20px 22px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 18,
                        margin: 0,
                        fontFamily:
                          "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                        letterSpacing: -0.005,
                        color: "oklch(0.22 0.03 155)",
                      }}
                    >
                      {card.title}
                    </h3>
                    {!isLive && (
                      <span
                        style={{
                          fontSize: 10,
                          letterSpacing: 0.6,
                          color: "oklch(0.55 0.02 150)",
                          padding: "2px 6px",
                          border: "1px solid oklch(0.85 0.013 95)",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        COMING SOON
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: 14.5,
                      color: "oklch(0.32 0.03 155)",
                      margin: 0,
                      lineHeight: 1.5,
                      fontFamily:
                        "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                    }}
                  >
                    {card.blurb}
                  </p>
                </div>
              </article>
            );
            return (
              <li key={card.href}>
                {isLive ? (
                  <Link
                    href={card.href}
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                      display: "block",
                    }}
                  >
                    {CardEl}
                  </Link>
                ) : (
                  CardEl
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
