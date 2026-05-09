"use client";

import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import { revealGuess } from "@/lib/game/reveal";
import {
  type AttributeReveal,
  type Golfer,
  type GuessReveal,
  MAX_GUESSES,
} from "@/lib/game/types";

const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 9);

function pickMysteryGolfer(): Golfer {
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayIndex = Math.floor(
    (todayUTC - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24),
  );
  const safeIndex =
    ((dayIndex % GOLFERS.length) + GOLFERS.length) %
    GOLFERS.length;
  return GOLFERS[safeIndex];
}

function flagFor(countryCode: string): string {
  const cc = countryCode.includes("-")
    ? countryCode.split("-")[0]
    : countryCode;
  if (cc.length !== 2) return "🏳️";
  return cc
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

function heightDisplay(cm: number): string {
  const totalInches = cm / 2.54;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - ft * 12);
  return `${ft}'${inches}" / ${cm}cm`;
}

function arrowSymbol(arrow: AttributeReveal["arrow"]): string {
  if (arrow === "up") return "↑";
  if (arrow === "down") return "↓";
  return "";
}

export default function Page() {
  const mystery = useMemo(() => pickMysteryGolfer(), []);
  const [guesses, setGuesses] = useState<GuessReveal[]>([]);
  const [input, setInput] = useState("");

  const isWin = guesses.some((g) => g.isWin);
  const isLose = !isWin && guesses.length >= MAX_GUESSES;
  const isOver = isWin || isLose;

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return GOLFERS.filter((g) => g.name.toLowerCase().includes(q))
      .filter((g) => !guesses.some((gu) => gu.golfer.id === g.id))
      .slice(0, 6);
  }, [input, guesses]);

  function submitGuess(g: Golfer) {
    if (isOver) return;
    setGuesses((prev) => [...prev, revealGuess(g, mystery)]);
    setInput("");
  }

  return (
    <main className="container">
      <header className="brand">
        <h1>{BRAND.name}</h1>
        <p className="subtitle">{BRAND.tagline}</p>
      </header>

      <div className="grid">
        <div className="header-row">
          <span>Flag</span>
          <span>Age</span>
          <span>Height</span>
          <span>Majors</span>
          <span>Wins</span>
          <span>Pro</span>
        </div>

        {guesses.map((g, i) => (
          <div key={i} className="guess">
            <div className="guess-name">{g.golfer.name}</div>
            <div className="guess-cells">
              <span className={`cell cell-${g.country.state}`}>
                {flagFor(g.golfer.countryCode)}
              </span>
              <span className={`cell cell-${g.age.state}`}>
                {g.golfer.age}
                {arrowSymbol(g.age.arrow)}
              </span>
              <span
                className={`cell cell-${g.height.state}`}
                title={heightDisplay(g.golfer.heightCm)}
              >
                {g.golfer.heightCm}
                {arrowSymbol(g.height.arrow)}
              </span>
              <span className={`cell cell-${g.majors.state}`}>
                {g.golfer.majors}
                {arrowSymbol(g.majors.arrow)}
              </span>
              <span className={`cell cell-${g.pgaTourWins.state}`}>
                {g.golfer.pgaTourWins}
                {arrowSymbol(g.pgaTourWins.arrow)}
              </span>
              <span className={`cell cell-${g.turnedProYear.state}`}>
                {g.golfer.turnedProYear}
                {arrowSymbol(g.turnedProYear.arrow)}
              </span>
            </div>
          </div>
        ))}

        {Array.from({ length: MAX_GUESSES - guesses.length }).map((_, i) => (
          <div key={`empty-${i}`} className="guess empty-guess">
            <div className="guess-cells">
              {Array.from({ length: 6 }).map((_, j) => (
                <span key={j} className="cell cell-empty" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {!isOver && (
        <div className="input-area">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a player's name..."
            autoComplete="off"
            autoCapitalize="words"
          />
          {matches.length > 0 && (
            <ul className="suggestions">
              {matches.map((g) => (
                <li key={g.id} onClick={() => submitGuess(g)}>
                  {g.name}{" "}
                  <span className="suggestion-country">{g.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isWin && (
        <p className="result win">
          You got it in {guesses.length}/{MAX_GUESSES}!
        </p>
      )}
      {isLose && (
        <p className="result lose">
          Out of guesses. The answer was {mystery.name}.
        </p>
      )}

      <footer>
        <p>
          {BRAND.domain} · {GOLFERS.length} pros in the database
        </p>
      </footer>
    </main>
  );
}
