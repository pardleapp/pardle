import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { decodeChallenge, type ChallengeGame } from "@/lib/challenge";

interface Params {
  params: Promise<{ token: string }>;
}

const GAME_LABEL: Record<ChallengeGame, string> = {
  pros: "Pros",
  holes: "Holes",
  clubs: "Clubhouses",
  connections: "Connections",
};

const GAME_ACCENT: Record<ChallengeGame, string> = {
  pros: "#7BAE3F",
  holes: "#5BA0E0",
  clubs: "#E0A85B",
  connections: "#B388D6",
};

function formatScore(
  game: ChallengeGame,
  score: number | "X",
  day: number,
): string {
  if (score === "X") return "X";
  if (game === "connections") {
    return score === 1 ? "1 mistake" : `${score} mistakes`;
  }
  return `${score}/6`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const decoded = decodeChallenge(token);
  if (!decoded || !decoded.game) {
    return {
      title: `${BRAND.name} — Daily golf puzzles`,
      description: `Play today's ${BRAND.name}.`,
    };
  }
  const game = GAME_LABEL[decoded.game];
  const who = decoded.challengerName || "A friend";
  const scoreStr = formatScore(decoded.game, decoded.score, decoded.dayNumber);
  const title = `${who} beat you to it — ${BRAND.name}: ${game}`;
  const description =
    decoded.score === "X"
      ? `${who} couldn't crack today's ${game}. Your turn.`
      : `${who} solved today's ${game} in ${scoreStr}. Can you beat them?`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BRAND.url}/c/${token}`,
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

export default async function ChallengeLandingPage({ params }: Params) {
  const { token } = await params;
  const decoded = decodeChallenge(token);

  if (!decoded || !decoded.game) {
    return (
      <main className="container share-landing">
        <h1>{BRAND.name}</h1>
        <p>This challenge link couldn&apos;t be read.</p>
        <Link href="/" className="share-cta">
          Play today&apos;s Pardle →
        </Link>
      </main>
    );
  }

  const game = GAME_LABEL[decoded.game];
  const accent = GAME_ACCENT[decoded.game];
  const who = decoded.challengerName || "A friend";
  const scoreStr = formatScore(decoded.game, decoded.score, decoded.dayNumber);
  const isLoss = decoded.score === "X";

  // Forward the same token to the game page so the in-game banner
  // fires when the recipient actually plays.
  const playHref = `/${decoded.game}?c=${token}`;

  return (
    <main className="container share-landing">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">
          {game} · Day {decoded.dayNumber}
        </p>
      </header>

      <div className="share-card challenge-card">
        <div className="challenge-card-from">A challenge from</div>
        <div className="challenge-card-name" style={{ color: accent }}>
          {who}
        </div>
        <div className="challenge-card-detail">
          {isLoss ? (
            <>
              couldn&apos;t crack today&apos;s <strong>{game}</strong>.
            </>
          ) : (
            <>
              got today&apos;s <strong>{game}</strong> in{" "}
              <strong style={{ color: accent }}>{scoreStr}</strong>.
            </>
          )}
        </div>
      </div>

      <p className="share-landing-tagline">
        {isLoss ? "Your turn — solve what they couldn't." : "Can you beat them?"}
      </p>

      <Link href={playHref} className="share-cta">
        Play today&apos;s {game} →
      </Link>

      <footer>
        <p>{BRAND.domain} · Daily golf puzzles</p>
      </footer>
    </main>
  );
}
