"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import {
  facesPool,
  matchesGolfer,
  pickDailyPair,
  TOTAL_GUESSES,
  type FacesPuzzle,
} from "@/lib/game/faces";
import type { Golfer } from "@/lib/game/types";
import {
  applyMissedDayReset,
  recordResult,
  type PardleStats,
} from "@/lib/streak";
import { NotifySignup } from "@/lib/notify-signup";
import { recordPlayClient } from "@/lib/stats-client";

const GAME_ID = "faces";
const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 11);
const STATE_KEY = "pardle.faces.todayState";

function dayIndexToday(): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24));
}

interface PersistedDayState {
  dayNumber: number;
  /** IDs of pros the player has correctly named so far. */
  solved: string[];
  /** Wrong-guess count (max TOTAL_GUESSES). */
  wrongCount: number;
  /** Final guess history (text + matched id or null), for the share card. */
  history: { text: string; matchedId: string | null }[];
  /** True once the player has used the "emphasise the other face" hint. */
  hintUsed?: boolean;
}

function loadDayState(dayNumber: number): PersistedDayState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDayState;
    if (parsed.dayNumber !== dayNumber) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDayState(state: PersistedDayState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function buildShareText(
  dayNumber: number,
  puzzle: FacesPuzzle,
  solvedIds: string[],
  wrongCount: number,
): string {
  const bothSolved =
    solvedIds.includes(puzzle.left.id) && solvedIds.includes(puzzle.right.id);
  const score = bothSolved
    ? `${wrongCount + 2}/${TOTAL_GUESSES + 2}`
    : `X/${TOTAL_GUESSES + 2}`;
  const leftMark = solvedIds.includes(puzzle.left.id) ? "🟩" : "⬛";
  const rightMark = solvedIds.includes(puzzle.right.id) ? "🟩" : "⬛";
  const wrongRow = "🟥".repeat(wrongCount) + "⬜".repeat(TOTAL_GUESSES - wrongCount);
  return `${BRAND.name} Faces #${dayNumber} ${score}\n${leftMark}${rightMark}\n${wrongRow}\n${BRAND.url}/faces`;
}

export default function FacesPage() {
  const [dayNumber, setDayNumber] = useState<number | null>(null);
  const [puzzle, setPuzzle] = useState<FacesPuzzle | null>(null);
  const [input, setInput] = useState("");
  const [solvedIds, setSolvedIds] = useState<string[]>([]);
  const [wrongCount, setWrongCount] = useState(0);
  const [history, setHistory] = useState<
    { text: string; matchedId: string | null }[]
  >([]);
  const [hintUsed, setHintUsed] = useState(false);
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  /** Brief flash after a wrong guess so the player sees the rejection. */
  const [wrongFlash, setWrongFlash] = useState(false);
  /** Brief flash after a correct guess. */
  const [rightFlash, setRightFlash] = useState<string | null>(null);

  useEffect(() => {
    const day = dayIndexToday() + 1;
    setDayNumber(day);
    setPuzzle(pickDailyPair(day));
    const persisted = loadDayState(day);
    if (persisted) {
      setSolvedIds(persisted.solved);
      setWrongCount(persisted.wrongCount);
      setHistory(persisted.history);
      setHintUsed(!!persisted.hintUsed);
    }
    setStats(applyMissedDayReset(GAME_ID, day));
  }, []);

  const bothSolved =
    puzzle != null &&
    solvedIds.includes(puzzle.left.id) &&
    solvedIds.includes(puzzle.right.id);
  const outOfGuesses = wrongCount >= TOTAL_GUESSES;
  const isOver = puzzle != null && (bothSolved || outOfGuesses);
  const isWin = bothSolved;

  // Suggestion list — filter the pool by the typed text. We use the FULL
  // GOLFERS list (not just the eligible pool) so the player can type any
  // pro's name; the matcher checks against the puzzle's two pros only,
  // so a "wrong" guess against a real pro still costs them a turn.
  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q || isOver) return [];
    return GOLFERS.filter((g) => g.name.toLowerCase().includes(q))
      .filter((g) => !solvedIds.includes(g.id))
      .slice(0, 6);
  }, [input, solvedIds, isOver]);

  // Record stats + streak on completion.
  useEffect(() => {
    if (!isOver || dayNumber == null) return;
    const score = bothSolved ? wrongCount + 2 : 0;
    setStats(recordResult(GAME_ID, dayNumber, bothSolved, score));
    void recordPlayClient({
      game: "faces",
      day: dayNumber,
      isWin: bothSolved,
      score: bothSolved ? wrongCount : 0,
    });
  }, [isOver, dayNumber, bothSolved, wrongCount]);

  function submitGuess(text: string) {
    if (!puzzle || isOver) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    let matchedId: string | null = null;
    if (
      !solvedIds.includes(puzzle.left.id) &&
      matchesGolfer(trimmed, puzzle.left)
    ) {
      matchedId = puzzle.left.id;
    } else if (
      !solvedIds.includes(puzzle.right.id) &&
      matchesGolfer(trimmed, puzzle.right)
    ) {
      matchedId = puzzle.right.id;
    }

    const nextHistory = [...history, { text: trimmed, matchedId }];
    setHistory(nextHistory);
    setInput("");

    if (matchedId) {
      const nextSolved = [...solvedIds, matchedId];
      setSolvedIds(nextSolved);
      setRightFlash(matchedId);
      setTimeout(() => setRightFlash(null), 700);
      saveDayState({
        dayNumber: dayNumber!,
        solved: nextSolved,
        wrongCount,
        history: nextHistory,
        hintUsed,
      });
    } else {
      const nextWrong = wrongCount + 1;
      setWrongCount(nextWrong);
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 400);
      saveDayState({
        dayNumber: dayNumber!,
        solved: solvedIds,
        wrongCount: nextWrong,
        history: nextHistory,
        hintUsed,
      });
    }
  }

  function useHint() {
    if (hintUsed || dayNumber == null) return;
    setHintUsed(true);
    saveDayState({
      dayNumber,
      solved: solvedIds,
      wrongCount,
      history,
      hintUsed: true,
    });
  }

  function pickFromList(g: Golfer) {
    submitGuess(g.name);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length > 0) {
        submitGuess(matches[0].name);
      } else if (input.trim()) {
        submitGuess(input);
      }
    }
  }

  async function handleShare() {
    if (!puzzle || dayNumber == null) return;
    const text = buildShareText(dayNumber, puzzle, solvedIds, wrongCount);
    const nav = navigator as Navigator & {
      share?: (data: { text: string }) => Promise<void>;
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
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1600);
    } catch {
      setShareCopied(false);
    }
  }

  if (!puzzle || dayNumber == null) {
    return (
      <main className="container">
        <header className="brand">
          <Link className="brand-back" href="/" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Faces · loading…</p>
        </header>
      </main>
    );
  }

  const remaining = TOTAL_GUESSES - wrongCount;

  const isLeftSolved = solvedIds.includes(puzzle.left.id);
  const isRightSolved = solvedIds.includes(puzzle.right.id);
  // When the hint is active and exactly one face is solved, fade the
  // identified face down so the unknown one shines through. Once both
  // are solved (or the game is over) we drop back to the default blend
  // so the result screen looks normal.
  const hintActive = hintUsed && !isOver && (isLeftSolved !== isRightSolved);
  let baseOpacity = 1; // left pro
  let overlayOpacity = 0.5; // right pro
  if (hintActive && isLeftSolved) {
    baseOpacity = 0.18;
    overlayOpacity = 0.95;
  } else if (hintActive && isRightSolved) {
    baseOpacity = 1;
    overlayOpacity = 0.12;
  }
  const canUseHint =
    !hintUsed && !isOver && (isLeftSolved !== isRightSolved);

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Faces · Day {dayNumber}</p>
        {stats && stats.current > 0 && (
          <div className="brand-streak" title={`Longest: ${stats.longest}`}>
            <span aria-hidden="true">🔥</span> {stats.current} day
            {stats.current === 1 ? "" : "s"}
          </div>
        )}
      </header>

      <p className="faces-hint">
        Two pros, one blended face. Name them both.
      </p>

      <div
        className={`faces-stage ${wrongFlash ? "faces-stage-wrong" : ""} ${
          isOver ? "faces-stage-over" : ""
        }`}
      >
        {/* Bottom layer — left pro at full opacity. */}
        {puzzle.left.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={puzzle.left.imageUrl}
            alt=""
            className="faces-img faces-img-base"
            style={{ opacity: baseOpacity }}
          />
        )}
        {/* Top layer — right pro at 50% opacity, blended over the bottom. */}
        {puzzle.right.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={puzzle.right.imageUrl}
            alt=""
            className="faces-img faces-img-overlay"
            style={{ opacity: overlayOpacity }}
          />
        )}
        {rightFlash && <div className="faces-flash-right">Got one! ✓</div>}
      </div>

      <div className="faces-slots">
        <div
          className={`faces-slot ${
            solvedIds.includes(puzzle.left.id) ? "faces-slot-solved" : ""
          }`}
        >
          <div className="faces-slot-num">1</div>
          {solvedIds.includes(puzzle.left.id) || isOver ? (
            <>
              {puzzle.left.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="faces-slot-img"
                  src={puzzle.left.imageUrl}
                  alt={puzzle.left.name}
                />
              )}
              <div className="faces-slot-name">{puzzle.left.name}</div>
            </>
          ) : (
            <div className="faces-slot-placeholder">?</div>
          )}
        </div>
        <div
          className={`faces-slot ${
            solvedIds.includes(puzzle.right.id) ? "faces-slot-solved" : ""
          }`}
        >
          <div className="faces-slot-num">2</div>
          {solvedIds.includes(puzzle.right.id) || isOver ? (
            <>
              {puzzle.right.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="faces-slot-img"
                  src={puzzle.right.imageUrl}
                  alt={puzzle.right.name}
                />
              )}
              <div className="faces-slot-name">{puzzle.right.name}</div>
            </>
          ) : (
            <div className="faces-slot-placeholder">?</div>
          )}
        </div>
      </div>

      <div className="faces-guess-meter">
        {Array.from({ length: TOTAL_GUESSES }).map((_, i) => (
          <span
            key={i}
            className={`faces-pip ${
              i < wrongCount ? "faces-pip-used" : "faces-pip-fresh"
            }`}
          />
        ))}
        <span className="faces-guess-text">
          {remaining > 0
            ? `${remaining} wrong guess${remaining === 1 ? "" : "es"} left`
            : "Out of guesses"}
        </span>
      </div>

      {canUseHint && (
        <button
          type="button"
          className="faces-hint-btn"
          onClick={useHint}
        >
          🔍 Hint: emphasise the other face
        </button>
      )}
      {hintUsed && !isOver && (
        <p className="faces-hint-active">
          Hint on — the face you haven&apos;t guessed is in front.
        </p>
      )}

      {!isOver && (
        <div className="input-area">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a player's name..."
            autoComplete="off"
            autoCapitalize="words"
            autoFocus
          />
          {matches.length > 0 && (
            <ul className="suggestions">
              {matches.map((g) => (
                <li key={g.id} onClick={() => pickFromList(g)}>
                  {g.name}{" "}
                  <span className="suggestion-country">{g.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {history.length > 0 && (
        <ul className="faces-history">
          {history.map((h, i) => (
            <li
              key={i}
              className={
                h.matchedId
                  ? "faces-history-right"
                  : "faces-history-wrong"
              }
            >
              <span>{h.text}</span>
              <span aria-hidden="true">{h.matchedId ? "✓" : "✗"}</span>
            </li>
          ))}
        </ul>
      )}

      {isOver && (
        <div className="faces-result">
          <h2 className="faces-result-title">
            {isWin
              ? wrongCount === 0
                ? "Perfect — both on the first try!"
                : `Got 'em in ${wrongCount + 2}`
              : "Not today!"}
          </h2>
          <p className="faces-result-sub">
            Today&apos;s pair was{" "}
            <strong>{puzzle.left.name}</strong> and{" "}
            <strong>{puzzle.right.name}</strong>.
          </p>
          <button className="faces-share" onClick={handleShare}>
            {shareCopied ? "Copied!" : "Share result"}
          </button>
          <Link className="faces-back" href="/">
            ← Play another game
          </Link>
        </div>
      )}

      {isOver && (
        <NotifySignup gameId="faces" dayNumber={dayNumber} />
      )}

      <footer>
        <p>
          {BRAND.domain} · pool of {facesPool().length} recognisable pros
        </p>
      </footer>
    </main>
  );
}
