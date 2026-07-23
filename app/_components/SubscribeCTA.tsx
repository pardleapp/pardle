"use client";

/**
 * SubscribeCTA — first-visit popup pitching free account creation.
 * Shows once, on initial page load, for signed-out visitors who
 * haven't dismissed. Dismissal is remembered in localStorage (30-day
 * cooldown) so repeat visitors aren't nagged.
 *
 * Deliberately DOES NOT use useDismissibleOverlay — the popup hands
 * off to SignInModal (which does), and both fighting for the same
 * history entry left the Subscribe button doing nothing (popup closed
 * via history.back(), the popstate then closed the SignInModal that
 * had just opened). Dismissal here is X / "Maybe later" / backdrop /
 * Escape only.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../live/auth/useAuth";
import SignInModal from "../live/auth/SignInModal";

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

  useEffect(() => {
    if (loading || user) return;
    if (!shouldShowPopup()) return;
    const t = setTimeout(() => setPopupOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [loading, user]);

  // Escape closes the popup.
  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markDismissed();
        setPopupOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupOpen]);

  if (loading || user) return null;

  function close() {
    markDismissed();
    setPopupOpen(false);
  }
  function openSignIn() {
    markDismissed();
    setPopupOpen(false);
    // Give the popup a frame to unmount before mounting SignInModal
    // so their overlay/history/focus flows don't race.
    setTimeout(() => setSignInOpen(true), 60);
  }

  return (
    <>
      {popupOpen && (
        <div
          className="subscribe-overlay"
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          <div
            className="subscribe-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="subscribe-modal-close"
              onClick={close}
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="subscribe-modal-title">
              Create your free account
            </h2>
            <p className="subscribe-modal-body">
              Join Pardle to get:
            </p>
            <ul className="subscribe-modal-benefits">
              <li>
                <strong>Weekly insight email</strong> — data-backed
                analysis before every tournament
              </li>
              <li>
                <strong>Shot-by-shot updates on your bets</strong> —
                push alerts when your picks move
              </li>
              <li>
                <strong>Your bets, everywhere</strong> — phone, laptop,
                same view
              </li>
            </ul>
            <button
              type="button"
              className="subscribe-cta-btn"
              onClick={openSignIn}
            >
              Create account
            </button>
            <button
              type="button"
              className="subscribe-modal-later"
              onClick={close}
            >
              Maybe later
            </button>
            <div className="subscribe-modal-foot">
              Magic-link sign-in · No password · No payment
            </div>
          </div>
        </div>
      )}
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
