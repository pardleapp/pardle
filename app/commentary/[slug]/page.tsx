import { notFound } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../../live/auth/AuthChip";
import MainNav from "../../MainNav";
import ArticleThreeMOpen from "./_articles/ArticleThreeMOpen";
import ArticlePinDifficulty from "./_articles/ArticlePinDifficulty";
import ArticleR2Preview from "./_articles/ArticleR2Preview";
import ArticleR2ScoringForecast from "./_articles/ArticleR2ScoringForecast";
import ArticleSchefflerR3Dynamics from "./_articles/ArticleSchefflerR3Dynamics";
import ArticleLebiodaBet from "./_articles/ArticleLebiodaBet";
import ArticleSixPercentRule from "./_articles/ArticleSixPercentRule";

interface Article {
  slug: string;
  title: string;
  dek: string;
  date: string;
  tag: string;
  Body: React.ComponentType;
}

const LEBIODA_ARTICLE: Article = {
  slug: "why-we-bet-£1149-on-hank-lebioda",
  title: "Why we bet £1,149 on Hank Lebioda",
  dek: "The market has him at 60%. Our model has him at 75%. That's the biggest edge we've seen this week — here's exactly how we got there.",
  date: "2026-07-26",
  tag: "R4 bet",
  Body: ArticleLebiodaBet,
};

const ARTICLES: Record<string, Article> = {
  "six-percent-rule": {
    slug: "six-percent-rule",
    title: "The six percent rule",
    dek: "Jeremy Paul is tied second at 11 under and rated 65th of the 70 players left. Across 14,575 player-events, almost none of a hot 36 holes carries into Saturday — which makes his round-3 line the biggest edge on the board.",
    date: "2026-09-05",
    tag: "R3 bet",
    Body: ArticleSixPercentRule,
  },
  "why-we-bet-£1149-on-hank-lebioda": LEBIODA_ARTICLE,
  // Legacy slug from initial publish — kept so any early share
  // link still resolves to the same article.
  "why-we-bet-1149-on-hank-lebioda": LEBIODA_ARTICLE,
  "3m-open-r3-scheffler-dynamics": {
    slug: "3m-open-r3-scheffler-dynamics",
    title: "Exploring Scheffler round score dynamics: 3M Open R3",
    dek: "Walking the full pricing exercise on Scheffler's over/under 66.5 — field mean, personal edge, course compression, and the mean-vs-median gap that decides where the fair line actually sits.",
    date: "2026-07-25",
    tag: "R3 pricing",
    Body: ArticleSchefflerR3Dynamics,
  },
  "3m-open-r2-scoring-forecast": {
    slug: "3m-open-r2-scoring-forecast",
    title: "3M Open R2: what the field averages today",
    dek: "Fitting eight years of pin-by-pin scoring to today's wind, then calibrating against yesterday's field average, points to a course playing softer than the wind suggests.",
    date: "2026-07-24",
    tag: "R2 forecast",
    Body: ArticleR2ScoringForecast,
  },
  "3m-open-r2-preview": {
    slug: "3m-open-r2-preview",
    title: "3M Open R2 preview: wind, hole bearings, and where the birdies live",
    dek: "Same wind direction as R1, roughly triple the speed. This is where the R2 pin sheet meets a 20 mph SSW — hole by hole, cluster by cluster.",
    date: "2026-07-24",
    tag: "R2 preview",
    Body: ArticleR2Preview,
  },
  "3m-open-pin-difficulty": {
    slug: "3m-open-pin-difficulty",
    title: "Where the birdies live: reading the 3M Open's pin patterns",
    dek: "Adjusting eight years of pin-by-pin birdie rates for hole length and wind reveals which flag positions at TPC Twin Cities play harder or easier than they look.",
    date: "2026-07-22",
    tag: "Pin analysis",
    Body: ArticlePinDifficulty,
  },
  "3m-open-course-fit": {
    slug: "3m-open-course-fit",
    title: "The 3M Open: what course-fit says about TPC Twin Cities",
    dek: "A ball-flight model that ranks courses by whether they reward bombers or plotters — and where this week lands.",
    date: "2026-07-21",
    tag: "Course fit",
    Body: ArticleThreeMOpen,
  },
};

interface Props {
  params: Promise<{ slug: string }>;
}

/** Look up an article by slug tolerantly. Browsers percent-encode
 *  non-ASCII (the `£` in the Lebioda slug becomes `%C2%A3`), and
 *  Next.js sometimes hands us the decoded form and sometimes the
 *  raw encoded form depending on how the URL entered the request.
 *  Try both. */
function findArticle(rawSlug: string): Article | undefined {
  if (ARTICLES[rawSlug]) return ARTICLES[rawSlug];
  try {
    const decoded = decodeURIComponent(rawSlug);
    if (ARTICLES[decoded]) return ARTICLES[decoded];
  } catch {
    /* malformed URI — fall through */
  }
  return undefined;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const a = findArticle(slug);
  if (!a) return { title: `Insights — ${BRAND.name}` };
  return {
    title: `${a.title} — ${BRAND.name}`,
    description: a.dek,
  };
}

export const dynamic = "force-dynamic";

export default async function CommentaryArticle({ params }: Props) {
  const { slug } = await params;
  const a = findArticle(slug);
  if (!a) notFound();
  const Body = a.Body;
  const dateStr = new Date(a.date + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="commentary" />
          <AuthChip />
        </div>
      </header>
      <article
        style={{
          maxWidth: 880,
          width: "100%",
          minWidth: 0,
          margin: "20px auto",
          padding: "0 16px 60px",
          boxSizing: "border-box",
        }}
      >
        <nav style={{ marginBottom: 14 }}>
          <Link
            href="/"
            style={{
              fontSize: 12,
              color: "oklch(0.50 0.13 155)",
              textDecoration: "none",
              fontWeight: 700,
              fontFamily:
                "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            }}
          >
            ← Insights
          </Link>
        </nav>
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}
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
            {dateStr}
          </span>
        </div>
        <h2
          style={{
            fontSize: 28,
            lineHeight: 1.2,
            margin: "0 0 10px",
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            letterSpacing: -0.01,
          }}
        >
          {a.title}
        </h2>
        <p
          style={{
            fontSize: 16,
            color: "oklch(0.4 0.02 150)",
            margin: "0 0 24px",
            lineHeight: 1.5,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, sans-serif",
          }}
        >
          {a.dek}
        </p>
        <Body />
      </article>
    </main>
  );
}
