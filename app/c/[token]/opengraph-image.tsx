import { ImageResponse } from "next/og";
import { decodeChallenge, type ChallengeGame } from "@/lib/challenge";

export const runtime = "edge";
export const alt = "Pardle challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
): string {
  if (score === "X") return "X";
  if (game === "connections") {
    return score === 1 ? "1 mistake" : `${score} mistakes`;
  }
  return `${score}/6`;
}

export default async function OpengraphImage({ params }: Params) {
  const { token } = await params;
  const decoded = decodeChallenge(token);

  if (!decoded || !decoded.game) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #0F1F0F 0%, #2c5a28 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontFamily: "system-ui, sans-serif",
            fontSize: 132,
            fontWeight: 900,
            letterSpacing: "-4px",
          }}
        >
          PARDLE
        </div>
      ),
      { ...size },
    );
  }

  const game = GAME_LABEL[decoded.game];
  const accent = GAME_ACCENT[decoded.game];
  const who = decoded.challengerName || "A friend";
  const scoreStr = formatScore(decoded.game, decoded.score);
  const isLoss = decoded.score === "X";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "70px 90px",
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 26,
            fontWeight: 700,
            opacity: 0.72,
            letterSpacing: "1px",
          }}
        >
          <span>PARDLE</span>
          <span>·</span>
          <span>{game.toUpperCase()}</span>
          <span>·</span>
          <span>DAY {decoded.dayNumber}</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            marginTop: 36,
            opacity: 0.92,
          }}
        >
          A challenge from
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 156,
            fontWeight: 900,
            letterSpacing: "-5px",
            color: accent,
            lineHeight: 1,
            marginTop: 8,
          }}
        >
          {who}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: 700,
            marginTop: 28,
            maxWidth: 980,
            lineHeight: 1.15,
          }}
        >
          {isLoss
            ? `couldn't crack today's ${game}.`
            : `solved today's ${game} in `}
          {!isLoss && (
            <span
              style={{
                display: "flex",
                color: "#FFD64A",
                fontWeight: 900,
                marginLeft: 14,
              }}
            >
              {scoreStr}
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 40,
            fontSize: 32,
            fontWeight: 800,
            color: "#FFD64A",
          }}
        >
          {isLoss ? "Solve what they couldn't →" : "Can you beat them?"}
        </div>
      </div>
    ),
    { ...size },
  );
}
