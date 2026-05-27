"use client";

/**
 * Top-level error boundary — fires when the root layout itself
 * throws (very rare, but Next defaults to a stark white "An error
 * occurred in the Server Components render" page that looks broken).
 *
 * Must include its own <html>/<body> because the root layout never
 * mounted. Inline-styled rather than relying on globals.css since
 * the stylesheet may not be the reason the layout failed.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#0a0a0b",
          color: "#f5f5f7",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#00d96e",
              fontWeight: 800,
            }}
          >
            Pardle
          </p>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 900,
              margin: "16px 0 8px",
            }}
          >
            Something went wrong.
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#a1a1a6",
              margin: "0 0 20px",
              lineHeight: 1.45,
            }}
          >
            We hit a problem loading the site. Try refreshing — if it
            keeps happening, give it a few minutes.
          </p>
          <a
            href="/"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: 999,
              background: "#00d96e",
              color: "#0a0a0b",
              fontWeight: 800,
              textDecoration: "none",
              fontSize: 13.5,
            }}
          >
            Back to Pardle
          </a>
          {error.digest && (
            <p
              style={{
                marginTop: 18,
                fontSize: 11,
                color: "#6b6b70",
                fontFamily: "monospace",
              }}
            >
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
