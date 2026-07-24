"use client";

/**
 * SubscribeCTA — post-engagement popup pitching free account creation.
 * Fires only AFTER the visitor has spent meaningful time on a value-
 * proving surface (an article or an analysis tool). The
 * EngagementBeacon in the root layout writes `pardle_engaged_at` to
 * localStorage after ~10 seconds on any qualifying page. This popup
 * component then only opens when that key exists — prove the value
 * first, ask for the email second.
 *
 * Dismissal is stored under `pardle_subscribe_prompt_dismissed_at`
 * with a 30-day cooldown so repeat visitors aren't nagged.
 *
 * Deliberately DOES NOT use useDismissibleOverlay — the popup hands
 * off to SignInModal (which does), and both fighting for the same
 * history entry left the Subscribe button doing nothing. Dismissal
 * here is X / "Maybe later" / backdrop / Escape only.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../live/auth/useAuth";
import SignInModal from "../live/auth/SignInModal";

const ENGAGED_KEY = "pardle_engaged_at";
const DISMISS_KEY = "pardle_subscribe_prompt_dismissed_at";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OPEN_DELAY_MS = 1500; // 1.5s so the popup lands after page settles
const ENGAGEMENT_POLL_MS = 2000; // recheck engagement while mounted

function isEngaged(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENGAGED_KEY) != null;
  } catch {
    return false;
  }
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < COOLDOWN_MS;
  } catch {
    return false;
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
    if (isDismissed()) return;

    // Fast path: engagement already recorded (visitor read an article
    // or used a tool in a previous session). Fire the popup right away
    // with the standard settle delay.
    if (isEngaged()) {
      const t = window.setTimeout(() => setPopupOpen(true), OPEN_DELAY_MS);
      return () => window.clearTimeout(t);
    }

    // Slow path: no engagement yet. Watch localStorage — the
    // EngagementBeacon writes the key after ~10s on a qualifying
    // page. Poll every 2s so we notice mid-session engagement, and
    // also listen to the storage event so cross-tab engagement
    // propagates.
    let popupTimer: number | undefined;
    const check = () => {
      if (popupTimer != null) return;
      if (isEngaged() && !isDismissed()) {
        popupTimer = window.setTimeout(
          () => setPopupOpen(true),
          OPEN_DELAY_MS,
        );
      }
    };
    check();
    const poll = window.setInterval(check, ENGAGEMENT_POLL_MS);
    const onStorage = (e: StorageEvent) => {
      if (e.key === ENGAGED_KEY) check();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("storage", onStorage);
      if (popupTimer != null) window.clearTimeout(popupTimer);
    };
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
