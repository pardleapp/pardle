import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pardle — daily mystery golfer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #1a3a1a 0%, #284a23 40%, #5a8f3d 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 96px",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Subtle diagonal pattern overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 28px, rgba(255,255,255,0.04) 28px 30px)",
          }}
        />

        {/* Left column: brand and tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            zIndex: 2,
            maxWidth: 720,
          }}
        >
          <div
            style={{
              fontSize: 156,
              fontWeight: 900,
              letterSpacing: -6,
              lineHeight: 1,
              color: "#ffffff",
              textShadow: "0 6px 28px rgba(0, 0, 0, 0.5)",
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              opacity: 0.96,
              letterSpacing: -1,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            Daily mystery golfer
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              opacity: 0.78,
              letterSpacing: 0.3,
              marginTop: 8,
            }}
          >
            Six guesses. New every day at midday.
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#FFD64A",
              marginTop: 28,
              letterSpacing: 0.5,
            }}
          >
            pardle.app
          </div>
        </div>

        {/* Right column: stylized mystery medallion */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          }}
        >
          {/* Outer glow ring */}
          <div
            style={{
              position: "absolute",
              width: 360,
              height: 360,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255, 214, 74, 0.4) 0%, rgba(255, 214, 74, 0) 70%)",
            }}
          />
          {/* Medallion */}
          <div
            style={{
              width: 300,
              height: 300,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, #fff5b8 0%, #FFD64A 35%, #d4a017 70%, #b8860b 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 220,
              color: "#1a3a1a",
              fontWeight: 900,
              boxShadow:
                "0 28px 70px rgba(0, 0, 0, 0.5), inset 0 -8px 16px rgba(0, 0, 0, 0.15), inset 0 6px 12px rgba(255, 255, 255, 0.5)",
              border: "8px solid rgba(255, 255, 255, 0.85)",
            }}
          >
            ?
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
