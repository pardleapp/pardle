import { notFound } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../../live/auth/AuthChip";
import MainNav from "../../MainNav";
import ArticleThreeMOpen from "./_articles/ArticleThreeMOpen";
import ArticlePinDifficulty from "./_articles/ArticlePinDifficulty";

interface Article {
  slug: string;
  title: string;
  dek: string;
  date: string;
  tag: string;
  Body: React.ComponentType;
}

const ARTICLES: Record<string, Article> = {
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

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const a = ARTICLES[slug];
  if (!a) return { title: `Commentary — ${BRAND.name}` };
  return {
    title: `${a.title} — ${BRAND.name}`,
    description: a.dek,
  };
}

export const dynamic = "force-dynamic";

export default async function CommentaryArticle({ params }: Props) {
  const { slug } = await params;
  const a = ARTICLES[slug];
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
        style={{ maxWidth: 720, margin: "20px auto", padding: "0 16px 60px" }}
      >
        <nav style={{ marginBottom: 14 }}>
          <Link
            href="/commentary"
            style={{
              fontSize: 12,
              color: "oklch(0.50 0.13 155)",
              textDecoration: "none",
              fontWeight: 700,
              fontFamily:
                "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            }}
          >
            ← Commentary
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
