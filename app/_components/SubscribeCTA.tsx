"use client";

/**
 * SubscribeCTA — first-visit popup pitching free email subscription.
 * Shows once, on initial page load, for signed-out visitors who
 * haven't dismissed or subscribed. Dismissal is remembered in
 * localStorage (30-day cooldown) so repeat visitors aren't nagged.
 *
 * Opens the standard SignInModal for the actual email capture —
 * there's one auth flow everywhere in the app.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../live/auth/useAuth";
import SignInModal from "../live/auth/SignInModal";
import { useDismissibleOverlay } from "../_hooks/useDismissibleOverlay";

const DISMISS_KEY = "pardle_subscribe_prompt_dismissed_at";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OPEN_DELAY_MS = 700;

function shouldShowPopup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return true;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode — accept re-prompting next visit */
  }
}

export default function SubscribeCTA() {
  const { user, loading } = useAuth();
  const [popupOpen, setPopupOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  useDismissibleOverlay(popupOpen, () => {
    markDismissed();
    setPopupOpen(false);
  });

  useEffect(() => {
    if (loading || user) return;
    if (!shouldShowPopup()) return;
    const t = setTimeout(() => setPopupOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [loading, user]);

  if (loading || user) return null;

  function close() {
    markDismissed();
    setPopupOpen(false);
  }
  function openSignIn() {
    markDismissed();
    setPopupOpen(false);
    setSignInOpen(true);
  }

  return (
    <>
      {popupOpen && (
        <div className="subscribe-overlay" role="dialog" aria-modal="true">
          <div className="subscribe-modal">
            <button
              type="button"
              className="subscribe-modal-close"
              onClick={close}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="subscribe-cta-eyebrow">Free · No payment</div>
            <h2 className="subscribe-modal-title">
              Get the weekly insight straight to your inbox
            </h2>
            <p className="subscribe-modal-body">
              Data-backed analysis every week — pin patterns, course
              fit, skill-adjusted picks. Delivered before every
              tournament.
            </p>
            <button
              type="button"
              className="subscribe-cta-btn"
              onClick={openSignIn}
            >
              Subscribe with email
            </button>
            <button
              type="button"
              className="subscribe-modal-later"
              onClick={close}
            >
              Maybe later
            </button>
            <div className="subscribe-modal-foot">
              Magic-link sign-in · No password · Unsubscribe anytime
            </div>
          </div>
        </div>
      )}
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
