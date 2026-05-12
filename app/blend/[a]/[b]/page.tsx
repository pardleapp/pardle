import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import {
  PGA_TOUR_IDS,
  pgaTourHeadshotUrlById,
} from "@/lib/data/pga-tour-ids";

interface Params {
  params: Promise<{ a: string; b: string }>;
}

function nameForId(id: string): string | null {
  const slug = Object.entries(PGA_TOUR_IDS).find(([, v]) => v === id)?.[0];
  if (!slug) return null;
  return GOLFERS.find((g) => g.id === slug)?.name ?? null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { a, b } = await params;
  const nameA = nameForId(a);
  const nameB = nameForId(b);
  const headline =
    nameA && nameB ? `${nameA} × ${nameB} — Pardle Blend` : "Pardle Blend";
  return {
    title: headline,
    description: "Two PGA pros, blended into one face. Daily puzzle at pardle.app/faces.",
  };
}

export default async function BlendLanding({ params }: Params) {
  const { a, b } = await params;
  const nameA = nameForId(a);
  const nameB = nameForId(b);
  const cloudinary = (id: string) => pgaTourHeadshotUrlById(id, 600);
  const ogUrl = `${BRAND.url}/blend/${a}/${b}/opengraph-image`;
  const pageUrl = `${BRAND.url}/blend/${a}/${b}`;
  const tweetText =
    nameA && nameB
      ? `${nameA} × ${nameB} 🤝`
      : "Can you name these two PGA pros?";
  const tweetIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(pageUrl)}`;

  return (
    <main className="container blend-landing">
      <header className="brand">
        <Link className="brand-back" href="/blend" aria-label="Make another blend">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Blend</p>
      </header>

      <div className="faces-stage blend-stage-static">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cloudinary(a)}
          alt=""
          className="faces-img faces-img-base"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cloudinary(b)}
          alt=""
          className="faces-img faces-img-overlay"
        />
      </div>

      {nameA && nameB && (
        <div className="blend-names">
          <span>{nameA}</span>
          <span className="blend-x">×</span>
          <span>{nameB}</span>
        </div>
      )}

      <div className="blend-actions">
        <a
          className="blend-save"
          href={ogUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Save image
        </a>
        <a
          className="blend-tweet"
          href={tweetIntent}
          target="_blank"
          rel="noreferrer noopener"
        >
          Tweet it
        </a>
        <Link href="/blend" className="blend-make">
          Make another
        </Link>
      </div>

      <div className="blend-cta">
        <p className="blend-cta-text">
          A new mystery blend every day. 6 puzzles, 12 pros to name.
        </p>
        <Link href="/faces" className="blend-cta-btn">
          Play today&apos;s Faces →
        </Link>
      </div>

      <footer>
        <p>
          {BRAND.domain} · Blend any two PGA pros. Daily puzzles at /faces.
        </p>
      </footer>
    </main>
  );
}
