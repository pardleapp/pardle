"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { GOLFERS } from "@/lib/data/golfers";
import {
  facesPool,
  headshotUrl,
  matchesGolfer,
  pickPuzzleSet,
  PUZZLES_PER_DAY,
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

const PROS_PER_DAY = PUZZLES_PER_DAY * 2; // 12

function dayIndexToday(): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24));
}

interface PerPuzzleState {
  /** IDs of pros named so far in this puzzle (0..2). */
  solved: string[];
  /** Number of wrong guesses (0..TOTAL_GUESSES). */
  wrongCount: number;
  hintUsed: boolean;
  history: { text: string; matchedId: string | null }[];
}

interface PersistedDayState {
  dayNumber: number;
  /** 0..PUZZLES_PER_DAY — `=== PUZZLES_PER_DAY` means all 6 are done. */
  currentIndex: number;
  /** Length-PUZZLES_PER_DAY array, one state slot per puzzle. */
  puzzles: PerPuzzleState[];
}

function freshPuzzleState(): PerPuzzleState {
  return { solved: [], wrongCount: 0, hintUsed: false, history: [] };
}

function freshDayState(dayNumber: number): PersistedDayState {
  return {
    dayNumber,
    currentIndex: 0,
    puzzles: Array.from({ length: PUZZLES_PER_DAY }, freshPuzzleState),
  };
}

function loadDayState(dayNumber: number): PersistedDayState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDayState;
    if (parsed.dayNumber !== dayNumber) return null;
    // Tolerate older single-puzzle persistence — if the shape doesn't
    // match the new schema, start fresh.
    if (!Array.isArray(parsed.puzzles) || parsed.puzzles.length !== PUZZLES_PER_DAY) {
      return null;
    }
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

/**
 * Total pros correctly named across all 6 puzzles (0..12).
 */
function totalCorrect(state: PersistedDayState): number {
  return state.puzzles.reduce((acc, p) => acc + p.solved.length, 0);
}

/** Share grid: one row per puzzle, 2 squares each (left / right pro). */
function buildShareText(
  dayNumber: number,
  puzzles: FacesPuzzle[],
  state: PersistedDayState,
): string {
  const correct = totalCorrect(state);
  const rows = puzzles
    .map((puz, i) => {
      const s = state.puzzles[i];
      const l = s.solved.includes(puz.left.id) ? "🟩" : "⬛";
      const r = s.solved.includes(puz.right.id) ? "🟩" : "⬛";
      return l + r;
    })
    .join("\n");
  return `${BRAND.name} Faces #${dayNumber} ${correct}/${PROS_PER_DAY}\n${rows}\n${BRAND.url}/faces`;
}

