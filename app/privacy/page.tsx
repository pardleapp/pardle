import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";

export const metadata: Metadata = {
  title: `Privacy — ${BRAND.name}`,
  description: `How ${BRAND.name} handles data, cookies, and your account.`,
};

export default function PrivacyPage() {
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
        <h2 className="legal-title">Privacy</h2>
        <p className="legal-updated">Last updated: 27 May 2026.</p>

        <p>
          Pardle is built and operated by an independent developer. This
          page explains what we collect, why, and how to ask us to delete
          it. The short version: we collect the minimum needed to make
          the product work, and we don&apos;t sell your data to anyone.
        </p>

        <h3>What we collect</h3>
        <ul>
          <li>
            <strong>Anonymous browser identifier.</strong> When you first
            visit Pardle we generate a random ID and store it in your
            browser&apos;s localStorage under <code>pardle_feed_author</code>.
            It lets us attribute your putt-poll votes, reactions, and
            comments to a consistent identity without you having to sign
            in. We never know who you are from this ID alone.
          </li>
          <li>
            <strong>Account (optional).</strong> If you sign in, we store
            your email + a display name in Supabase (our auth provider).
            Sign-in lets your bets sync across devices and lets you post
            to tipster channels.
          </li>
          <li>
            <strong>Bets you track.</strong> When you add a bet, we store
            the stake, odds, player, and market so we can show you the
            live PnL. Bets are private by default; you can mark a bet
            shareable or post it to a tipster channel.
          </li>
          <li>
            <strong>Push subscription.</strong> If you opt in to
            notifications, we store your browser&apos;s push endpoint so we
            can send you bet-settlement and player-event pushes. You can
            revoke this in your browser settings at any time.
          </li>
          <li>
            <strong>Aggregate analytics.</strong> We use Vercel Analytics,
            which is fingerprint-free and doesn&apos;t use cookies. No
            third-party advertisers or trackers.
          </li>
        </ul>

        <h3>What we don&apos;t collect</h3>
        <p>
          We don&apos;t track you across other sites. We don&apos;t run ad
          networks. We don&apos;t sell or rent data. There are no third-party
          analytics SDKs, no Facebook pixel, no Google tags.
        </p>

        <h3>Who we share data with</h3>
        <ul>
          <li>
            <strong>Supabase</strong> — hosts our database and handles
            sign-in. Bound by a data-processing agreement; data lives in
            the EU region.
          </li>
          <li>
            <strong>Upstash</strong> — caches live feed data; no personal
            information stored.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the website. Sees standard
            request logs.
          </li>
          <li>
            <strong>Resend</strong> — delivers sign-in emails. Only sees
            your email address for the message.
          </li>
        </ul>
        <p>None of these process data for any purpose besides ours.</p>

        <h3>Your rights</h3>
        <p>
          Under UK and EU GDPR you can ask for: a copy of your data,
          correction of anything wrong, or deletion of your account and
          everything attached to it. Email{" "}
          <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> and we&apos;ll
          action it within 14 days.
        </p>
        <p>
          To clear the anonymous browser identifier on your own, open
          your browser settings and delete site data for {BRAND.domain}.
        </p>

        <h3>Cookies</h3>
        <p>
          We use the localStorage identifier above (not technically a
          cookie, but functionally similar — disclosed for full
          transparency) and the auth-session cookie set by Supabase
          while you&apos;re signed in. Nothing else.
        </p>

        <h3>Changes to this policy</h3>
        <p>
          If we materially change how we handle data we&apos;ll update the
          date at the top of this page and notify signed-in users by
          email.
        </p>

        <h3>Contact</h3>
        <p>
          Questions? <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.
        </p>
      </article>
    </main>
  );
}
