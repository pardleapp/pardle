"use client";

import { useEffect, useState } from "react";
import { useNotifications } from "./useNotifications";

const STORAGE_KEY = "pardle_notif_prompt_seen_v1";

interface Props {
  /** Bumped by the parent whenever a new bet is added — the trigger
   *  for showing the prompt the first time. */
  betCount: number;
}

/**
 * One-time bottom-sheet asking the user to enable push notifications
 * after they've placed their first bet. Shown once per device; the
 * dismissal is recorded in localStorage so it never reappears even
 * if the user denies the browser-level prompt.
 *
 * Renders nothing if push isn't supported, already enabled, already
 * dismissed, or the user has no bets yet.
 */
export default function NotificationPrompt({ betCount }: Props) {
  const { state, enable } = useNotifications();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY)) {
      setHidden(true);
      return;
    }
    if (
      betCount > 0 &&
      state.supported &&
      state.permission === "default" &&
      !state.subscribed &&
      !state.loading
    ) {
      setHidden(false);
    }
  }, [betCount, state]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setHidden(true);
  }

  async function turnOn() {
    const ok = await enable();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setHidden(true);
    if (!ok && state.permission === "denied") {
      // Browser-level denial — nothing more we can do.
    }
  }

  if (hidden) return null;

  return (
    <div className="notif-prompt" role="dialog" aria-live="polite">
      <div className="notif-prompt-body">
        <div className="notif-prompt-emoji" aria-hidden="true">
          🔔
        </div>
        <div className="notif-prompt-text">
          <p className="notif-prompt-title">Get notified when your bet moves</p>
          <p className="notif-prompt-blurb">
            We&apos;ll only ping you on big swings or when it settles —
            never spam.
          </p>
        </div>
      </div>
      <div className="notif-prompt-actions">
        <button
          type="button"
          className="notif-prompt-dismiss"
          onClick={dismiss}
        >
          Not now
        </button>
        <button
          type="button"
          className="notif-prompt-enable"
          onClick={turnOn}
          disabled={state.loading}
        >
          {state.loading ? "…" : "Turn on"}
        </button>
      </div>
    </div>
  );
}
