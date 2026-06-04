"use client";

/**
 * Top-level error boundary — fires when the root layout itself
 * throws (very rare, but Next defaults to a stark white "An error
 * occurred in the Server Components render" page that looks broken).
 *
 * Must include its own <html>/<body> because the root layout never
 * mounted. Inline-styled rather than relying on globals.css since
 * the stylesheet may not be the reason the layout failed. Uses the
 * v2 light tokens (warm-paper bg, emerald accents) — no dark states
 * anywhere in the app per CLAUDE.md.
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
          background: "oklch(0.972 0.009 95)",
          color: "oklch(0.26 0.04 155)",
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
              color: "oklch(0.50 0.13 155)",
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
              color: "oklch(0.26 0.04 155)",
            }}
          >
            Something went wrong.
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "oklch(0.50 0.02 150)",
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
              background: "oklch(0.50 0.13 155)",
              color: "#fff",
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
                color: "oklch(0.62 0.018 150)",
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
