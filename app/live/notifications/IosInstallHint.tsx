"use client";

/**
 * iOS Safari Add-to-Home-Screen hint. iOS doesn't support web push
 * unless the site is installed as a PWA (home-screen icon launched
 * in standalone mode), so the regular NotificationPrompt skips iOS
 * Safari entirely — and ~85% of our users are on mobile, of which
 * a sizable chunk is iPhone. Without this hint, those users place
 * bets, follow players, get zero pushes, and never know the feature
 * exists.
 *
 * Shown once per device on the home feed after the user has done
 * at least one engagement action (placed a bet or followed a
 * player). Dismissable; permanently sticks to localStorage so it
 * doesn't re-nag.
 *
 * Detection: iOS Safari only, NOT already standalone PWA.
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "pardle_ios_install_hint_dismissed_v1";

interface Props {
  /** Engagement trigger — same as NotificationPrompt. */
  betCount?: number;
  followCount?: number;
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (!isIos) return false;
  // Exclude in-app browsers (Chrome iOS uses 'CriOS', FB 'FBAN', etc).
  if (/CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Line\//.test(ua)) return false;
  return true;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS PWA flag.
  type NavigatorWithStandalone = Navigator & { standalone?: boolean };
  if ((window.navigator as NavigatorWithStandalone).standalone) return true;
  // Generic media-query fallback (Android Chrome PWA, desktop install).
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}

export default function IosInstallHint({
  betCount = 0,
  followCount = 0,
}: Props) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY)) return;
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (betCount === 0 && followCount === 0) return;
    setHidden(false);
  }, [betCount, followCount]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setHidden(true);
  }

  if (hidden) return null;

  return (
    <div className="ios-hint" role="dialog" aria-live="polite">
      <button
        type="button"
        className="ios-hint-dismiss"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
      <div className="ios-hint-body">
        <p className="ios-hint-title">Get pings when your bets move</p>
        <p className="ios-hint-blurb">
          On iPhone, push needs Pardle on your home screen. Tap the
          Share icon{" "}
          <span className="ios-hint-icon" aria-hidden="true">
            ⎙
          </span>{" "}
          in Safari, then <strong>Add to Home Screen</strong>. Takes 5
          seconds.
        </p>
      </div>
    </div>
  );
}
