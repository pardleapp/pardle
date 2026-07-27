import Link from "next/link";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import ForecastTool from "./ForecastTool";

export const metadata = {
  title: `Round score forecast — ${BRAND.name}`,
  description:
    "Project field and per-player round scores. Pin-cluster overrides, HRRR wind, flexible level-shift mode, Bayesian form adjustment.",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      {/*
        On mobile the top ribbon collapses to just the AuthChip because
        the wordmark and nav tabs are already hidden by v4-theme. That
        leaves an empty white strip with a floating Sign in pill — pure
        vertical waste when there's already a bottom nav. Hide the
        whole ribbon under the phone breakpoint so the intro copy sits
        directly under the safari URL bar.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 767px) {
              body header.brand.brand-split { display: none !important; }
            }
          `,
        }}
      />
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          // Fill the desktop-shell content column edge-to-edge — no
          // maxWidth cap; the shell's grid track already sizes it.
          // Bottom padding is bigger on mobile to clear the fixed
          // bottom nav (~60px + safe-area).
          padding: "20px 4px 60px",
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <nav
          style={{
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/analysis"
            style={{
              fontSize: 12,
              color: "oklch(0.50 0.13 155)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            ← All analyses
          </Link>
          <Link
            href="/analysis/score-forecast/how-it-works"
            style={{
              fontSize: 12,
              color: "oklch(0.50 0.13 155)",
              textDecoration: "none",
              fontWeight: 800,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              padding: "6px 12px",
              border: "1px solid oklch(0.50 0.13 155)",
              borderRadius: 999,
            }}
          >
            How the model works →
          </Link>
        </nav>
        <h2
          style={{
            fontSize: 26,
            marginBottom: 6,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            color: "oklch(0.26 0.04 155)",
          }}
        >
          Round score forecast
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "oklch(0.35 0.03 155)",
            marginBottom: 22,
            lineHeight: 1.55,
            maxWidth: 900,
          }}
        >
          Project field and per-player round scores. Pin clusters are
          auto-matched from the pin sheet; the model handles wind
          (HRRR), yardage (auto or manual), and level shift from
          finished rounds. Add players to see expected mean/median
          with Bayesian form adjustment.{" "}
          <Link
            href="/analysis/score-forecast/how-it-works"
            style={{
              color: "oklch(0.50 0.13 155)",
              fontWeight: 700,
              textDecoration: "underline",
            }}
          >
            See how the model works →
          </Link>
        </p>
        <ForecastTool />
      </section>
    </main>
  );
}
