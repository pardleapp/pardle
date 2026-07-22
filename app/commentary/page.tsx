import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";

export const metadata = {
  title: `Commentary — ${BRAND.name}`,
  description:
    "Weekly analytical takes on the tournament ahead. Data-driven, brief, no filler.",
};

export const dynamic = "force-dynamic";

interface Article {
  slug: string;
  title: string;
  dek: string;
  date: string;    // ISO
  tag: string;
}

// Ordered newest-first. New articles land at the top of this array;
// each one gets its own page under app/commentary/[slug]/page.tsx.
const ARTICLES: Article[] = [
  {
    slug: "3m-open-pin-difficulty",
    title: "Where the birdies live: reading the 3M Open's pin patterns",
    dek: "Adjusting eight years of pin-by-pin birdie rates for hole length and wind reveals which flag positions at TPC Twin Cities play harder or easier than they look.",
    date: "2026-07-22",
    tag: "Pin analysis",
  },
  {
    slug: "3m-open-course-fit",
    title: "The 3M Open: what course-fit says about TPC Twin Cities",
    dek: "A ball-flight model that ranks courses by whether they reward bombers or plotters — and where this week lands.",
    date: "2026-07-21",
    tag: "Course fit",
  },
];

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function CommentaryIndex() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="commentary" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{ maxWidth: 1120, margin: "20px auto", padding: "0 16px 60px" }}
      >
        <h2
          style={{
            fontSize: 22,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            marginBottom: 4,
          }}
        >
          Commentary
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "oklch(0.5 0.02 150)",
            margin: "0 0 20px",
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, sans-serif",
          }}
        >
          Short, data-backed takes on the tournament ahead. Updated
          weekly. No hot air, no hedging.
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 12,
            gridTemplateColumns:
              "repeat(auto-fill, minmax(340px, 1fr))",
          }}
        >
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/commentary/${a.slug}`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <article
                  style={{
                    padding: 16,
                    border: "1px solid oklch(0.9 0.008 95)",
                    borderRadius: 10,
                    background: "white",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: "oklch(0.50 0.13 155)",
                        textTransform: "uppercase",
                        fontWeight: 800,
                        fontFamily:
                          "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                      }}
                    >
                      {a.tag}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "oklch(0.55 0.02 150)",
                        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      }}
                    >
                      {formatDate(a.date)}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontSize: 17,
                      margin: "0 0 6px",
                      lineHeight: 1.25,
                      fontFamily:
                        "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                    }}
                  >
                    {a.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: "oklch(0.4 0.02 150)",
                      margin: 0,
                      lineHeight: 1.45,
                    }}
                  >
                    {a.dek}
                  </p>
                </article>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
