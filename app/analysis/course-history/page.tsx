import Link from "next/link";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import CourseHistoryTool from "./CourseHistoryTool";

export const metadata = {
  title: `Course history — ${BRAND.name}`,
  description:
    "Ballstriking course fit for every PGA Tour recurring event. See who's over- or under-performed their season SG:OTT+APP baseline at any course since 2019.",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      {/* Hide the empty top ribbon on mobile — same treatment the
          forecast tool and analysis index got. */}
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
          Course history
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
          Ballstriking course fit for every PGA Tour venue since 2019
          (this season included). Rounds are grouped by{" "}
          <strong>course</strong>, not event — so a rotating tournament
          like The Open Championship gets split cleanly by venue (Royal
          Troon vs St Andrews vs Royal Portrush) instead of being mashed
          into one meaningless aggregate.
          <br />
          <br />
          We look only at SG:OTT and SG:APP — the two buckets that
          carry the strongest signal about how a course rewards a
          player&apos;s tee-to-green skills. The default ranking is
          <strong> outperformance</strong>: each at-course round&apos;s
          SG minus the player&apos;s{" "}
          <em>trailing-50-round baseline</em> ending on the day the
          event started — the form we knew about them entering the
          week, with no lookahead. Baselines are field-strength
          adjusted so a round played in a WGC-strength field isn&apos;t
          penalised against a regular tour week.
        </p>
        <CourseHistoryTool />
      </section>
    </main>
  );
}
