/**
 * /live/bets — preview surface for the SharpSports BetPost component.
 *
 * Renders three synthetic bet slips so we can eyeball the design in
 * a real browser before real bets start flowing from the SharpSports
 * webhook. Once the integration is live, this page will render the
 * signed-in user's actual synced bets by hitting
 * /api/sharpsports/bets?account=<theirs>.
 *
 * The synthetic data is clearly labelled as a preview so nobody
 * mistakes it for real bet activity.
 */

import Link from "next/link";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import BetPost, { type BetPostUpdate } from "./BetPost";
import type { PardleBetSlip } from "@/lib/sharpsports/types";

export const metadata = {
  title: `Bet feed preview — ${BRAND.name}`,
  description: "Preview of the synced-bet post component.",
  openGraph: null,
  twitter: null,
};

export const dynamic = "force-dynamic";

const sampleUpdates: BetPostUpdate[] = [
  { id: "u1", text: "Birdied 4 — pushed to −3 for the round", value: "−3", direction: "up" },
  { id: "u2", text: "18-footer for eagle on 8, missed left", value: "−", direction: "flat" },
  { id: "u3", text: "Fairway, 138 to pin from the 9th tee", value: "−2", direction: "up" },
];

const now = Date.parse("2026-08-31T14:20:00Z");

