"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import {
  generateDailyTrivia,
  type DailyTriviaQuestion,
  type TriviaDifficulty,
} from "@/lib/game/trivia";
import {
  applyMissedDayReset,
  type PardleStats,
  recordResult,
} from "@/lib/streak";
import { NotifySignup } from "@/lib/notify-signup";
import { recordPlayClient } from "@/lib/stats-client";

const GAME_ID = "trivia";
const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 11);
const TOTAL_QUESTIONS = 10;

const DIFFICULTY_KEY = "pardle.trivia.difficulty";

/**
 * One persisted state slot PER difficulty so the player can have an
 * in-progress easy puzzle AND an in-progress medium puzzle on the
 * same day without the two clobbering each other.
 */
function stateKey(difficulty: TriviaDifficulty): string {
  return `pardle.trivia.todayState.${difficulty}`;
}

interface PersistedDayState {
  dayNumber: number;
  difficulty: TriviaDifficulty;
  /** Index of currently-displayed question (0..10). 10 = finished. */
  currentIndex: number;
  /** Index of the player's answer per question; -1 if not yet answered. */
  answers: number[];
}

function dayIndexToday(): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24));
}

function loadDifficulty(): TriviaDifficulty {
  if (typeof window === "undefined") return "easy";
  try {
    const stored = window.localStorage.getItem(DIFFICULTY_KEY);
    if (stored === "easy" || stored === "medium" || stored === "hard") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "easy";
}

function saveDifficulty(d: TriviaDifficulty): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    // ignore
  }
}

function loadDayState(
  dayNumber: number,
  difficulty: TriviaDifficulty,
): PersistedDayState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(stateKey(difficulty));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDayState;
    // Same difficulty's state from a PREVIOUS day is stale — start fresh.
    if (parsed.dayNumber !== dayNumber || parsed.difficulty !== difficulty) {
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
    window.localStorage.setItem(
      stateKey(state.difficulty),
      JSON.stringify(state),
    );
  } catch {
    // ignore
  }
}

const DIFFICULTY_ACCENT: Record<TriviaDifficulty, string> = {
  easy: "#7BAE3F",
  medium: "#E8C547",
  hard: "#E07070",
};

function buildShareText(
  dayNumber: number,
  difficulty: TriviaDifficulty,
  answers: number[],
  questions: DailyTriviaQuestion[],
): string {
  const correct = answers.filter(
    (a, i) => a === questions[i].correctIndex,
  ).length;
  const grid = answers
    .map((a, i) => (a === questions[i].correctIndex ? "🟩" : "🟥"))
    .join("");
  const tier =
    difficulty === "easy"
      ? "Easy"
      : difficulty === "medium"
        ? "Medium"
        : "Hard";
  return `${BRAND.name}: Trivia #${dayNumber} (${tier}) ${correct}/${TOTAL_QUESTIONS}\n${grid}\n${BRAND.url}/trivia`;
}

