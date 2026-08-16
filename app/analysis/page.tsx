import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
import CoursePinPreview from "./_previews/CoursePinPreview";
import TeeTimePreview from "./_previews/TeeTimePreview";
import TeeShotPreview from "./_previews/TeeShotPreview";
import ScoreForecastPreview from "./_previews/ScoreForecastPreview";
import CourseHistoryPreview from "./_previews/CourseHistoryPreview";
import OddsComparePreview from "./_previews/OddsComparePreview";

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
    href: "/analysis/score-forecast",
    title: "Round score forecast",
    blurb:
      "Project field and per-player round scores. HRRR wind, level shift, persistence-weighted form.",
    status: "live",
    Preview: ScoreForecastPreview,
  },
  {
    href: "/analysis/course-history",
    title: "Course history",
    blurb:
      "Ballstriking course fit for every PGA event since 2019. Ranked by outperformance vs each player's season SG:OTT+APP baseline.",
    status: "live",
    Preview: CourseHistoryPreview,
  },
  {
    href: "/analysis/course-heatmap",
    title: "Course & pin guide",
    blurb:
      "Every green at a glance with this week's four pin positions. Putt paths and per-round scoring on tap.",
    status: "live",
    Preview: CoursePinPreview,
  },
  {
    href: "/analysis/tee-time-scoring",
    title: "Tee time vs skill-adjusted score",
    blurb:
      "See which waves had it easier — round score minus pre-tournament skill, plotted against tee time.",
    status: "live",
    Preview: TeeTimePreview,
  },
  {
    href: "/analysis/tee-shots",
    title: "Off-the-tee shot shape",
    blurb:
      "Every player's driver ball flight — average shape, dispersion cloud, closest matches in the field.",
    status: "live",
    Preview: TeeShotPreview,
  },
  {
    href: "/analysis/odds-compare",
    title: "Round-score odds compare",
    blurb:
      "Live over/under pricing on this week's field, side-by-side across the books that post it. Best price per side is highlighted.",
    status: "live",
    Preview: OddsComparePreview,
  },
];

export default function AnalysisIndex() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      {/*
        On mobile the top ribbon collapses to just the AuthChip (the
        wordmark + nav tabs are hidden by v4-theme). That leaves an
        empty white strip with a floating Sign in pill — pure vertical
        waste when there's already a bottom nav. Hide it under the
        phone breakpoint.

        Also caps each tool card's preview height on mobile — the
        illustrations were eating ~200px per card and making the list
        scroll forever. Smaller previews + tighter card padding keeps
        four tools legible in one thumb-flick.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 767px) {
              body header.brand.brand-split { display: none !important; }
              .pv-tool-card-preview {
                max-height: 130px !important;
                overflow: hidden;
              }
              .pv-tool-card-body {
                padding: 14px 16px 16px !important;
              }
              .pv-tool-card-body h3 { font-size: 16.5px !important; }
              .pv-tool-card-body p { font-size: 13.5px !important; }
              .pv-tools-intro { font-size: 13.5px !important; margin-bottom: 16px !important; }
              .pv-tools-heading { font-size: 22px !important; }
            }
          `,
        }}
      />
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
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <h2
          className="pv-tools-heading"
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
          className="pv-tools-intro"
          style={{
            fontSize: 14,
            color: "oklch(0.5 0.02 150)",
            margin: "0 0 22px",
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
            lineHeight: 1.5,
          }}
        >
          Deep-dive views on how a tournament&apos;s playing. Numbers-
          heavy; refreshes as rounds complete.
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 14,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(400px, 100%), 1fr))",
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
                <div className="pv-tool-card-preview">
                  <Preview />
                </div>
                <div
                  className="pv-tool-card-body"
                  style={{ padding: "20px 20px 22px" }}
                >
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