const samples: Array<{
  slip: PardleBetSlip;
  live?: {
    probability?: number;
    probabilityHistory?: number[];
    updates?: BetPostUpdate[];
  };
  displayName: string;
  initials?: string;
  isMine?: boolean;
  reactionCount?: number;
  commentCount?: number;
  showTail?: boolean;
}> = [
  {
    // Live bet — your own outright winner on McIlroy
    slip: {
      slipId: "SAMPLE_1",
      bettorAccountId: "BACT_sample",
      book: { id: "BOOK_dk", name: "DraftKings", abbr: "dk" },
      bookRef: "sample-ref-1",
      placedAt: new Date(now - 45 * 60 * 1000).toISOString(),
      isParlay: false,
      slipOddsAmerican: 1200,
      atRiskCents: 5000,
      toWinCents: 60000,
      netProfitCents: null,
      status: "open",
      outcome: "pending",
      golfLegs: [
        {
          legId: "SAMPLE_1L",
          tournament: {
            displayName: "Tour Championship 2026",
            pgaId: "R2026060",
            dgEventId: 60,
            dgYear: 2026,
            startDate: "2026-08-27",
          },
          player: {
            displayName: "Rory McIlroy",
            dgId: 10091,
            pgaId: "28237",
            sharpSportsPositionId: "PLYR_sample",
          },
          market: { kind: "outright-winner" },
          oddsAmerican: 1200,
          outcome: "pending",
          isLive: false,
          incomplete: false,
        },
      ],
      otherLegsCount: 0,
      hasUnknownFields: false,
    },
    live: {
      probability: 0.14,
      probabilityHistory: [0.075, 0.08, 0.09, 0.11, 0.135, 0.14],
      updates: sampleUpdates,
    },
    displayName: "Tom",
    initials: "TB",
    isMine: true,
    reactionCount: 8,
    commentCount: 3,
  },
  {
    // Someone else's parlay — 2 golf legs, tail button available
    slip: {
      slipId: "SAMPLE_2",
      bettorAccountId: "BACT_other",
      book: { id: "BOOK_fd", name: "FanDuel", abbr: "fd" },
      bookRef: "sample-ref-2",
      placedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      isParlay: true,
      slipOddsAmerican: 850,
      atRiskCents: 2500,
      toWinCents: 21250,
      netProfitCents: null,
      status: "open",
      outcome: "pending",
      golfLegs: [
        {
          legId: "SAMPLE_2A",
          tournament: {
            displayName: "Tour Championship 2026",
            pgaId: "R2026060",
            dgEventId: 60,
            dgYear: 2026,
            startDate: "2026-08-27",
          },
          player: {
            displayName: "Scottie Scheffler",
            dgId: 18417,
            pgaId: "46046",
            sharpSportsPositionId: "PLYR_sch",
          },
          market: { kind: "top-finish", n: 5 },
          oddsAmerican: -110,
          outcome: "pending",
          isLive: false,
          incomplete: false,
        },
        {
          legId: "SAMPLE_2B",
          tournament: {
            displayName: "Tour Championship 2026",
            pgaId: "R2026060",
            dgEventId: 60,
            dgYear: 2026,
            startDate: "2026-08-27",
          },
          player: {
            displayName: "Ludvig Åberg",
            dgId: 23950,
            pgaId: "52955",
            sharpSportsPositionId: "PLYR_ab",
          },
          market: { kind: "top-finish", n: 10 },
          oddsAmerican: 130,
          outcome: "pending",
          isLive: false,
          incomplete: false,
        },
      ],
      otherLegsCount: 0,
      hasUnknownFields: false,
    },
    live: {
      probability: 0.28,
      probabilityHistory: [0.32, 0.31, 0.30, 0.295, 0.29, 0.28],
    },
    displayName: "Jordan L",
    initials: "JL",
    reactionCount: 4,
    commentCount: 1,
    showTail: true,
  },
  {
    // Settled winner
    slip: {
      slipId: "SAMPLE_3",
      bettorAccountId: "BACT_sample",
      book: { id: "BOOK_ca", name: "Caesars", abbr: "ca" },
      bookRef: "sample-ref-3",
      placedAt: new Date(now - 30 * 60 * 60 * 1000).toISOString(),
      isParlay: false,
      slipOddsAmerican: -140,
      atRiskCents: 3500,
      toWinCents: 2500,
      netProfitCents: 2500,
      status: "completed",
      outcome: "win",
      golfLegs: [
        {
          legId: "SAMPLE_3L",
          tournament: {
            displayName: "Tour Championship 2026",
            pgaId: "R2026060",
            dgEventId: 60,
            dgYear: 2026,
            startDate: "2026-08-27",
          },
          player: {
            displayName: "Russell Henley",
            dgId: 12716,
            pgaId: "40098",
            sharpSportsPositionId: "PLYR_hen",
          },
          market: { kind: "make-cut" },
          oddsAmerican: -140,
          outcome: "win",
          isLive: false,
          incomplete: false,
        },
      ],
      otherLegsCount: 0,
      hasUnknownFields: false,
    },
    displayName: "Tom",
    initials: "TB",
    isMine: true,
    reactionCount: 12,
    commentCount: 0,
  },
];

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
          <MainNav active="live" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          padding: "20px 4px 60px",
          paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))",
          maxWidth: 640,
          margin: "0 auto",
        }}
      >
        <nav style={{ marginBottom: 12 }}>
          <Link
            href="/live"
            style={{
              fontSize: 12,
              color: "oklch(0.50 0.13 155)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            ← Live feed
          </Link>
        </nav>
        <h2
          style={{
            fontSize: 24,
            marginBottom: 6,
            fontFamily: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            color: "oklch(0.22 0.03 155)",
          }}
        >
          Bet feed
        </h2>
        <p
          style={{
            fontSize: 14,
            color: "oklch(0.42 0.03 155)",
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          Preview of how your synced bets will render in the live feed once
          you connect your sportsbook. Every bet becomes a social post
          with the live win-probability tracking every shot.
        </p>
        <div
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "oklch(0.97 0.02 90)",
            border: "1px solid oklch(0.88 0.06 90)",
            borderRadius: 8,
            fontSize: 12.5,
            fontFamily: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            color: "oklch(0.35 0.10 60)",
          }}
        >
          Preview only — these bets are examples, not real bet activity.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {samples.map((s) => (
            <BetPost
              key={s.slip.slipId}
              slip={s.slip}
              live={s.live}
              displayName={s.displayName}
              initials={s.initials}
              isMine={s.isMine}
              reactionCount={s.reactionCount}
              commentCount={s.commentCount}
              showTail={s.showTail}
              now={now}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
