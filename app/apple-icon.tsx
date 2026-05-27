import { ImageResponse } from "next/og";

// Apple home-screen icon. iOS uses this when a user does
// "Add to Home Screen" from Safari, and also picks it up when push
// notification banners need to show our app badge. 180×180 is the
// modern iPhone size; older devices scale down cleanly.
//
// Design: green-on-dark monogram "P" with subtle radial glow. Reads
// as a real app icon, not a placeholder.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 40% 30%, #1c2230 0%, #0a0d12 70%)",
          color: "#00d96e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 130,
          fontWeight: 900,
          fontFamily: "system-ui, sans-serif",
          letterSpacing: -8,
          textShadow: "0 0 24px rgba(0, 217, 110, 0.55)",
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
