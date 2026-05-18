"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/app/live/auth/useAuth";

interface OwnedRow {
  slug: string;
  name: string;
  bio: string | null;
  isPublic: boolean;
}

interface FollowingRow extends OwnedRow {
  notifyOnNewTip: boolean;
}

export default function TipsterHubClient() {
  const { user, loading: authLoading } = useAuth();
  const [owned, setOwned] = useState<OwnedRow[]>([]);
  const [following, setFollowing] = useState<FollowingRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    fetch("/api/channels/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setOwned(j.owned ?? []);
        setFollowing(j.following ?? []);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [user, authLoading]);

  if (authLoading || !loaded) {
    return <p className="feed-empty">Loading…</p>;
  }
  if (!user) {
    return (
      <div className="tipster-create-gate">
        <p>
          Sign in to follow tipsters or start your own page. Tap the auth
          chip in the top right of the live feed.
        </p>
      </div>
    );
  }

  return (
    <section className="tipster-hub">
      <div className="tipster-hub-section">
        <h2 className="tipster-hub-heading">Your page</h2>
        {owned.length === 0 ? (
          <Link href="/tipster/new" className="tipster-hub-cta-card">
            <div>
              <strong>Become a tipster</strong>
              <p>
                Post bets to your followers in real time. They get a push the
                second you drop a pick.
              </p>
            </div>
            <span className="tipster-hub-cta-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ) : (
          <ul className="tipster-hub-list">
            {owned.map((c) => (
              <li key={c.slug}>
                <Link href={`/${c.slug}`} className="tipster-hub-card">
                  <div className="tipster-hub-card-main">
                    <div className="tipster-hub-card-name">{c.name}</div>
                    <div className="tipster-hub-card-handle">@{c.slug}</div>
                    {c.bio && (
                      <p className="tipster-hub-card-bio">{c.bio}</p>
                    )}
                  </div>
                  <span className="tipster-hub-card-tag">
                    {c.isPublic ? "Public" : "Invite only"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tipster-hub-section">
        <h2 className="tipster-hub-heading">Following</h2>
        {following.length === 0 ? (
          <p className="tipster-hub-empty">
            You aren&apos;t following anyone yet. Tipsters share their page
            with you via a direct link.
          </p>
        ) : (
          <ul className="tipster-hub-list">
            {following.map((c) => (
              <li key={c.slug}>
                <Link href={`/${c.slug}`} className="tipster-hub-card">
                  <div className="tipster-hub-card-main">
                    <div className="tipster-hub-card-name">{c.name}</div>
                    <div className="tipster-hub-card-handle">@{c.slug}</div>
                  </div>
                  {c.notifyOnNewTip && (
                    <span className="tipster-hub-card-tag">🔔</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
