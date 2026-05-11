"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";

const PLAYER_TOKEN_KEY = "pardle.facesDuel.playerToken";

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

export default function FacesDuelLanding() {
  const router = useRouter();
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : loadChallengerName(),
  );
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
      const res = await fetch("/api/faces-duel/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      try {
        window.localStorage.setItem(
          `pardle.facesDuel.seated.${data.room.roomId}`,
          "0",
        );
      } catch {
        // ignore
      }
      router.push(`/faces/duel/${data.room.roomId}`);
    } catch {
      setError("Network issue — try again.");
      setCreating(false);
    }
  }

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/faces" aria-label="Solo Faces">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Faces Duel</p>
      </header>

      <div className="duel-landing">
        <h2 className="duel-landing-title">
          Race up to 3 friends through 6 blended-face puzzles
        </h2>
        <p className="duel-landing-blurb">
          Each round shows two pros blended into one face. Type a name —
          first to correctly name a pro claims them for 1 point. The other
          pro is still up for grabs. 60 seconds per round. Up to 4 players
          total.
        </p>

        <label className="duel-field">
          <span className="duel-field-label">Your name</span>
          <input
            className="duel-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should your friends see?"
            maxLength={30}
            autoComplete="given-name"
          />
        </label>

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
          You&apos;ll get a shareable URL. Send it to your friends — when
          they all open it, hit start.
        </p>
      </div>

      <footer>
        <p>{BRAND.domain} · Faces Duel · Real-time face-naming race</p>
      </footer>
    </main>
  );
}
