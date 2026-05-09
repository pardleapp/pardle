"use client";

import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import { revealGuess } from "@/lib/game/reveal";
import {
  type AttributeReveal,
  type CellState,
  type Golfer,
  type GuessReveal,
  MAX_GUESSES,
} from "@/lib/game/types";

const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 9);

function dayIndexToday(): number {
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((todayUTC - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24));
}

function pickMysteryGolfer(): Golfer {
  const dayIndex = dayIndexToday();
  const safeIndex =
    ((dayIndex % GOLFERS.length) + GOLFERS.length) % GOLFERS.length;
  return GOLFERS[safeIndex];
}

function stateToEmoji(state: CellState): string {
  if (state === "green") return "🟩";
  if (state === "warm" || state === "yellow") return "🟨";
  return "⬛";
}

function buildShareText(
  guesses: GuessReveal[],
  dayNumber: number,
  won: boolean,
): string {
  const result = won ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const grid = guesses
    .map((g) =>
      [
        stateToEmoji(g.country.state),
        stateToEmoji(g.age.state),
        stateToEmoji(g.height.state),
        stateToEmoji(g.majors.state),
        stateToEmoji(g.pgaTourWins.state),
        stateToEmoji(g.ryderCup.state),
      ].join(""),
    )
    .join("\n");
  return `${BRAND.name} #${dayNumber} ${result}\n${grid}\n${BRAND.domain}`;
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

function Arrow({ arrow }: { arrow: AttributeReveal["arrow"] }) {
  if (!arrow) return null;
  return <span className="arrow">{arrow === "up" ? "▲" : "▼"}</span>;
}

const CONFETTI_COLORS = ["#7BAE3F", "#B5D332", "#E8C547", "#5BA0E0", "#E07B5B"];

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }).map((_, i) => (
        <span
          key={i}
          className="confetto"
          style={{
            left: `${(i * 100) / 36 + (Math.sin(i) * 4)}%`,
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 8) * 0.05}s`,
            animationDuration: `${1.4 + (i % 4) * 0.2}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function ResultModal({
  isWin,
  mystery,
  guesses,
  dayNumber,
  onClose,
}: {
  isWin: boolean;
  mystery: Golfer;
  guesses: GuessReveal[];
  dayNumber: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareText = useMemo(
    () => buildShareText(guesses, dayNumber, isWin),
    [guesses, dayNumber, isWin],
  );

  async function handleShare() {
    const nav = navigator as Navigator & {
      share?: (data: { text: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ text: shareText });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-card ${isWin ? "modal-win" : "modal-lose"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {isWin && <Confetti />}
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        {mystery.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mystery.imageUrl}
            alt={mystery.name}
            className="modal-photo"
          />
        ) : (
          <div className="modal-photo modal-photo-placeholder">
            {flagFor(mystery.countryCode)}
          </div>
        )}
        <h2 className="modal-title">
          {isWin ? "Birdie! 🏌️" : "Out of guesses"}
        </h2>
        <p className="modal-name">
          {flagFor(mystery.countryCode)} {mystery.name}
        </p>
        <p className="modal-stats">
          Age {mystery.age} ·{" "}
          {mystery.majors > 0 && `${mystery.majors} majors · `}
          {mystery.pgaTourWins} PGA wins
          {mystery.ryderCup !== null && ` · ${mystery.ryderCup} Ryder Cups`}
        </p>
        <p className="modal-guess-count">
          {isWin
            ? `Solved in ${guesses.length}/${MAX_GUESSES}`
            : `${MAX_GUESSES}/${MAX_GUESSES} — better luck tomorrow`}
        </p>
        <button className="modal-share" onClick={handleShare}>
          {copied ? "Copied to clipboard!" : "Share result"}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  const mystery = useMemo(() => pickMysteryGolfer(), []);
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  const [guesses, setGuesses] = useState<GuessReveal[]>([]);
  const [input, setInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const isWin = guesses.some((g) => g.isWin);
  const isLose = !isWin && guesses.length >= MAX_GUESSES;
  const isOver = isWin || isLose;

  // Auto-open the modal once when the game ends.
  useEffect(() => {
    if (isOver) {
      const t = setTimeout(() => setModalOpen(true), 350);
      return () => clearTimeout(t);
    }
  }, [isOver]);

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
          <span>Country</span>
          <span>Age</span>
          <span>Height</span>
          <span>Majors</span>
          <span>Wins</span>
          <span title="Ryder Cup appearances">
            Ryder
            <br />
            Cup
          </span>
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
                <Arrow arrow={g.age.arrow} />
              </span>
              <span
                className={`cell cell-${g.height.state}`}
                title={heightDisplay(g.golfer.heightCm)}
              >
                {g.golfer.heightCm}
                <Arrow arrow={g.height.arrow} />
              </span>
              <span className={`cell cell-${g.majors.state}`}>
                {g.golfer.majors}
                <Arrow arrow={g.majors.arrow} />
              </span>
              <span className={`cell cell-${g.pgaTourWins.state}`}>
                {g.golfer.pgaTourWins}
                <Arrow arrow={g.pgaTourWins.arrow} />
              </span>
              <span
                className={`cell cell-${g.ryderCup.state}`}
                title={
                  g.golfer.ryderCup === null
                    ? "Not eligible for Ryder Cup"
                    : `${g.golfer.ryderCup} Ryder Cup appearances`
                }
              >
                {g.golfer.ryderCup === null ? "—" : g.golfer.ryderCup}
                <Arrow arrow={g.ryderCup.arrow} />
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

      {isOver && !modalOpen && (
        <button
          className="reopen-result"
          onClick={() => setModalOpen(true)}
        >
          View result
        </button>
      )}

      {isOver && modalOpen && (
        <ResultModal
          isWin={isWin}
          mystery={mystery}
          guesses={guesses}
          dayNumber={dayNumber}
          onClose={() => setModalOpen(false)}
        />
      )}

      <footer>
        <p>
          {BRAND.domain} · {GOLFERS.length} pros in the database
        </p>
      </footer>
    </main>
  );
}