export default function FacesPage() {
  const [dayNumber, setDayNumber] = useState<number | null>(null);
  const [puzzles, setPuzzles] = useState<FacesPuzzle[] | null>(null);
  const [day, setDay] = useState<PersistedDayState | null>(null);
  const [input, setInput] = useState("");
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [rightFlash, setRightFlash] = useState<string | null>(null);

  useEffect(() => {
    const dn = dayIndexToday() + 1;
    setDayNumber(dn);
    setPuzzles(pickPuzzleSet({ seed: dn }));
    setDay(loadDayState(dn) ?? freshDayState(dn));
    setStats(applyMissedDayReset(GAME_ID, dn));
  }, []);

  const currentIndex = day?.currentIndex ?? 0;
  const isFinished =
    day != null && currentIndex >= PUZZLES_PER_DAY;
  const currentPuzzle =
    puzzles && !isFinished ? puzzles[currentIndex] : null;
  const currentState = day && !isFinished ? day.puzzles[currentIndex] : null;

  const isLeftSolved =
    currentState && currentPuzzle
      ? currentState.solved.includes(currentPuzzle.left.id)
      : false;
  const isRightSolved =
    currentState && currentPuzzle
      ? currentState.solved.includes(currentPuzzle.right.id)
      : false;
  const bothSolved = isLeftSolved && isRightSolved;
  const outOfGuesses =
    !!currentState && currentState.wrongCount >= TOTAL_GUESSES;
  const puzzleOver = !!currentState && (bothSolved || outOfGuesses);

  const matches = useMemo(() => {
    if (!currentState || !currentPuzzle) return [];
    const q = input.trim().toLowerCase();
    if (!q || puzzleOver) return [];
    return GOLFERS.filter((g) => g.name.toLowerCase().includes(q))
      .filter((g) => !currentState.solved.includes(g.id))
      .slice(0, 6);
  }, [input, currentState, currentPuzzle, puzzleOver]);

  // Record stats + streak on finish.
  useEffect(() => {
    if (!isFinished || day == null || dayNumber == null) return;
    const correct = totalCorrect(day);
    // "Win" threshold = 8/12 — feels right for a hard recognition task.
    // Used for the streak bonus; doesn't affect the displayed score.
    const won = correct >= 8;
    setStats(recordResult(GAME_ID, dayNumber, won, correct));
    void recordPlayClient({
      game: "faces",
      day: dayNumber,
      isWin: won,
      score: correct,
    });
  }, [isFinished, day, dayNumber]);

  function mutateCurrent(fn: (p: PerPuzzleState) => PerPuzzleState) {
    if (!day) return;
    const next: PersistedDayState = {
      ...day,
      puzzles: day.puzzles.map((p, i) =>
        i === day.currentIndex ? fn(p) : p,
      ),
    };
    setDay(next);
    saveDayState(next);
  }

  function submitGuess(text: string) {
    if (!currentPuzzle || !currentState || puzzleOver) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    let matchedId: string | null = null;
    if (
      !currentState.solved.includes(currentPuzzle.left.id) &&
      matchesGolfer(trimmed, currentPuzzle.left)
    ) {
      matchedId = currentPuzzle.left.id;
    } else if (
      !currentState.solved.includes(currentPuzzle.right.id) &&
      matchesGolfer(trimmed, currentPuzzle.right)
    ) {
      matchedId = currentPuzzle.right.id;
    }

    setInput("");

    mutateCurrent((p) => {
      const nextHistory = [...p.history, { text: trimmed, matchedId }];
      if (matchedId) {
        setRightFlash(matchedId);
        setTimeout(() => setRightFlash(null), 700);
        return {
          ...p,
          solved: [...p.solved, matchedId],
          history: nextHistory,
        };
      }
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 400);
      return {
        ...p,
        wrongCount: p.wrongCount + 1,
        history: nextHistory,
      };
    });
  }

  function useHint() {
    if (!currentState || currentState.hintUsed) return;
    mutateCurrent((p) => ({ ...p, hintUsed: true }));
  }

  function advancePuzzle() {
    if (!day) return;
    const next: PersistedDayState = {
      ...day,
      currentIndex: Math.min(day.currentIndex + 1, PUZZLES_PER_DAY),
    };
    setDay(next);
    saveDayState(next);
    setInput("");
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
    if (!puzzles || !day || dayNumber == null) return;
    const text = buildShareText(dayNumber, puzzles, day);
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

  if (!puzzles || !day || dayNumber == null) {
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

  // ---------- FINISHED SCREEN ----------
  if (isFinished) {
    const correct = totalCorrect(day);
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

        <div className="faces-result">
          <h2 className="faces-result-title">
            {correct === PROS_PER_DAY
              ? "Perfect — all 12!"
              : correct >= 8
                ? `Strong round — ${correct}/${PROS_PER_DAY}`
                : `You got ${correct}/${PROS_PER_DAY}`}
          </h2>
          <p className="faces-result-sub">Today&apos;s blended pros:</p>

          <div className="faces-recap">
            {puzzles.map((puz, i) => {
              const s = day.puzzles[i];
              return (
                <div key={i} className="faces-recap-row">
                  <span className="faces-recap-num">{i + 1}</span>
                  <ProTag
                    pro={puz.left}
                    solved={s.solved.includes(puz.left.id)}
                  />
                  <ProTag
                    pro={puz.right}
                    solved={s.solved.includes(puz.right.id)}
                  />
                </div>
              );
            })}
          </div>

          <button className="faces-share" onClick={handleShare}>
            {shareCopied ? "Copied!" : "Share result"}
          </button>
          <div className="faces-result-links">
            <Link className="faces-back" href="/faces/duel">
              ⚔️ Race friends in a Faces Duel →
            </Link>
            <Link className="faces-back" href="/">
              ← Play another game
            </Link>
          </div>
        </div>

        <NotifySignup gameId="faces" dayNumber={dayNumber} />

        <footer>
          <p>
            {BRAND.domain} · pool of {facesPool().length} recognisable pros
          </p>
        </footer>
      </main>
    );
  }

  // ---------- ACTIVE PUZZLE ----------
  // Hint opacity calculation — only one face is solved.
  const hintActive =
    !!currentState &&
    currentState.hintUsed &&
    !puzzleOver &&
    isLeftSolved !== isRightSolved;
  let baseOpacity = 1;
  let overlayOpacity = 0.5;
  if (hintActive && isLeftSolved) {
    baseOpacity = 0.55;
    overlayOpacity = 0.62;
  } else if (hintActive && isRightSolved) {
    baseOpacity = 1;
    overlayOpacity = 0.25;
  }
  const canUseHint =
    !!currentState &&
    !currentState.hintUsed &&
    !puzzleOver &&
    isLeftSolved !== isRightSolved;
  const remaining = TOTAL_GUESSES - (currentState?.wrongCount ?? 0);
  const isLastPuzzle = currentIndex === PUZZLES_PER_DAY - 1;
  const completedSoFar = day.puzzles.reduce(
    (acc, p, i) => (i < currentIndex ? acc + p.solved.length : acc),
    0,
  );

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

      <Link href="/faces/duel" className="trivia-duel-cta">
        ⚔️ Or race a friend in a live Faces Duel →
      </Link>

      <div className="faces-progress">
        <div className="faces-progress-text">
          Puzzle {currentIndex + 1} of {PUZZLES_PER_DAY}
          <span className="trivia-score-tag">
            {completedSoFar + (currentState?.solved.length ?? 0)} /{" "}
            {PROS_PER_DAY} so far
          </span>
        </div>
        <div className="trivia-progress-bar">
          <div
            className="trivia-progress-bar-fill"
            style={{
              width: `${(currentIndex / PUZZLES_PER_DAY) * 100}%`,
              background: "#E07B5B",
            }}
          />
        </div>
      </div>

      {currentPuzzle && (
        <>
          <div
            className={`faces-stage ${wrongFlash ? "faces-stage-wrong" : ""} ${
              puzzleOver ? "faces-stage-over" : ""
            }`}
          >
            {headshotUrl(currentPuzzle.left) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headshotUrl(currentPuzzle.left)!}
                alt=""
                className="faces-img faces-img-base"
                style={{ opacity: baseOpacity }}
              />
            )}
            {headshotUrl(currentPuzzle.right) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headshotUrl(currentPuzzle.right)!}
                alt=""
                className="faces-img faces-img-overlay"
                style={{ opacity: overlayOpacity }}
              />
            )}
            {rightFlash && (
              <div className="faces-flash-right">Got one! ✓</div>
            )}
          </div>

          <div className="faces-slots">
            <div
              className={`faces-slot ${
                isLeftSolved ? "faces-slot-solved" : ""
              }`}
            >
              <div className="faces-slot-num">1</div>
              {isLeftSolved || puzzleOver ? (
                <>
                  {headshotUrl(currentPuzzle.left) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="faces-slot-img"
                      src={headshotUrl(currentPuzzle.left)!}
                      alt={currentPuzzle.left.name}
                    />
                  )}
                  <div className="faces-slot-name">
                    {currentPuzzle.left.name}
                  </div>
                </>
              ) : (
                <div className="faces-slot-placeholder">?</div>
              )}
            </div>
            <div
              className={`faces-slot ${
                isRightSolved ? "faces-slot-solved" : ""
              }`}
            >
              <div className="faces-slot-num">2</div>
              {isRightSolved || puzzleOver ? (
                <>
                  {headshotUrl(currentPuzzle.right) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="faces-slot-img"
                      src={headshotUrl(currentPuzzle.right)!}
                      alt={currentPuzzle.right.name}
                    />
                  )}
                  <div className="faces-slot-name">
                    {currentPuzzle.right.name}
                  </div>
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
                  i < (currentState?.wrongCount ?? 0)
                    ? "faces-pip-used"
                    : "faces-pip-fresh"
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
          {currentState?.hintUsed && !puzzleOver && (
            <p className="faces-hint-active">
              Hint on — the face you haven&apos;t guessed is in front.
            </p>
          )}

          {!puzzleOver && (
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

          {currentState && currentState.history.length > 0 && (
            <ul className="faces-history">
              {currentState.history.map((h, i) => (
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

          {puzzleOver && (
            <div className="faces-next-row">
              <p className="faces-next-blurb">
                {bothSolved
                  ? `Nice — both named in ${
                      (currentState?.wrongCount ?? 0) + 2
                    }.`
                  : `Out of guesses.`}
              </p>
              <button className="faces-next-btn" onClick={advancePuzzle}>
                {isLastPuzzle ? "See your score →" : "Next puzzle →"}
              </button>
            </div>
          )}
        </>
      )}

      <footer>
        <p>
          {BRAND.domain} · {PUZZLES_PER_DAY} blended pairs per day
        </p>
      </footer>
    </main>
  );
}

function ProTag({ pro, solved }: { pro: Golfer; solved: boolean }) {
  const headshot = headshotUrl(pro);
  return (
    <div className={`faces-recap-pro ${solved ? "faces-recap-solved" : ""}`}>
      {headshot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={headshot} alt={pro.name} />
      )}
      <span className="faces-recap-name">{pro.name}</span>
      <span className="faces-recap-mark">{solved ? "✓" : "—"}</span>
    </div>
  );
}
