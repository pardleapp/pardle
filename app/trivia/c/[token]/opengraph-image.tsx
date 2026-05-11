import { ImageResponse } from "next/og";
import { decodeTriviaChallenge } from "@/lib/trivia-challenge";

export const runtime = "edge";
export const alt = "Pardle Trivia challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Params {
  params: Promise<{ token: string }>;
}

const DIFFICULTY_ACCENT: Record<string, string> = {
  easy: "#7BAE3F",
  medium: "#E8C547",
  hard: "#E07070",
};

export default async function OpengraphImage({ params }: Params) {
  const { token } = await params;
  const decoded = decodeTriviaChallenge(token);

  if (!decoded) {
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

  const accent = DIFFICULTY_ACCENT[decoded.d] ?? "#7BAE3F";
  const tier = decoded.d[0].toUpperCase() + decoded.d.slice(1);

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
          <span>TRIVIA</span>
          <span>·</span>
          <span>{tier.toUpperCase()}</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 50,
            fontWeight: 700,
            marginTop: 30,
            opacity: 0.92,
          }}
        >
          A challenge from
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 144,
            fontWeight: 900,
            letterSpacing: "-5px",
            color: accent,
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          {decoded.p || "A friend"}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 40,
            fontWeight: 700,
            marginTop: 28,
            lineHeight: 1.15,
          }}
        >
          scored
          <span
            style={{
              display: "flex",
              color: "#FFD64A",
              fontWeight: 900,
              marginLeft: 16,
            }}
          >
            {decoded.s}/10
          </span>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 32,
            fontSize: 32,
            fontWeight: 800,
            color: "#FFD64A",
          }}
        >
          See if you can beat them →
        </div>
      </div>
    ),
    { ...size },
  );
}
