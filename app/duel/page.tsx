"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";
import type { TriviaDifficulty } from "@/lib/data/trivia";

const PLAYER_TOKEN_KEY = "pardle.duel.playerToken";

function getOrCreatePlayerToken(): string {
  if (typeof window === "undefined") return "";
  try {
    let t = window.localStorage.getItem(PLAYER_TOKEN_KEY);
    if (!t) {
      t =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem(PLAYER_TOKEN_KEY, t);
    }
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export default function DuelLandingPage() {
  const router = useRouter();
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : loadChallengerName(),
  );
  const [difficulty, setDifficulty] = useState<TriviaDifficulty>("medium");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) {
      setError("Enter your name first.");
      return;
    }
    saveChallengerName(trimmed);
    setCreating(true);
    try {
      const res = await fetch("/api/duel/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty,
          hostToken: getOrCreatePlayerToken(),
          hostName: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.room?.roomId) {
        setError("Couldn't create a duel — try again in a moment.");
        setCreating(false);
        return;
      }
      // Mark the host as seated in slot 0 before navigating so the
      // room page skips the 'You've been challenged' join screen
      // (which only makes sense for joiners). Slot is stored as a
      // numeric string to match the multi-player room page format.
      try {
        window.localStorage.setItem(
          `pardle.duel.seated.${data.room.roomId}`,
          "0",
        );
      } catch {
        // ignore — the room page will fall back to detecting our slot
        // by name on the next poll
      }
      router.push(`/duel/${data.room.roomId}`);
    } catch {
      setError("Network issue — try again.");
      setCreating(false);
    }
  }

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Trivia Duel</p>
      </header>

      <div className="duel-landing">
        <h2 className="duel-landing-title">
          Race up to 3 friends through 10 trivia questions
        </h2>
        <p className="duel-landing-blurb">
          First to click the correct answer wins the question. Click a
          wrong answer and you&apos;re out for that question — anyone
          left can still steal it. Best of 10 wins the duel. Up to 4
          players total.
        </p>

        <label className="duel-field">
          <span className="duel-field-label">Your name</span>
          <input
            className="duel-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should your friend see?"
            maxLength={30}
            autoComplete="given-name"
          />
        </label>

        <div className="duel-field">
          <span className="duel-field-label">Difficulty</span>
          <div className="difficulty-toggle" role="tablist" aria-label="Difficulty">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={difficulty === d}
                className={`difficulty-toggle-btn ${
                  difficulty === d ? "active" : ""
                }`}
                onClick={() => setDifficulty(d)}
              >
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="duel-error">{error}</p>}

        <button
          type="button"
          className="duel-cta"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? "Creating duel..." : "Create duel & share link →"}
        </button>

        <p className="duel-landing-footnote">
          You&apos;ll get a shareable URL. Send it to one friend — when
          they open it the duel starts.
        </p>
      </div>

      <footer>
        <p>{BRAND.domain} · Trivia Duel · Real-time golf trivia race</p>
      </footer>
    </main>
  );
}
