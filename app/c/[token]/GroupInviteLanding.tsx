"use client";

/**
 * Landing for a /c/{invite-code} link when the token matches a
 * group's 8-char invite code. Two paths:
 *   - signed out → magic-link sign-in modal, "we'll add you to
 *                   <Group> once you're in"
 *   - signed in  → big "Join <Group>" CTA that POSTs to
 *                   /api/groups/join and redirects to /groups
 *                   on success.
 *
 * The group name + member count are fetched server-side via the
 * admin client (RLS would otherwise block a non-member read) and
 * passed in as props so this is the only client interaction:
 * the join call itself.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/live/auth/useAuth";
import SignInModal from "@/app/live/auth/SignInModal";
import { BRAND } from "@/lib/brand";

interface Props {
  code: string;
  groupName: string;
  memberCount: number;
}

export default function GroupInviteLanding({
  code,
  groupName,
  memberCount,
}: Props) {
  const router = useRouter();
  const { loading, user } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      router.push("/groups");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't join group");
      setBusy(false);
    }
  }

  return (
    <>
      <main className="container share-landing pv-theme">
        <header className="brand">
          <a className="brand-back" href="/" aria-label="Home">
            ←
          </a>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Private group invite</p>
        </header>

        <div className="share-card challenge-card">
          <div className="challenge-card-from">You&rsquo;ve been invited to</div>
          <div
            className="challenge-card-name"
            style={{ color: "var(--pv-emerald-d)" }}
          >
            {groupName}
          </div>
          <div className="challenge-card-detail">
            Private group · {memberCount}{" "}
            {memberCount === 1 ? "member" : "members"}
          </div>
        </div>

        <p className="share-landing-tagline">
          Sweat each other&rsquo;s bets, race a shared P&amp;L, talk smack
          in chat.
        </p>

        {loading ? (
          <button type="button" className="share-cta" disabled>
            Loading…
          </button>
        ) : !user ? (
          <button
            type="button"
            className="share-cta"
            onClick={() => setSignInOpen(true)}
          >
            Sign in to join →
          </button>
        ) : (
          <button
            type="button"
            className="share-cta"
            onClick={join}
            disabled={busy}
          >
            {busy ? "Joining…" : `Join ${groupName} →`}
          </button>
        )}

        {err && (
          <p
            style={{
              marginTop: 16,
              color: "var(--pv-down)",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {err}
          </p>
        )}

        <footer>
          <p>{BRAND.domain} · Private bet-tracking groups</p>
        </footer>
      </main>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
