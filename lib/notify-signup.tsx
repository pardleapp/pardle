"use client";

import { useState } from "react";

// Formspree endpoint — posts hit pardle.app@gmail.com via Formspree's
// dashboard, no backend required on our side. 50 submissions/month on
// the free tier, plenty for early validation. Migrate to a real
// broadcast service (Resend audience + Vercel cron) once we're
// actually sending the daily reminder.
const FORMSPREE_URL = "https://formspree.io/f/mlgzaeze";

// Subscription is tracked per-game so a user who said yes on Pros
// still sees the prompt on Holes / Clubhouses / Connections. Each
// game's signup gives us an extra confirmed lead and a signal about
// which game converted them.
function subscribedKey(gameId: string): string {
  return `pardle.notifySubscribed.${gameId}`;
}

interface Props {
  gameId: "pros" | "holes" | "clubs" | "connections";
  dayNumber: number;
}

type State =
  | { tag: "hidden" }      // already subscribed for *this* game
  | { tag: "init" }        // form visible, awaiting input
  | { tag: "submitting" }
  | { tag: "success" }
  | { tag: "error" }
  | { tag: "dismissed" };

function readSubscribed(gameId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(subscribedKey(gameId)) === "true";
  } catch {
    return false;
  }
}

function markSubscribed(gameId: string): void {
  try {
    window.localStorage.setItem(subscribedKey(gameId), "true");
  } catch {
    // ignore — user blocking localStorage, signup still hit Formspree
  }
}

export function NotifySignup({ gameId, dayNumber }: Props) {
  const [state, setState] = useState<State>(() =>
    readSubscribed(gameId) ? { tag: "hidden" } : { tag: "init" },
  );
  const [email, setEmail] = useState("");

  if (state.tag === "hidden" || state.tag === "dismissed") return null;

  if (state.tag === "success") {
    return (
      <p className="notify-success">
        <span aria-hidden="true">✉️</span> You&apos;re in. See you tomorrow.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) return;
    setState({ tag: "submitting" });
    try {
      const res = await fetch(FORMSPREE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: trimmed,
          _replyto: trimmed,
          _subject: `Pardle notify signup — ${gameId} #${dayNumber}`,
          game: gameId,
          dayNumber,
          source: "answer-card",
        }),
      });
      if (res.ok) {
        markSubscribed(gameId);
        setState({ tag: "success" });
      } else {
        setState({ tag: "error" });
      }
    } catch {
      setState({ tag: "error" });
    }
  }

  const submitting = state.tag === "submitting";

  return (
    <div className="notify-signup">
      <p className="notify-prompt">
        Get a reminder when tomorrow&apos;s puzzles drop?
      </p>
      <form onSubmit={handleSubmit} className="notify-form">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          required
          aria-label="Email address"
        />
        <button type="submit" disabled={submitting || !email.includes("@")}>
          {submitting ? "..." : "Notify me"}
        </button>
      </form>
      <button
        type="button"
        className="notify-dismiss"
        onClick={() => setState({ tag: "dismissed" })}
      >
        No thanks
      </button>
      {state.tag === "error" && (
        <p className="notify-error">
          Couldn&apos;t save that — try again in a moment.
        </p>
      )}
    </div>
  );
}
