"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { generateDailyTrivia } from "@/lib/game/trivia";
import {
  decodeTriviaChallenge,
  encodeTriviaChallenge,
  type TriviaChallengePayload,
} from "@/lib/trivia-challenge";
import {
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";

const TOTAL_QUESTIONS = 10;

/** Anything longer than this is treated as a legacy base64url token,
 *  not a short Redis-backed id. Short ids are typically 6 chars. */
const SHORT_ID_MAX = 12;

const DIFFICULTY_ACCENT: Record<string, string> = {
  easy: "#7BAE3F",
  medium: "#E8C547",
  hard: "#E07070",
};

export default function TriviaChallengePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  // Short ids (≤ SHORT_ID_MAX chars) live in Redis; anything longer is
  // a legacy base64url token we can decode client-side. We try inline
  // decode first (covers legacy + lets the page render without a
  // network round-trip when possible), then fetch from Redis if it's a
  // short id we don't recognise.
  const inlinePayload: TriviaChallengePayload | null = useMemo(() => {
    if (!token || token.length <= SHORT_ID_MAX) return null;
    return decodeTriviaChallenge(token);
  }, [token]);

  const [fetchedPayload, setFetchedPayload] =
    useState<TriviaChallengePayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || token.length > SHORT_ID_MAX) return;
    // Look up the short-id payload from the server.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/trivia-challenge/${token}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(res.status === 404 ? "not_found" : "server");
          return;
        }
        const data = await res.json();
        if (data?.payload) setFetchedPayload(data.payload);
        else setFetchError("not_found");
      } catch {
        if (!cancelled) setFetchError("network");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const payload: TriviaChallengePayload | null =
    inlinePayload ?? fetchedPayload;

  // Friend's name + intro screen state.
  const [intro, setIntro] = useState(true);
  const [friendName, setFriendName] = useState(() =>
    typeof window === "undefined" ? "" : loadChallengerName(),
  );

  const daily = useMemo(() => {
    if (!payload) return null;
    return generateDailyTrivia(payload.n, payload.d);
  }, [payload]);

  // Per-question answers for the *friend* (the person opening the URL).
  const [answers, setAnswers] = useState<number[]>(() =>
    new Array(TOTAL_QUESTIONS).fill(-1),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);

  const isFinished = currentIndex >= TOTAL_QUESTIONS;
  const currentQ = !isFinished && daily ? daily.questions[currentIndex] : null;
  const myAnswer = !isFinished ? answers[currentIndex] : -1;
  const hasAnswered = myAnswer !== -1;
  const myCorrect = useMemo(
    () =>
      answers.filter((a, i) => a === daily?.questions[i]?.correctIndex).length,
    [answers, daily],
  );

  function pickAnswer(option: number) {
    if (hasAnswered || isFinished) return;
    setAnswers((prev) => {
      const next = prev.slice();
      next[currentIndex] = option;
      return next;
    });
  }

  // -2 = "I gave up". Counted as wrong against scoring but distinct
  // from a real pick.
  function giveUp() {
    if (hasAnswered || isFinished) return;
    setAnswers((prev) => {
      const next = prev.slice();
      next[currentIndex] = -2;
      return next;
    });
  }

  function goNext() {
    setCurrentIndex((i) => i + 1);
  }

  function startChallenge() {
    const trimmed = friendName.trim().slice(0, 30);
    if (trimmed) saveChallengerName(trimmed);
    setIntro(false);
  }

  // Re-challenge another friend with the friend's own result.
  async function challengeAnother() {
    if (!payload || !daily) return;
    const myName =
      friendName.trim().slice(0, 30) ||
      loadChallengerName().slice(0, 30) ||
      "Friend";
    const newPayload = {
      d: payload.d,
      n: payload.n,
      p: myName,
      a: answers,
      s: myCorrect,
    };
    // Same short-id-with-base64-fallback path as the original
    // 'Challenge a friend' button on the solo trivia page.
    let url = "";
    try {
      const res = await fetch("/api/trivia-challenge/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPayload),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.id === "string") {
          url = `${BRAND.url}/trivia/c/${data.id}`;
        }
      }
    } catch {
      // ignore — falls through to legacy long token below
    }
    if (!url) {
      const newToken = encodeTriviaChallenge(newPayload);
      url = `${BRAND.url}/trivia/c/${newToken}`;
    }
    const text = `I just played ${BRAND.name} Trivia — ${myCorrect}/${TOTAL_QUESTIONS} on ${payload.d}. Beat me: ${url}`;
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
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }

  if (!payload || !daily) {
    // Still loading a short-id challenge from the server — show a
    // gentle loading state. If the fetch returned not-found / errored,
    // show the not-found state instead.
    const shouldShowError =
      fetchError !== null ||
      (token.length > SHORT_ID_MAX && !inlinePayload);
    return (
      <main className="container pv-theme">
        <header className="brand">
          <Link className="brand-back" href="/games" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
        </header>
        {shouldShowError ? (
          <div className="duel-empty">
            <h2>Challenge not found</h2>
            <p>
              This trivia challenge link couldn&apos;t be read. It may be
              corrupted or have expired (challenges live for 30 days).
            </p>
            <Link href="/trivia" className="duel-cta">
              Play trivia →
            </Link>
          </div>
        ) : (
          <p className="subtitle" style={{ textAlign: "center" }}>
            Loading challenge…
          </p>
        )}
      </main>
    );
  }

  const accent = DIFFICULTY_ACCENT[payload.d] ?? "#7BAE3F";
  const challengerScoreText = `${payload.s}/${TOTAL_QUESTIONS}`;

  // INTRO — friend's first view: who challenged them + start button.
  if (intro) {
    return (
      <main className="container pv-theme">
        <header className="brand">
          <Link className="brand-back" href="/games" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">
            Trivia Challenge ·{" "}
            {payload.d[0].toUpperCase() + payload.d.slice(1)}
          </p>
        </header>

        <div className="share-card challenge-card">
          <div className="challenge-card-from">A challenge from</div>
          <div className="challenge-card-name" style={{ color: accent }}>
            {payload.p || "A friend"}
          </div>
          <div className="challenge-card-detail">
            scored <strong style={{ color: accent }}>{challengerScoreText}</strong>{" "}
            on the {payload.d} trivia.
          </div>
        </div>

        <p className="trivia-c-intro">
          Play the same 10 questions. After each one you&apos;ll see what{" "}
          <strong>{payload.p || "they"}</strong> picked — and whether they got
          it right.
        </p>

        <label className="duel-field">
          <span className="duel-field-label">Your name (optional)</span>
          <input
            className="duel-input"
            type="text"
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            maxLength={30}
            placeholder={`What should ${payload.p || "they"} see if you challenge back?`}
            autoComplete="given-name"
          />
        </label>

        <button
          type="button"
          className="duel-cta"
          onClick={startChallenge}
        >
          Start the challenge →
        </button>

        <footer>
          <p>{BRAND.domain} · Trivia Challenge</p>
        </footer>
      </main>
    );
  }

  // ACTIVE QUESTION
  if (!isFinished && currentQ) {
    return (
      <main className="container pv-theme">
        <header className="brand">
          <Link className="brand-back" href="/games" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">
            Trivia · vs {payload.p || "challenger"}
          </p>
        </header>

        <div className="duel-scoreboard duel-scoreboard-2">
          <div className="duel-scoreboard-player duel-scoreboard-me">
            <div className="duel-scoreboard-name">You</div>
            <div className="duel-scoreboard-score">{myCorrect}</div>
          </div>
          <div className="duel-scoreboard-player">
            <div className="duel-scoreboard-name">{payload.p || "Challenger"}</div>
            <div className="duel-scoreboard-score">{payload.s}</div>
          </div>
        </div>

        <div className="trivia-stage">
          <div className="trivia-progress">
            <div className="trivia-progress-text">
              Question {currentIndex + 1} of {TOTAL_QUESTIONS}
            </div>
            <div className="trivia-progress-bar">
              <div
                className="trivia-progress-bar-fill"
                style={{
                  width: `${((currentIndex + (hasAnswered ? 1 : 0)) / TOTAL_QUESTIONS) * 100}%`,
                  background: accent,
                }}
              />
            </div>
          </div>

          <h2 className="trivia-question">{currentQ.q}</h2>

          <div className="trivia-options">
            {currentQ.options.map((opt, idx) => {
              const isCorrect = idx === currentQ.correctIndex;
              const isMine = idx === myAnswer;
              // Challenger's pick for this question:
              const theirAnswer = payload.a[currentIndex];
              const isTheirs = idx === theirAnswer;

              let cls = "trivia-option";
              if (hasAnswered) {
                if (isCorrect) cls += " trivia-option-correct";
                else if (isMine) cls += " trivia-option-wrong";
                else cls += " trivia-option-disabled";
              } else if (isMine) {
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
                  {/* Only show the challenger's tag AFTER you've answered. */}
                  {hasAnswered && isTheirs && (
                    <span className="duel-tag duel-tag-them">
                      {payload.p || "them"}
                    </span>
                  )}
                  {hasAnswered && isMine && (
                    <span className="duel-tag duel-tag-me">you</span>
                  )}
                </button>
              );
            })}
          </div>

          {!hasAnswered && (
            <button
              type="button"
              className="trivia-giveup-btn"
              onClick={giveUp}
            >
              I don&apos;t know — show me
            </button>
          )}

          {hasAnswered && (() => {
            const myWasCorrect = myAnswer === currentQ.correctIndex;
            const myGaveUp = myAnswer === -2;
            const theirAnswer = payload.a[currentIndex];
            const theirCorrect = theirAnswer === currentQ.correctIndex;
            const theirText =
              theirAnswer === -1
                ? `${payload.p || "They"} didn't answer this one.`
                : theirAnswer === -2
                  ? `${payload.p || "They"} gave up too.`
                  : theirCorrect
                    ? `${payload.p || "They"} also got it right.`
                    : `${payload.p || "They"} picked ${String.fromCharCode(65 + theirAnswer)} — wrong.`;

            return (
              <div className="trivia-reveal">
                {myWasCorrect ? (
                  <p className="trivia-reveal-text trivia-reveal-correct">
                    Correct!
                  </p>
                ) : myGaveUp ? (
                  <p className="trivia-reveal-text trivia-reveal-wrong">
                    No worries — it was{" "}
                    <strong>
                      {String.fromCharCode(65 + currentQ.correctIndex)}.{" "}
                      {currentQ.options[currentQ.correctIndex]}
                    </strong>
                    .
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
                <p className="trivia-c-versus">{theirText}</p>
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
            );
          })()}
        </div>

        <footer>
          <p>{BRAND.domain} · Trivia Challenge</p>
        </footer>
      </main>
    );
  }

  // FINISHED — comparison scorecard
  const iWon = myCorrect > payload.s;
  const tied = myCorrect === payload.s;

  return (
    <main className="container pv-theme">
      <header className="brand">
        <Link className="brand-back" href="/games" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Trivia Challenge · Result</p>
      </header>

      <div className="answer-card">
        <h3 className="answer-card-title">
          {iWon && `You beat ${payload.p || "them"}!`}
          {tied && "It's a tie."}
          {!iWon && !tied && `${payload.p || "They"} won this one.`}
        </h3>
        <p className="answer-card-detail">
          {myCorrect}/{TOTAL_QUESTIONS} vs {payload.s}/{TOTAL_QUESTIONS}
        </p>

        <div className="trivia-c-comparison">
          <div className="trivia-c-row">
            <span className="trivia-c-row-label">You</span>
            <div className="trivia-c-row-grid">
              {daily.questions.map((q, i) => (
                <span
                  key={`me-${i}`}
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
          </div>
          <div className="trivia-c-row">
            <span className="trivia-c-row-label">
              {payload.p || "Challenger"}
            </span>
            <div className="trivia-c-row-grid">
              {daily.questions.map((q, i) => (
                <span
                  key={`them-${i}`}
                  className={
                    payload.a[i] === q.correctIndex
                      ? "trivia-summary-cell trivia-summary-correct"
                      : "trivia-summary-cell trivia-summary-wrong"
                  }
                >
                  {payload.a[i] === q.correctIndex ? "✓" : "✗"}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="answer-buttons">
          <button className="answer-share" onClick={challengeAnother}>
            {shareCopied ? "Copied!" : "Challenge another friend"}
          </button>
          <Link href="/trivia" className="answer-challenge">
            Play today&apos;s Trivia
          </Link>
        </div>
      </div>

      <footer>
        <p>{BRAND.domain} · Trivia Challenge</p>
      </footer>
    </main>
  );
}
