"use client";

/**
 * Root error boundary. Catches every uncaught error inside the
 * tree below /app. Renders a v4-theme apology with a manual reset
 * + a back-to-home escape so users never see Next.js framework
 * chrome.
 *
 * `error.stack` is intentionally NOT rendered — would leak module
 * paths and library internals to the visitor. The console log
 * stays for our own Vercel logs.
 */

import { useEffect } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "./live/auth/AuthChip";
import MainNav from "./MainNav";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>
          <Link href="/" className="brand-back">
            {BRAND.name}
          </Link>
        </h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <section className="error-shell">
        <p className="error-eyebrow">Something went wrong</p>
        <h2 className="error-title">
          We hit a snag loading this page.
        </h2>
        <p className="error-body">
          It&apos;s likely a temporary issue — try again, or head back to the
          home page.
        </p>
        <div className="error-actions">
          <button type="button" onClick={reset} className="error-cta">
            Try again
          </button>
          <Link href="/" className="error-cta-quiet">
            Back to {BRAND.name}
          </Link>
        </div>
        {error.digest && (
          <p className="error-digest">
            Reference: <code>{error.digest}</code>
          </p>
        )}
      </section>
    </main>
  );
}
