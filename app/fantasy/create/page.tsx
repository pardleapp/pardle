import { redirect } from "next/navigation";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/lib/fantasy/auth";
import { getOrInitNextTournament } from "@/lib/fantasy/tournament-ops";

export const metadata = {
  title: `Create a league — ${BRAND.name} Fantasy`,
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function FantasyCreatePage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/fantasy/auth?next=%2Ffantasy%2Fcreate");
  }

  const { error } = await searchParams;
  const tournament = await getOrInitNextTournament();

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/fantasy" aria-label="Back to fantasy">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Fantasy · create a league</p>
      </header>

      <section className="fantasy-hero">
        <h2 className="fantasy-hero-title">Start your league</h2>
        <p className="fantasy-hero-sub">
          Playing for the <strong>{tournament.name}</strong> at{" "}
          {tournament.course} ({tournament.startDate.slice(5)} →{" "}
          {tournament.endDate.slice(5)}).
        </p>
      </section>

      {error === "bad-name" && (
        <p className="fantasy-auth-error">
          Give your league a name (1–60 characters).
        </p>
      )}

      <form
        action="/api/fantasy/league/create"
        method="post"
        className="fantasy-auth-form-row"
        style={{ marginTop: 24 }}
      >
        <label className="fantasy-field-label">
          <span>League name</span>
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            placeholder="The Sunday Sweat"
            className="fantasy-auth-input"
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
          Create league
        </button>
      </form>

      <p className="fantasy-hero-sub" style={{ fontSize: 13, marginTop: 16 }}>
        After creating, you&apos;ll get an invite link to share with up to 9 friends.
      </p>
    </main>
  );
}