export default function TriviaPage() {
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  const [difficulty, setDifficulty] = useState<TriviaDifficulty>("easy");

  const daily = useMemo(
    () => generateDailyTrivia(dayNumber, difficulty),
    [dayNumber, difficulty],
  );

  // Player's answer for each of the 10 questions, -1 = not yet answered.
  const [answers, setAnswers] = useState<number[]>(() =>
    new Array(TOTAL_QUESTIONS).fill(-1),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const isFinished = currentIndex >= TOTAL_QUESTIONS;
  const currentQ = !isFinished ? daily.questions[currentIndex] : null;
  const playerAnswer = !isFinished ? answers[currentIndex] : -1;
  const hasAnswered = playerAnswer !== -1;

  const correctCount = useMemo(
    () =>
      answers.filter((a, i) => a === daily.questions[i]?.correctIndex).length,
    [answers, daily.questions],
  );

  // Hydrate difficulty + state on mount
  useEffect(() => {
    const d = loadDifficulty();
    setDifficulty(d);
    setStats(applyMissedDayReset(GAME_ID, dayNumber));
    // Initial state restore happens in the difficulty-change effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayNumber]);

  // When difficulty (or day) changes, restore that puzzle's state.
  useEffect(() => {
    const saved = loadDayState(dayNumber, difficulty);
    if (saved) {
      setAnswers(saved.answers);
      setCurrentIndex(saved.currentIndex);
    } else {
      setAnswers(new Array(TOTAL_QUESTIONS).fill(-1));
      setCurrentIndex(0);
    }
    // Intentionally NOT saving here — the save would race with this
    // load when switching difficulties (writing one difficulty's
    // answers into another difficulty's slot before the load resolves).
    // Saves happen imperatively inside pickAnswer / goNext below.
  }, [dayNumber, difficulty]);

  // Record the result the first time the puzzle finishes.
  useEffect(() => {
    if (!isFinished) return;
    const correct = answers.filter(
      (a, i) => a === daily.questions[i].correctIndex,
    ).length;
    // recordResult is idempotent for same day so calling on every
    // re-mount after finishing is fine — only the first call counts.
    setStats(
      recordResult(GAME_ID, dayNumber, correct >= 6, correct),
    );
    void recordPlayClient({
      game: "trivia",
      day: dayNumber,
      isWin: correct >= 6,
      score: correct,
    });
  }, [isFinished, dayNumber, answers, daily.questions]);

  function pickAnswer(optionIndex: number) {
    if (hasAnswered || isFinished) return;
    setAnswers((prev) => {
      const next = prev.slice();
      next[currentIndex] = optionIndex;
      // Persist this difficulty's state immediately. Doing the save
      // inside the action handler (rather than via a useEffect tied
      // to [answers, currentIndex]) avoids the race where switching
      // difficulties briefly writes one slot's data into another's.
      saveDayState({
        dayNumber,
        difficulty,
        currentIndex,
        answers: next,
      });
      return next;
    });
  }

  function goNext() {
    setCurrentIndex((i) => {
      const next = i + 1;
      saveDayState({
        dayNumber,
        difficulty,
        currentIndex: next,
        answers,
      });
      return next;
    });
  }

  function restartDifficulty() {
    const fresh = new Array(TOTAL_QUESTIONS).fill(-1);
    setAnswers(fresh);
    setCurrentIndex(0);
    saveDayState({
      dayNumber,
      difficulty,
      currentIndex: 0,
      answers: fresh,
    });
  }

  function changeDifficulty(d: TriviaDifficulty) {
    if (d === difficulty) return;
    setDifficulty(d);
    saveDifficulty(d);
  }

  async function handleShare() {
    const text = buildShareText(
      dayNumber,
      difficulty,
      answers,
      daily.questions,
    );
    const nav = navigator as Navigator & {
      share?: (data: { text: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ text });
        return;
      } catch {
        // fall through to clipboard
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

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Trivia · Day {dayNumber}</p>
        {stats && stats.current > 0 && (
          <div className="brand-streak" title={`Longest: ${stats.longest}`}>
            <span aria-hidden="true">🔥</span> {stats.current} day
            {stats.current === 1 ? "" : "s"}
          </div>
        )}
      </header>

      <Link
        href="/duel"
        className="trivia-duel-cta"
      >
        ⚔️ Or duel a friend in real-time →
      </Link>

      <div
        className="difficulty-toggle"
        role="tablist"
        aria-label="Difficulty"
      >
        {(["easy", "medium", "hard"] as const).map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={difficulty === d}
            className={`difficulty-toggle-btn ${
              difficulty === d ? "active" : ""
            }`}
            onClick={() => changeDifficulty(d)}
          >
            {d[0].toUpperCase() + d.slice(1)}
            <span className="difficulty-toggle-hint">10 questions</span>
          </button>
        ))}
      </div>

      {!isFinished && currentQ && (
        <div className="trivia-stage">
          <div className="trivia-progress">
            <div className="trivia-progress-text">
              Question {currentIndex + 1} of {TOTAL_QUESTIONS}
              <span className="trivia-score-tag">
                {correctCount} / {currentIndex + (hasAnswered ? 1 : 0)} correct
              </span>
            </div>
            <div className="trivia-progress-bar">
              <div
                className="trivia-progress-bar-fill"
                style={{
                  width: `${
                    ((currentIndex + (hasAnswered ? 1 : 0)) / TOTAL_QUESTIONS) *
                    100
                  }%`,
                  background: DIFFICULTY_ACCENT[difficulty],
                }}
              />
            </div>
          </div>

          <h2 className="trivia-question">{currentQ.q}</h2>

          <div className="trivia-options">
            {currentQ.options.map((opt, idx) => {
              const isCorrect = idx === currentQ.correctIndex;
              const isPicked = idx === playerAnswer;
              let cls = "trivia-option";
              if (hasAnswered) {
                if (isCorrect) cls += " trivia-option-correct";
                else if (isPicked) cls += " trivia-option-wrong";
                else cls += " trivia-option-disabled";
              } else if (isPicked) {
                cls += " trivia-option-picked";
              }
              return (
                <button
                  key={idx}
                  type="button"
                  className={cls}
                  onClick={() => pickAnswer(idx)}
                  disabled={hasAnswered}
                >
                  <span className="trivia-option-letter">
                    {["A", "B", "C", "D"][idx]}
                  </span>
                  <span className="trivia-option-text">{opt}</span>
                  {hasAnswered && isCorrect && (
                    <span className="trivia-option-mark" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {hasAnswered && isPicked && !isCorrect && (
                    <span className="trivia-option-mark" aria-hidden="true">
                      ✗
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {hasAnswered && (
            <div className="trivia-reveal">
              {playerAnswer === currentQ.correctIndex ? (
                <p className="trivia-reveal-text trivia-reveal-correct">
                  Correct!
                </p>
              ) : (
                <p className="trivia-reveal-text trivia-reveal-wrong">
                  Not quite — it was{" "}
                  <strong>
                    {String.fromCharCode(65 + currentQ.correctIndex)}.{" "}
                    {currentQ.options[currentQ.correctIndex]}
                  </strong>
                  .
                </p>
              )}
              {currentQ.fact && (
                <p className="trivia-fact">{currentQ.fact}</p>
              )}
              <button
                type="button"
                className="trivia-next"
                onClick={goNext}
                autoFocus
              >
                {currentIndex === TOTAL_QUESTIONS - 1
                  ? "See result →"
                  : "Next question →"}
              </button>
            </div>
          )}
        </div>
      )}

      {isFinished && (
        <div className="answer-card">
          <h3 className="answer-card-title">
            {correctCount} / {TOTAL_QUESTIONS}
          </h3>
          <p className="answer-card-detail">
            {correctCount === 10
              ? "Perfect round."
              : correctCount >= 8
                ? "Solid round."
                : correctCount >= 5
                  ? "Decent — try a harder tier?"
                  : "Tough one today."}
          </p>

          <div className="trivia-summary">
            {daily.questions.map((q, i) => (
              <span
                key={q.id}
                className={
                  answers[i] === q.correctIndex
                    ? "trivia-summary-cell trivia-summary-correct"
                    : "trivia-summary-cell trivia-summary-wrong"
                }
              >
                {answers[i] === q.correctIndex ? "✓" : "✗"}
              </span>
            ))}
          </div>

          {stats && (
            <p className="answer-card-streak">
              <span aria-hidden="true">🔥</span> Streak: {stats.current}
              {stats.longest > stats.current
                ? ` · Best: ${stats.longest}`
                : ""}
            </p>
          )}

          <div className="answer-buttons">
            <button className="answer-share" onClick={handleShare}>
              {shareCopied ? "Copied!" : "Share result"}
            </button>
            <button
              className="answer-challenge"
              onClick={restartDifficulty}
            >
              Try this tier again
            </button>
          </div>

          <p className="trivia-other-tiers">
            Or try the other tiers:{" "}
            {(["easy", "medium", "hard"] as const)
              .filter((d) => d !== difficulty)
              .map((d) => (
                <button
                  key={d}
                  type="button"
                  className="trivia-tier-link"
                  onClick={() => changeDifficulty(d)}
                >
                  {d}
                </button>
              ))}
          </p>

          <NotifySignup gameId="trivia" dayNumber={dayNumber} />
        </div>
      )}

      <footer>
        <p>
          {BRAND.domain} · Trivia · 10 questions, daily, three difficulties
        </p>
      </footer>
    </main>
  );
}
