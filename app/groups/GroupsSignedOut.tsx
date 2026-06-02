"use client";

/**
 * Sign-in gate for /groups. Private groups require a real user
 * account (auth.users + RLS), so signed-out visitors see this
 * prompt and the existing magic-link SignInModal opens on tap.
 */

import { useState } from "react";
import SignInModal from "../live/auth/SignInModal";

export default function GroupsSignedOut() {
  const [signInOpen, setSignInOpen] = useState(false);
  return (
    <>
      <section className="groups-pv">
        <div className="groups-soon">
          <div className="groups-soon-emoji" aria-hidden="true">
            🏌️
          </div>
          <div className="groups-soon-title">Sign in to use Groups</div>
          <p className="groups-soon-blurb">
            Private groups are tied to your Pardle account so only your
            crew can see the chat and the P&amp;L race. Sign in with your
            email — magic link, no password.
          </p>
          <button
            type="button"
            className="groups-soon-cta"
            onClick={() => setSignInOpen(true)}
          >
            Sign in to continue →
          </button>
        </div>
      </section>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
