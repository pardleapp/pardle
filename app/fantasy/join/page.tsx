import { redirect } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/lib/fantasy/auth";
import { INVITE_CODE_LENGTH } from "@/lib/fantasy/types";

export const metadata = {
  title: `Join a league — ${BRAND.name} Fantasy`,
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ error?: string; code?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  "bad-invite": "Enter a 6-character invite code.",
  "not-found": "We couldn't find a league with that code. Check it and try again.",
  "league-full": "That league is full (10-player cap).",
  locked: "Picks are locked for that league. Hop in next tournament.",
};

export default async function FantasyJoinPage({ searchParams }: PageProps) {
  const { error, code } = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    const nextPath = code
      ? `/fantasy/join?code=${encodeURIComponent(code)}`
      : "/fantasy/join";
    redirect(`/fantasy/auth?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · join a league</p>
      </header>

      <section className="fantasy-hero">
        <h2 className="fantasy-hero-title">Join a league</h2>
        <p className="fantasy-hero-sub">
          Got a 6-character invite code from a friend? Drop it in below.
        </p>
      </section>

      {error && ERROR_MESSAGES[error] && (
        <p className="fantasy-auth-error">{ERROR_MESSAGES[error]}</p>
      )}

      <form
        action="/api/fantasy/league/join"
        method="post"
        className="fantasy-auth-form-row"
        style={{ marginTop: 24 }}
      >
        <label className="fantasy-field-label">
          <span>Invite code</span>
          <input
            name="code"
            type="text"
            required
            minLength={INVITE_CODE_LENGTH}
            maxLength={INVITE_CODE_LENGTH}
            placeholder="ABCD23"
            autoCapitalize="characters"
            defaultValue={code ?? ""}
            className="fantasy-auth-input fantasy-invite-input"
          />
        </label>
        <label className="fantasy-field-label">
          <span>Your display name (optional)</span>
          <input
            name="displayName"
            type="text"
            maxLength={40}
            placeholder={user.name}
            className="fantasy-auth-input"
          />
        </label>
        <button type="submit" className="fantasy-cta-primary">
          Join league
        </button>
      </form>
    </main>
  );
}
