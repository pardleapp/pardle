import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";

export const metadata = {
  title: `Analysis — ${BRAND.name}`,
  description:
    "Deep-dive analytical views — course conditions, tee-time effects, skill-adjusted performance.",
};

export const dynamic = "force-dynamic";

interface Card {
  href: string;
  title: string;
  blurb: string;
  status: "live" | "coming-soon";
}

const CARDS: Card[] = [
  {
    href: "/analysis/tee-time-scoring",
    title: "Tee time vs skill-adjusted score",
    blurb:
      "Scatter of every finisher's round score minus their pre-tournament skill projection, plotted against tee time. Trend line reveals whether one wave had it easier.",
    status: "live",
  },
  {
    href: "/analysis/course-heatmap",
    title: "Course & pin guide",
    blurb:
      "Field scoring vs par per hole per hour, per-round summary, weather, and click into any hole for that week's pin positions on the green with the field's putt paths layered on top.",
    status: "live",
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
          maxWidth: 900,
          margin: "20px auto",
          padding: "0 16px 60px",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
            marginBottom: 4,
          }}
        >
          Analysis
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "oklch(0.5 0.02 150)",
            margin: "0 0 20px",
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
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
            gap: 12,
          }}
        >
          {CARDS.map((card) => {
            const isLive = card.status === "live";
            const CardEl = (
              <div
                style={{
                  padding: 16,
                  border: "1px solid oklch(0.9 0.008 95)",
                  borderRadius: 10,
                  background: "white",
                  transition: "border-color 0.15s ease",
                  cursor: isLive ? "pointer" : "not-allowed",
                  opacity: isLive ? 1 : 0.55,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <h3
                    style={{
                      fontSize: 15,
                      margin: 0,
                      fontFamily:
                        "var(--font-archivo), 'Archivo', system-ui, sans-serif",
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
                    fontSize: 13,
                    color: "oklch(0.4 0.02 150)",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {card.blurb}
                </p>
              </div>
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
