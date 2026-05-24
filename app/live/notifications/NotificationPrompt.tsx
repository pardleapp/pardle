"use client";

import { useEffect, useState } from "react";
import { useNotifications } from "./useNotifications";

const STORAGE_KEY = "pardle_notif_prompt_seen_v1";

interface Props {
  /** Bumped by the parent whenever a new bet is added — one of the
   *  triggers for showing the prompt the first time. */
  betCount?: number;
  /** Bumped by the parent whenever a new follow is added — the other
   *  trigger. Either bets OR follows above zero opens the nudge. */
  followCount?: number;
  /** Optional list of playerIds the device is currently following.
   *  Sent to the server when the user accepts so the cron can address
   *  followed-player events from the first poll after subscribe. */
  follows?: string[];
}

/**
 * One-time bottom-sheet asking the user to enable push notifications
 * after they've either placed their first bet or followed their first
 * player. Shown once per device; the dismissal is recorded in
 * localStorage so it never reappears even if the user denies the
 * browser-level prompt.
 *
 * Renders nothing if push isn't supported, already enabled, already
 * dismissed, or neither trigger has fired yet.
 */
export default function NotificationPrompt({
  betCount = 0,
  followCount = 0,
  follows,
}: Props) {
  const { state, enable } = useNotifications();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY)) {
      setHidden(true);
      return;
    }
    const triggered = betCount > 0 || followCount > 0;
    if (
      triggered &&
      state.supported &&
      state.permission === "default" &&
      !state.subscribed &&
      !state.loading
    ) {
      setHidden(false);
    }
  }, [betCount, followCount, state]);

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setHidden(true);
  }

  async function turnOn() {
    const ok = await enable({ follows });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    setHidden(true);
    if (!ok && state.permission === "denied") {
      // Browser-level denial — nothing more we can do.
    }
  }

  if (hidden) return null;

  // Copy adapts to which trigger fired. If both bets AND follows are
  // present, lead with bets (the higher-stakes use case). Pure-follow
  // path gets player-centric wording so the value prop's obvious.
  const betLed = betCount > 0;
  const title = betLed
    ? "Get notified when your bet moves"
    : "Get pinged when your players light up";
  const blurb = betLed
    ? "Big swings and settlement only — never spam."
    : "Birdies, eagles, blow-ups, putts about to drop. Off-tab, on-time.";

  return (
    <div className="notif-prompt" role="dialog" aria-live="polite">
      <div className="notif-prompt-body">
        <div className="notif-prompt-emoji" aria-hidden="true">
          🔔
        </div>
        <div className="notif-prompt-text">
          <p className="notif-prompt-title">{title}</p>
          <p className="notif-prompt-blurb">{blurb}</p>
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
