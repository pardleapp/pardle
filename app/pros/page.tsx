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
import {
  applyMissedDayReset,
  hasSeenTutorial,
  markTutorialSeen,
  migrateLegacyStats,
  type PardleStats,
  recordResult,
} from "@/lib/streak";
import {
  type ChallengePayload,
  type ChallengeScore,
  decodeChallenge,
  encodeChallenge,
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";
import { NotifySignup } from "@/lib/notify-signup";
import { encodeGridPros, encodeShareCard } from "@/lib/share-card";
import { recordPlayClient } from "@/lib/stats-client";
import { searchableName } from "@/lib/text";
import { pgaTourHeadshotUrl } from "@/lib/data/pga-tour-ids";

const GAME_ID = "pros";

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

// Hash-derived rotation offset so launch-day doesn't land on whichever
// golfer happens to be GOLFERS[0|1|2] in tier order. Bump the version
// suffix to reshuffle the rotation any time.
function rotationOffset(): number {
  const key = "pardle-pros-v2";
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickMysteryGolfer(): Golfer {
  const dayIndex = dayIndexToday() + rotationOffset();
  const safeIndex =
    ((dayIndex % GOLFERS.length) + GOLFERS.length) % GOLFERS.length;
  return GOLFERS[safeIndex];
}

function stateToEmoji(state: CellState): string {
  if (state === "green") return "🟩";
  if (state === "warm" || state === "yellow") return "🟨";
  return "⬛";
}

// Placeholder percentile mapping — these are static "feel-right" numbers
// shown until we have a backend aggregating real per-puzzle stats.
// TODO: replace with real percentile from Vercel KV (or similar) once wired.
const PLACEHOLDER_PERCENTILE: Record<number, number> = {
  1: 99,
  2: 92,
  3: 78,
  4: 55,
  5: 30,
  6: 12,
};

function placeholderPercentile(guessCount: number): number | null {
  return PLACEHOLDER_PERCENTILE[guessCount] ?? null;
}

function buildShare(
  guesses: GuessReveal[],
  dayNumber: number,
  won: boolean,
): { text: string; url: string } {
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
  const encodedGrid = encodeGridPros(
    guesses.map((g) => [
      g.country.state,
      g.age.state,
      g.height.state,
      g.majors.state,
      g.pgaTourWins.state,
      g.ryderCup.state,
    ]),
  );
  const token = encodeShareCard({
    g: "pros",
    d: dayNumber,
    s: result,
    r: encodedGrid,
  });
  const url = `${BRAND.url}/r/${token}`;
  return {
    text: `${BRAND.name} #${dayNumber} ${result}\n${grid}\n${url}`,
    url,
  };
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

function PlayerWalker({ golfer }: { golfer: Golfer }) {
  return (
    <div className="walker-stage">
      <div className="walker">
        <div className="walker-figure">
          {/* Shadow on the ground that scales with the bob */}
          <div className="walker-shadow" />
          {/* Body, legs and arms — drawn as an SVG so leg-swing pivots
              correctly. The torso is intentionally generic; the player's
              face on top is what gives the figure identity. */}
          <svg
            viewBox="0 0 140 240"
            className="walker-body"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Neck */}
            <rect x="63" y="0" width="14" height="14" fill="#f0c48a" />

            {/* Polo shirt */}
            <path
              d="M 40 14 Q 40 8 50 8 L 60 8 Q 70 22 80 8 L 90 8 Q 100 8 100 14 L 105 90 Q 105 100 95 100 L 45 100 Q 35 100 35 90 Z"
              fill="#ffffff"
              stroke="#aaa"
              strokeWidth="1"
            />
            {/* Collar */}
            <path
              d="M 60 8 L 70 22 L 80 8 L 76 8 L 70 16 L 64 8 Z"
              fill="#7BAE3F"
            />

            {/* Belt */}
            <rect x="40" y="100" width="60" height="6" fill="#2a2a2a" />

            {/* Shorts / trousers */}
            <path
              d="M 40 106 L 70 106 L 70 158 L 56 158 Z"
              fill="#4a4a4a"
            />
            <path
              d="M 70 106 L 100 106 L 84 158 L 70 158 Z"
              fill="#4a4a4a"
            />

            {/* Left leg (anatomical right) — pivots from the hip */}
            <g className="walker-leg walker-leg-left">
              <line
                x1="58"
                y1="158"
                x2="56"
                y2="210"
                stroke="#f0c48a"
                strokeWidth="11"
                strokeLinecap="round"
              />
              {/* Shoe */}
              <ellipse cx="54" cy="216" rx="11" ry="5" fill="#1a1a1a" />
            </g>

            {/* Right leg */}
            <g className="walker-leg walker-leg-right">
              <line
                x1="82"
                y1="158"
                x2="84"
                y2="210"
                stroke="#f0c48a"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <ellipse cx="86" cy="216" rx="11" ry="5" fill="#1a1a1a" />
            </g>

            {/* Left arm */}
            <g className="walker-arm walker-arm-left">
              <line
                x1="40"
                y1="22"
                x2="22"
                y2="76"
                stroke="#ffffff"
                strokeWidth="11"
                strokeLinecap="round"
              />
              {/* Hand */}
              <circle cx="22" cy="80" r="5" fill="#f0c48a" />
            </g>

            {/* Right arm holding a club */}
            <g className="walker-arm walker-arm-right">
              <line
                x1="100"
                y1="22"
                x2="118"
                y2="76"
                stroke="#ffffff"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <circle cx="118" cy="80" r="5" fill="#f0c48a" />
              {/* Golf club shaft */}
              <line
                x1="118"
                y1="80"
                x2="128"
                y2="200"
                stroke="#c8c8c8"
                strokeWidth="2"
              />
              {/* Club head */}
              <ellipse cx="128" cy="202" rx="6" ry="3" fill="#888" />
            </g>
          </svg>

          {/* Player's actual face sits on top of the body as the head.
              Prefer PGA Tour Cloudinary (face-cropped, always loads
              consistently) over the Wikipedia thumbnail. Falls back to
              the country flag only if neither is available. */}
          <div className="walker-head">
            {(() => {
              const url = pgaTourHeadshotUrl(golfer.id) ?? golfer.imageUrl;
              if (!url) {
                return (
                  <div className="walker-head-placeholder">
                    {flagFor(golfer.countryCode)}
                  </div>
                );
              }
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={golfer.name} />
              );
            })()}
            <div className="walker-tear" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 60 }).map((_, i) => (
        <span
          key={i}
          className="confetto"
          style={{
            left: `${(i * 100) / 60 + (Math.sin(i * 1.7) * 6)}%`,
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${1.2 + (i % 10) * 0.05}s`,
            animationDuration: `${2 + (i % 5) * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}

function TutorialModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay tutorial-overlay" onClick={onClose}>
      <div className="tutorial-card" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 className="tutorial-title">How to play {BRAND.name}</h2>
        <p className="tutorial-lead">
          Guess today&apos;s mystery pro golfer in 6 tries.
        </p>
        <ul className="tutorial-list">
          <li>
            Each guess reveals match status on six attributes: country, age,
            height, majors won, PGA Tour wins, and Ryder Cup appearances.
          </li>
          <li>
            <span className="legend-cell legend-green" /> Green = exact
            match.
          </li>
          <li>
            <span className="legend-cell legend-warm" /> Lime + small arrow =
            very close, with the arrow showing direction.
          </li>
          <li>
            <span className="legend-cell legend-yellow" /> Yellow + arrow =
            in the ballpark.
          </li>
          <li>
            <span className="legend-cell legend-grey" /> Grey = far off.
          </li>
          <li>
            New mystery golfer at midday local time. Solve every day to keep
            your streak alive.
          </li>
        </ul>
        <button className="tutorial-go" onClick={onClose}>
          Let&apos;s play
        </button>
      </div>
    </div>
  );
}

function compareWithFriend(
  myScore: ChallengeScore,
  friendScore: ChallengeScore,
  friendName: string,
): { line: string; outcome: "win" | "lose" | "tie" } {
  if (myScore === "X" && friendScore === "X") {
    return { line: `Both stumped by today's puzzle.`, outcome: "tie" };
  }
  if (myScore === "X") {
    return {
      line: `${friendName} beat you — they got it in ${friendScore}/${MAX_GUESSES}.`,
      outcome: "lose",
    };
  }
  if (friendScore === "X") {
    return {
      line: `You beat ${friendName} — they didn't solve it.`,
      outcome: "win",
    };
  }
  if (myScore < friendScore) {
    return {
      line: `You beat ${friendName} by ${friendScore - myScore}!`,
      outcome: "win",
    };
  }
  if (myScore > friendScore) {
    return {
      line: `${friendName} beat you by ${myScore - friendScore}.`,
      outcome: "lose",
    };
  }
  return { line: `Tied with ${friendName}.`, outcome: "tie" };
}

function ResultModal({
  isWin,
  mystery,
  guesses,
  dayNumber,
  stats,
  challenge,
  onClose,
}: {
  isWin: boolean;
  mystery: Golfer;
  guesses: GuessReveal[];
  dayNumber: number;
  stats: PardleStats | null;
  challenge: ChallengePayload | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [challengeCopied, setChallengeCopied] = useState(false);
  const share = useMemo(
    () => buildShare(guesses, dayNumber, isWin),
    [guesses, dayNumber, isWin],
  );
  const shareText = share.text;
  const shareUrl = share.url;

  const myScore: ChallengeScore = isWin ? guesses.length : "X";
  const friendName = challenge?.challengerName || "your friend";
  const versus = challenge
    ? compareWithFriend(myScore, challenge.score, friendName)
    : null;

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

  async function handleChallenge() {
    const existingName = loadChallengerName();
    let name = existingName;
    if (!name) {
      const entered = window.prompt(
        "What name should your friend see? (Optional — leave blank for none)",
      );
      if (entered !== null) {
        const trimmed = entered.trim().slice(0, 30);
        if (trimmed) {
          saveChallengerName(trimmed);
          name = trimmed;
        }
      }
    }
    const token = encodeChallenge({
      dayNumber,
      score: myScore,
      challengerName: name || undefined,
      game: "pros",
    });
    const url = `${BRAND.url}/c/${token}`;
    const text = isWin
      ? `I solved today's ${BRAND.name} in ${guesses.length}/${MAX_GUESSES}. Beat me: ${url}`
      : `I couldn't crack today's ${BRAND.name}. Your turn: ${url}`;

    const nav = navigator as Navigator & {
      share?: (data: { text: string; url?: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ text });
        return;
      } catch {
        // fall through
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setChallengeCopied(true);
      setTimeout(() => setChallengeCopied(false), 1800);
    } catch {
      setChallengeCopied(false);
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
        <h2 className="modal-title">
          {isWin ? "Birdie!" : "Out of guesses"}
        </h2>
        <PlayerWalker golfer={mystery} />
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
        {isWin && placeholderPercentile(guesses.length) !== null && (
          <p className="modal-percentile">
            Better than {placeholderPercentile(guesses.length)}% of players
          </p>
        )}
        {versus && (
          <p className={`modal-versus modal-versus-${versus.outcome}`}>
            {versus.line}
          </p>
        )}
        {stats && (
          <p className="modal-streak">
            <span aria-hidden="true">🔥</span> Streak: {stats.current}
            {stats.longest > stats.current
              ? ` · Best: ${stats.longest}`
              : ""}
          </p>
        )}
        <button className="modal-share" onClick={handleShare}>
          {copied ? "Copied!" : "Share result"}
        </button>
        <a
          className="modal-save"
          href={`${shareUrl}/opengraph-image`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Save image
        </a>
        <button className="modal-challenge" onClick={handleChallenge}>
          {challengeCopied ? "Challenge copied!" : "Challenge a friend"}
        </button>
        <NotifySignup gameId="pros" dayNumber={dayNumber} />
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
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null);

  const isWin = guesses.some((g) => g.isWin);
  const isLose = !isWin && guesses.length >= MAX_GUESSES;
  const isOver = isWin || isLose;

  // Initialise stats, check tutorial, decode any incoming challenge link.
  useEffect(() => {
    migrateLegacyStats();
    setStats(applyMissedDayReset(GAME_ID, dayNumber));
    if (!hasSeenTutorial(GAME_ID)) {
      setTutorialOpen(true);
    }
    try {
      const code = new URLSearchParams(window.location.search).get("c");
      if (code) {
        const decoded = decodeChallenge(code);
        if (decoded) setChallenge(decoded);
      }
    } catch {
      // ignore — no challenge param
    }
  }, [dayNumber]);

  const challengeIsForToday =
    challenge !== null && challenge.dayNumber === dayNumber;
  const challengeIsExpired =
    challenge !== null && challenge.dayNumber !== dayNumber;

  // Record the result and refresh streak the moment the game ends.
  useEffect(() => {
    if (!isOver) return;
    const updated = recordResult(GAME_ID, dayNumber, isWin, guesses.length);
    setStats(updated);
    void recordPlayClient({
      game: "pros",
      day: dayNumber,
      isWin,
      score: guesses.length,
    });
    const t = setTimeout(() => setModalOpen(true), 350);
    return () => clearTimeout(t);
  }, [isOver, isWin, dayNumber, guesses.length]);

  const matches = useMemo(() => {
    const q = searchableName(input.trim());
    if (!q) return [];
    return GOLFERS.filter((g) => searchableName(g.name).includes(q))
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
      {challengeIsForToday && (
        <div className="challenge-banner">
          <span aria-hidden="true">🏌️</span>{" "}
          <strong>{challenge?.challengerName || "A friend"}</strong> got
          today&apos;s {BRAND.name} in{" "}
          <strong>
            {challenge?.score}/{MAX_GUESSES}
          </strong>
          . Beat them!
        </div>
      )}
      {challengeIsExpired && (
        <div className="challenge-banner challenge-expired">
          That challenge link is from a different day — here&apos;s today&apos;s
          puzzle.
        </div>
      )}

      <header className="brand">
        <a className="brand-back" href="/" aria-label="All games">
          ←
        </a>
        <button
          className="brand-help"
          onClick={() => setTutorialOpen(true)}
          aria-label="How to play"
          title="How to play"
        >
          ?
        </button>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Pros · Daily golfer guess</p>
        {stats && stats.current > 0 && (
          <div className="brand-streak" title={`Longest: ${stats.longest}`}>
            <span aria-hidden="true">🔥</span> {stats.current} day
            {stats.current === 1 ? "" : "s"}
          </div>
        )}
      </header>

      <div className="grid">
        <div className="header-row">
          <span>Country</span>
          <span>Age</span>
          <span>Height</span>
          <span>Majors</span>
          <span>Wins</span>
          <span title="Ryder Cup appearances">
            Ryder Cup
            <br />
            Appearances
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
          stats={stats}
          challenge={challengeIsForToday ? challenge : null}
          onClose={() => setModalOpen(false)}
        />
      )}

      {tutorialOpen && (
        <TutorialModal
          onClose={() => {
            markTutorialSeen(GAME_ID);
            setTutorialOpen(false);
          }}
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
