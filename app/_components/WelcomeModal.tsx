"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "pardle.welcomeSeen";

interface GameExplainer {
  emoji: string;
  name: string;
  blurb: string;
  accent: string;
}

const EXPLAINERS: GameExplainer[] = [
  {
    emoji: "🏌️",
    name: "Pros",
    blurb: "Six guesses to identify the mystery PGA Tour pro.",
    accent: "#7BAE3F",
  },
  {
    emoji: "🛰️",
    name: "Holes",
    blurb: "Identify the famous course from a satellite view.",
    accent: "#5BA0E0",
  },
  {
    emoji: "🏛️",
    name: "Clubhouses",
    blurb: "Name the course from its clubhouse silhouette.",
    accent: "#E0A85B",
  },
  {
    emoji: "🧩",
    name: "Connections",
    blurb: "Find four groups of four golf-related items.",
    accent: "#B388D6",
  },
];

export function WelcomeModal() {
  // Default to hidden so SSR doesn't flash the modal — we flip it
  // open after mount once we've checked localStorage.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== "1") {
        setOpen(true);
      }
    } catch {
      // localStorage blocked — just show the modal once per session
      setOpen(true);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="welcome-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={dismiss}
    >
      <div
        className="welcome-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="welcome-close"
          aria-label="Close"
          onClick={dismiss}
        >
          ×
        </button>

        <h2 id="welcome-title" className="welcome-title">
          Welcome to Pardle
        </h2>
        <p className="welcome-tagline">
          Daily golf puzzles. New every day at midnight.
        </p>

        <ul className="welcome-list">
          {EXPLAINERS.map((g) => (
            <li key={g.name} className="welcome-item">
              <span className="welcome-emoji">{g.emoji}</span>
              <span className="welcome-text">
                <strong style={{ color: g.accent }}>{g.name}</strong>
                <span className="welcome-blurb">{g.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="welcome-howit">
          <div className="welcome-howit-label">How it works</div>
          <ul className="welcome-howit-list">
            <li>One puzzle per game, same for everyone, refreshed daily.</li>
            <li>Each guess reveals colour-coded clues.</li>
            <li>Share your result to challenge friends.</li>
            <li>Play every day to build a streak.</li>
          </ul>
        </div>

        <button
          type="button"
          className="welcome-cta"
          onClick={dismiss}
        >
          Let&apos;s play →
        </button>
      </div>
    </div>
  );
}
