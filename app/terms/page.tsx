import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";

export const metadata: Metadata = {
  title: `Terms — ${BRAND.name}`,
  description: `Terms of use for ${BRAND.name}.`,
};

export default function TermsPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <article className="legal-page">
        <h2 className="legal-title">Terms of use</h2>
        <p className="legal-updated">Last updated: 27 May 2026.</p>

        <p>
          By using {BRAND.name} you agree to these terms. They&apos;re short
          on purpose. If you don&apos;t agree with any of them, please don&apos;t
          use the site.
        </p>

        <h3>What Pardle is</h3>
        <p>
          {BRAND.name} is a live tracker for golf bets. We display
          tournament data, model-derived fair-value estimates, and tools
          to record bets you&apos;ve placed elsewhere. <strong>We are not a
          bookmaker.</strong> We don&apos;t accept stakes, hold funds, or pay
          out winnings. Every number you see is informational.
        </p>

        <h3>Age and eligibility</h3>
        <p>
          You must be <strong>18 or older</strong> to use {BRAND.name}.
          Gambling-related content is intended for adults. If you&apos;re
          under 18, please leave.
        </p>

        <h3>Responsible use</h3>
        <p>
          Sports betting can be addictive. If you&apos;re worried about
          someone&apos;s gambling — or your own — help is free and
          confidential:
        </p>
        <ul>
          <li>
            UK: <a href="https://www.gamcare.org.uk" target="_blank" rel="noreferrer">GamCare</a>{" "}
            (0808 8020 133)
          </li>
          <li>
            US: <a href="https://www.ncpgambling.org" target="_blank" rel="noreferrer">National Council on Problem Gambling</a>{" "}
            (1-800-GAMBLER)
          </li>
        </ul>

        <h3>Your account and content</h3>
        <p>
          You&apos;re responsible for what you post — comments, chat
          messages, tipster page content. Don&apos;t post anything illegal,
          harassing, hateful, or that promotes gambling to minors. We can
          remove content or close accounts that violate this.
        </p>

        <h3>Accuracy</h3>
        <p>
          We pull tournament data from public sources and run our own
          models. Numbers can be wrong, delayed, or missing. Don&apos;t make
          financial decisions based on what you see here without
          double-checking against the bookmaker you placed the bet with.
        </p>

        <h3>Tipster content</h3>
        <p>
          Tipster channels post their own tips. We host the platform but
          don&apos;t endorse, verify, or stand behind any individual tipster&apos;s
          claims or performance. Track records shown on tipster pages
          (Sharp Score, accuracy %) reflect what they&apos;ve done on Pardle —
          not their results elsewhere.
        </p>

        <h3>Liability</h3>
        <p>
          {BRAND.name} is provided as-is. We&apos;re not liable for any losses
          — financial, missed-opportunity, or otherwise — arising from
          your use of the site or reliance on what it displays.
        </p>

        <h3>Changes</h3>
        <p>
          If we materially change these terms we&apos;ll update the date at
          the top of this page. Continued use after that means you accept
          the change.
        </p>

        <h3>Contact</h3>
        <p>
          Questions: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.
          See also our <Link href="/privacy">privacy policy</Link>.
        </p>
      </article>
    </main>
  );
}
