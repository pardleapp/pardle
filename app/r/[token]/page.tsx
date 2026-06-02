import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import {
  cellColorFor,
  decodeShareCard,
  shareGameAccent,
  shareGameTitle,
} from "@/lib/share-card";

interface Params {
  params: Promise<{ token: string }>;
}

// Metadata is generated per token so the page's <meta og:image> points
// at our dynamic opengraph-image.tsx — chat apps (WhatsApp, iMessage,
// Twitter) will unfurl that PNG when the share URL is pasted.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const payload = decodeShareCard(token);
  if (!payload) {
    return {
      title: `${BRAND.name} — play today's golf puzzles`,
      description: "Daily golf puzzles. Beat your friends.",
    };
  }
  const game = shareGameTitle(payload.g);
  const title = `${BRAND.name}: ${game} #${payload.d} — ${payload.s}`;
  const description = `Beat me at today's ${BRAND.name}: ${game}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BRAND.url}/r/${token}`,
      siteName: BRAND.name,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ShareLandingPage({ params }: Params) {
  const { token } = await params;
  const payload = decodeShareCard(token);
  if (!payload) {
    // Bad / forged token — just show the hub.
    return (
      <main className="container share-landing pv-theme">
        <h1>{BRAND.name}</h1>
        <p>This share link couldn&apos;t be read.</p>
        <Link href="/" className="share-cta">
          Play today&apos;s Pardle →
        </Link>
      </main>
    );
  }

  const game = shareGameTitle(payload.g);
  const accent = shareGameAccent(payload.g);
  const rows = payload.r.split("|").map((row) => row.split(""));

  // For the on-page preview we render the same grid we render in the
  // OG image, but smaller and inline. Same colour palette.
  return (
    <main className="container share-landing pv-theme">
      <header className="brand">
        <Link className="brand-back" href="/games" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">{game} · Day {payload.d}</p>
      </header>

      <div className="share-card">
        <div className="share-card-result" style={{ color: accent }}>
          {payload.s}
        </div>
        <div className="share-card-grid">
          {rows.map((row, i) => (
            <div key={i} className="share-card-grid-row">
              {row.map((cell, j) => (
                <span
                  key={j}
                  className="share-card-cell"
                  style={{ background: cellColorFor(cell, payload.g) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="share-landing-tagline">
        Your turn — see how you stack up.
      </p>

      <Link href={`/${payload.g}`} className="share-cta">
        Play today&apos;s {game} →
      </Link>

      <footer>
        <p>{BRAND.domain} · Daily golf puzzles</p>
      </footer>
    </main>
  );
}
