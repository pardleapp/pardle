import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  getAuthorByShareToken,
  getSharpScore,
  SHARP_MIN_CALLS,
} from "@/lib/feed/sharp-score";
import { Redis } from "@upstash/redis";
import AuthChip from "@/app/live/auth/AuthChip";
import MainNav from "@/app/MainNav";

export const dynamic = "force-dynamic";

const redis = Redis.fromEnv();

interface PageProps {
  params: Promise<{ token: string }>;
}

async function fetchPayload(token: string) {
  const authorKey = await getAuthorByShareToken(token);
  if (!authorKey) return null;
  const score = await getSharpScore(authorKey);
  // Pull display name from the leaderboard names hash — if missing,
  // we fall back to "Anonymous" on the page rather than 404'ing
  // since the share might be from a brand new caller.
  const nameRaw = await redis
    .hget<string>("sharp:lb:season:names", authorKey)
    .catch(() => null);
  const displayName =
    typeof nameRaw === "string" && nameRaw.trim().length > 0
      ? nameRaw
      : "Anonymous";
  return { score, displayName };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const payload = await fetchPayload(token);
  if (!payload) {
    return {
      title: `Sharp Score — ${BRAND.name}`,
      description: "Track your prediction accuracy on live golf calls.",
    };
  }
  const { score, displayName } = payload;
  const acc = Math.round(score.accuracy * 100);
  const title = score.qualified
    ? `${displayName} — ${acc}% on ${score.total} calls`
    : `${displayName} — ${score.total} of ${SHARP_MIN_CALLS} calls toward Sharp Score`;
  const description = score.qualified
    ? `${displayName} is calling Pardle predictions at ${acc}% accuracy across ${score.total} settled calls. See the leaderboard.`
    : `${displayName} is building a Sharp Score on Pardle — ${score.total} of ${SHARP_MIN_CALLS} calls in.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function SharpSharePage({ params }: PageProps) {
  const { token } = await params;
  const payload = await fetchPayload(token);
  if (!payload) notFound();
  const { score, displayName } = payload;
  const acc = Math.round(score.accuracy * 100);
  const tone = !score.qualified
    ? "neutral"
    : acc >= 60
      ? "good"
      : acc >= 50
        ? "ok"
        : "poor";

  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="sharp" />
          <AuthChip />
        </div>
      </header>

      <section className="sharp-share">
        <p className="sharp-share-eyebrow">Sharp Score</p>
        <h2 className="sharp-share-name">{displayName}</h2>

        {score.qualified ? (
          <div className={`sharp-share-hero sharp-share-hero-${tone}`}>
            <span className="sharp-share-hero-acc">{acc}%</span>
            <span className="sharp-share-hero-lbl">accuracy</span>
          </div>
        ) : (
          <div className="sharp-share-hero sharp-share-hero-neutral">
            <span className="sharp-share-hero-acc">
              {score.total}/{SHARP_MIN_CALLS}
            </span>
            <span className="sharp-share-hero-lbl">calls to qualify</span>
          </div>
        )}

        <ul className="sharp-share-stats">
          <li>
            <span className="sharp-share-stat-num">{score.total}</span>
            <span className="sharp-share-stat-lbl">total calls</span>
          </li>
          <li>
            <span className="sharp-share-stat-num">{score.correct}</span>
            <span className="sharp-share-stat-lbl">correct</span>
          </li>
          {score.currentStreak >= 2 && (
            <li>
              <span className="sharp-share-stat-num">
                🔥 {score.currentStreak}
              </span>
              <span className="sharp-share-stat-lbl">on a run</span>
            </li>
          )}
          {score.qualified && score.rank != null && (
            <li>
              <span className="sharp-share-stat-num">#{score.rank}</span>
              <span className="sharp-share-stat-lbl">leaderboard rank</span>
            </li>
          )}
        </ul>

        <div className="sharp-share-ctas">
          <Link href="/sharp" className="sharp-share-cta">
            Build your own Sharp Score →
          </Link>
          <Link href="/" className="sharp-share-cta-quiet">
            Open the live feed
          </Link>
        </div>

        <p className="sharp-share-footnote">
          Sharp Score tracks accuracy across every prediction you make
          on Pardle — putt-polls, Sunday calls, bet outcomes. Need at
          least {SHARP_MIN_CALLS} settled calls to qualify.
        </p>
      </section>
    </main>
  );
}
