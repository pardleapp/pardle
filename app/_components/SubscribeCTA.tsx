"use client";

/**
 * SubscribeCTA — inline card on the Insights homepage that pitches
 * email subscription (magic link, no password, free). Opens the same
 * SignInModal used by the header AuthChip so there's one auth flow.
 *
 * Hidden entirely for signed-in users — they've already subscribed.
 *
 * The framing is deliberately about *insights* rather than *account*
 * because the current growth motion is capturing email addresses;
 * saved-bet sync and the rest of the account benefits are secondary.
 */

import { useState } from "react";
import { useAuth } from "../live/auth/useAuth";
import SignInModal from "../live/auth/SignInModal";

export default function SubscribeCTA() {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  if (loading || user) return null;
  return (
    <>
      <div className="subscribe-cta">
        <div className="subscribe-cta-eyebrow">Free · No payment</div>
        <h3 className="subscribe-cta-title">
          Get the weekly insight straight to your inbox
        </h3>
        <p className="subscribe-cta-body">
          Data-backed analysis every week — pin patterns, course fit,
          skill-adjusted picks. Delivered before every tournament.
        </p>
        <button
          type="button"
          className="subscribe-cta-btn"
          onClick={() => setOpen(true)}
        >
          Subscribe with email
        </button>
        <div className="subscribe-cta-foot">
          Magic-link sign-in · No password · Unsubscribe anytime
        </div>
      </div>
      <SignInModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
