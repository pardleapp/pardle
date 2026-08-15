import Link from "next/link";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import CompareTool from "./CompareTool";

export const metadata = {
  title: `Odds compare — ${BRAND.name}`,
  description:
    "Live cross-book round-score O/U comparison for the active tournament.",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="container container-wide v4-theme pv-theme">
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
          Round-score odds compare
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
          Live over/under round-score pricing for the top of this
          week&apos;s field, side-by-side across the five books that
          post it. Best price per side is bordered emerald so it&apos;s
          scannable at a glance. Pricing refreshes every ~30 seconds.
        </p>
        <CompareTool />
      </section>
    </main>
  );
}
