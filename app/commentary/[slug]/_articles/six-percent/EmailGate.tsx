"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { READER_COOKIE, READER_MAX_AGE } from "./reader";

/**
 * Email gate for long-form analysis pieces.
 *
 * Posts to the same Formspree endpoint the daily-puzzle signup uses, so
 * every lead lands in one inbox and we don't need a backend or any
 * populated env vars to collect them. See lib/notify-signup.tsx.
 *
 * On success we set READER_COOKIE and call router.refresh(), which
 * re-runs the server component — this time with the gated half of the
 * article included in the response.
 */
const FORMSPREE_URL = "https://formspree.io/f/mlgzaeze";

interface Props {
  /** Slug of the article being unlocked, recorded against the lead. */
  article: string;
  /** Headline on the gate card. */
  heading: string;
  /** One-line pitch under the heading. */
  sub: string;
  /** Bullets naming what is behind the gate. */
  gets: string[];
}

type State = "init" | "submitting" | "error";

export default function EmailGate({ article, heading, sub, gets }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("init");

  function unlock() {
    try {
      document.cookie =
        `${READER_COOKIE}=1; Max-Age=${READER_MAX_AGE}; Path=/; SameSite=Lax`;
    } catch {
      // Cookies blocked — refresh below will simply re-render the gate.
    }
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes("@")) return;
    setState("submitting");
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
          _subject: `Pardle article unlock — ${article}`,
          article,
          source: "article-gate",
        }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      unlock();
    } catch {
      setState("error");
    }
  }

  const submitting = state === "submitting";

  return (
    <>
      <div className="fade" aria-hidden="true" />
      <section className="gate" aria-labelledby="gate-heading">
        <div className="eyebrow">Keep reading</div>
        <h3 id="gate-heading">{heading}</h3>
        <p className="sub">{sub}</p>
        <ul>
          {gets.map((g) => (
            <li key={g}>
              <span className="tick" aria-hidden="true">
                &#10003;
              </span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleSubmit}>
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
            {submitting ? "…" : "Read the rest"}
          </button>
        </form>
        <p className="fine">
          One email address, no account, no card. We send the week&rsquo;s
          analysis and nothing else &mdash; unsubscribe whenever you like.
        </p>
        {state === "error" && (
          <p className="err">
            Couldn&rsquo;t save that &mdash; try again in a moment.
          </p>
        )}
      </section>
    </>
  );
}
