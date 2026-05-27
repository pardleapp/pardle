import { ImageResponse } from "next/og";

// Browser tab favicon. Next.js auto-discovers this file and serves it
// at /icon. Replaces the default favicon.ico.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#00d96e",
          color: "#0a0d12",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 900,
          fontFamily: "system-ui, sans-serif",
          letterSpacing: -1,
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
