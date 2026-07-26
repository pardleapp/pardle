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
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          maxWidth: 1200,
          margin: "20px auto",
          padding: "0 16px 60px",
        }}
      >
        <nav style={{ marginBottom: 12 }}>
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
            fontSize: 22,
            marginBottom: 4,
            fontFamily:
              "var(--font-archivo), 'Archivo', system-uwi, sans-serif",
          }}
        >
          Round score forecast
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "oklch(0.5 0.02 150)",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          Project field and per-player round scores. Enter pin cluster
          per hole; the model handles wind (HRRR), yardage, and level
          shift from finished rounds. Add players to see expected
          mean/median with form adjustment.
        </p>
        <ForecastTool />
      </section>
    </main>
  );
}
