"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";

const PLAYER_TOKEN_KEY = "pardle.duel.playerToken";

interface PublicQuestion {
  id: string;
  q: string;
  options: [string, string, string, string];
  correct: number | null;
  fact: string | null;
  state: {
    p1Answer: number | null;
    p2Answer: number | null;
    p1Correct: boolean | null;
    p2Correct: boolean | null;
    resolved: boolean;
    winner: "p1" | "p2" | "none" | null;
    resolvedAt: number | null;
  };
}

interface PublicPlayer {
  name: string;
  score: number;
}

interface PublicRoom {
  roomId: string;
  difficulty: "easy" | "medium" | "hard";
  p1: PublicPlayer | null;
  p2: PublicPlayer | null;
  status: "waiting" | "active" | "finished";
  currentQuestionIndex: number;
  questions: PublicQuestion[];
  startedAt: number | null;
  finishedAt: number | null;
}

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

const POLL_MS = 1000;

export default function DuelGamePage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId ?? "";
  const playerToken = useMemo(() => getOrCreatePlayerToken(), []);

  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Synchronously hydrate seated slot from localStorage on first render
  // so the host (who set the marker before navigating here) doesn't
  // see a flash of the 'You've been challenged' join screen meant
  // for p2.
  const [seated, setSeated] = useState<"p1" | "p2" | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = window.localStorage.getItem(
        `pardle.duel.seated.${roomId}`,
      );
      if (v === "p1" || v === "p2") return v;
    } catch {
      // ignore
    }
    return null;
  });
  const [joinName, setJoinName] = useState(() =>
    typeof window === "undefined" ? "" : loadChallengerName(),
  );
  const [joinError, setJoinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Determine which slot we own from the room data (by name match — token
  // is server-private). We track seated state ourselves below as well.
  // The most reliable test is to ask the server: did our token match?
  // Easier: when fetching state we know it succeeded if room is non-null
  // and one of p1/p2 has our name AND we've called join before.

  const fetchState = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(`/api/duel/${roomId}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setFetchError("not_found");
        return;
      }
      const data = await res.json();
      if (data.room) setRoom(data.room);
    } catch {
      // best-effort poll; will retry next tick
    }
  }, [roomId]);

  // Initial load.
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Polling loop. Don't poll once we know we're not seated yet (we
  // still want one poll to load the room initially, then the join
  // flow runs; after seated, resume polling).
  useEffect(() => {
    if (!roomId) return;
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [roomId, fetchState]);

  // Try to figure out which slot we are. The server's /join endpoint
  // returns the room with our slot filled in; we then compare names.
  // Since playerToken is private, easiest seat-detection is to attempt
  // a join — the server returns the room with us in a slot.
  useEffect(() => {
    if (!roomId || !room || seated) return;
    // If we've already seated ourselves through join, that path sets
    // seated. Otherwise — try to detect from cached state.
    // We don't have token visibility, so the most robust is: if our
    // localStorage saved 'joined as' marker exists for this room.
    try {
      const marker = window.localStorage.getItem(
        `pardle.duel.seated.${roomId}`,
      );
      if (marker === "p1" || marker === "p2") {
        setSeated(marker);
      }
    } catch {
      // ignore
    }
  }, [roomId, room, seated]);

  async function handleJoin() {
    setJoinError(null);
    const trimmed = joinName.trim().slice(0, 30);
    if (!trimmed) {
      setJoinError("Enter your name first.");
      return;
    }
    saveChallengerName(trimmed);
    try {
      const res = await fetch(`/api/duel/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken,
          playerName: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.room) {
        setJoinError(
          data.error === "room_full_or_missing"
            ? "Room is full or doesn't exist."
            : "Couldn't join — try again.",
        );
        return;
      }
      setRoom(data.room);
      // Figure out which slot we landed in by name match.
      const r: PublicRoom = data.room;
      if (r.p1?.name === trimmed) {
        setSeated("p1");
        try {
          window.localStorage.setItem(`pardle.duel.seated.${roomId}`, "p1");
        } catch {}
      } else if (r.p2?.name === trimmed) {
        setSeated("p2");
        try {
          window.localStorage.setItem(`pardle.duel.seated.${roomId}`, "p2");
        } catch {}
      }
    } catch {
      setJoinError("Network issue — try again.");
    }
  }

  async function handleAnswer(answerIndex: number) {
    if (!room || !seated || submitting) return;
    if (room.status !== "active") return;
    const idx = room.currentQuestionIndex;
    const q = room.questions[idx];
    // Don't double-submit
    const mine = seated === "p1" ? q.state.p1Answer : q.state.p2Answer;
    if (mine !== null) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/duel/${roomId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken,
          questionIndex: idx,
          answerIndex,
        }),
      });
      const data = await res.json();
      if (res.ok && data.room) setRoom(data.room);
    } catch {
      // ignore — poll will catch up
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInviteLink() {
    const url = `${BRAND.url}/duel/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }

  async function shareInvite() {
    if (!room?.p1) return;
    const url = `${BRAND.url}/duel/${roomId}`;
    const text = `${room.p1.name} is challenging you to a Pardle Trivia Duel! 10 questions, fastest correct answer wins. Click to play:`;
    const nav = navigator as Navigator & {
      share?: (data: { text: string; url?: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ text: `${text} ${url}` });
        return;
      } catch {
        // fall through
      }
    }
    copyInviteLink();
  }

  if (fetchError === "not_found") {
    return (
      <main className="container">
        <header className="brand">
          <Link className="brand-back" href="/" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
        </header>
        <div className="duel-empty">
          <h2>Duel not found</h2>
          <p>
            This duel link has expired or never existed. Duels live for
            one hour.
          </p>
          <Link href="/duel" className="duel-cta">
            Create a new duel →
          </Link>
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="container">
        <header className="brand">
          <Link className="brand-back" href="/" aria-label="All games">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Trivia Duel · Loading…</p>
        </header>
      </main>
    );
  }

  const isHost = seated === "p1";
  const me = seated === "p1" ? room.p1 : seated === "p2" ? room.p2 : null;
  const them = seated === "p1" ? room.p2 : seated === "p2" ? room.p1 : null;
  const needsToJoin = !seated && room.status === "waiting" && !room.p2;
  const cannotJoin = !seated && (room.status !== "waiting" || !!room.p2);

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">
          Trivia Duel · {room.difficulty[0].toUpperCase() + room.difficulty.slice(1)}
        </p>
      </header>

      {/* SCOREBOARD — shown once seated */}
      {seated && (
        <div className="duel-scoreboard">
          <div className={`duel-scoreboard-player ${seated === "p1" ? "duel-scoreboard-me" : ""}`}>
            <div className="duel-scoreboard-name">{room.p1?.name ?? "—"}</div>
            <div className="duel-scoreboard-score">{room.p1?.score ?? 0}</div>
          </div>
          <div className="duel-scoreboard-vs">vs</div>
          <div className={`duel-scoreboard-player ${seated === "p2" ? "duel-scoreboard-me" : ""}`}>
            <div className="duel-scoreboard-name">{room.p2?.name ?? "Waiting…"}</div>
            <div className="duel-scoreboard-score">{room.p2?.score ?? 0}</div>
          </div>
        </div>
      )}

      {/* WAITING for friend (host view) */}
      {seated && room.status === "waiting" && (
        <div className="duel-waiting">
          <h2>Waiting for your friend…</h2>
          <p>Share this link. The duel starts the moment they tap it.</p>
          <div className="duel-link-row">
            <code className="duel-link">{`${BRAND.url}/duel/${roomId}`}</code>
          </div>
          <div className="duel-share-buttons">
            <button
              type="button"
              className="duel-cta duel-cta-share"
              onClick={shareInvite}
            >
              Share invite
            </button>
            <button
              type="button"
              className="duel-cta-secondary"
              onClick={copyInviteLink}
            >
              {shareCopied ? "Copied!" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      {/* JOIN as p2 — visitor flow */}
      {needsToJoin && (
        <div className="duel-join">
          <h2>You&apos;ve been challenged</h2>
          <p>
            <strong>{room.p1?.name || "A friend"}</strong> wants a Trivia
            Duel. 10 {room.difficulty} questions, fastest correct answer
            wins each one.
          </p>
          <label className="duel-field">
            <span className="duel-field-label">Your name</span>
            <input
              className="duel-input"
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              maxLength={30}
              autoComplete="given-name"
              placeholder="What should your friend see?"
            />
          </label>
          {joinError && <p className="duel-error">{joinError}</p>}
          <button
            type="button"
            className="duel-cta"
            onClick={handleJoin}
          >
            Join duel →
          </button>
        </div>
      )}

      {cannotJoin && (
        <div className="duel-empty">
          <h2>Can&apos;t join this duel</h2>
          <p>This room is already in progress with two players, or the duel has finished.</p>
          <Link href="/duel" className="duel-cta">
            Start a new duel →
          </Link>
        </div>
      )}

      {/* ACTIVE — currently playing */}
      {seated && room.status === "active" && (() => {
        const q = room.questions[room.currentQuestionIndex];
        const myAns = seated === "p1" ? q.state.p1Answer : q.state.p2Answer;
        const theirAns = seated === "p1" ? q.state.p2Answer : q.state.p1Answer;
        const myCorrect = seated === "p1" ? q.state.p1Correct : q.state.p2Correct;
        const resolved = q.state.resolved;
        return (
          <div className="duel-stage">
            <div className="duel-progress">
              <div className="duel-progress-text">
                Question {room.currentQuestionIndex + 1} of 10
              </div>
              <div className="trivia-progress-bar">
                <div
                  className="trivia-progress-bar-fill"
                  style={{
                    width: `${((room.currentQuestionIndex) / 10) * 100}%`,
                    background: "#7BAE3F",
                  }}
                />
              </div>
            </div>

            <h2 className="trivia-question">{q.q}</h2>

            <div className="trivia-options">
              {q.options.map((opt, idx) => {
                const isMine = myAns === idx;
                const isTheirs = theirAns === idx;
                let cls = "trivia-option";
                if (resolved && q.correct !== null) {
                  if (idx === q.correct) cls += " trivia-option-correct";
                  else if (isMine || isTheirs) cls += " trivia-option-wrong";
                  else cls += " trivia-option-disabled";
                } else if (isMine) {
                  cls += " trivia-option-picked";
                } else if (myAns !== null || resolved) {
                  cls += " trivia-option-disabled";
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    className={cls}
                    onClick={() => handleAnswer(idx)}
                    disabled={myAns !== null || resolved || submitting}
                  >
                    <span className="trivia-option-letter">
                      {["A", "B", "C", "D"][idx]}
                    </span>
                    <span className="trivia-option-text">{opt}</span>
                    {isMine && !resolved && (
                      <span className="duel-tag duel-tag-me">you</span>
                    )}
                    {isTheirs && !resolved && (
                      <span className="duel-tag duel-tag-them">{them?.name ?? "them"}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {!resolved && myAns !== null && (
              <p className="duel-status-line">
                You&apos;ve answered. Waiting for {them?.name ?? "your opponent"}…
              </p>
            )}
            {!resolved && myAns === null && theirAns !== null && (
              <p className="duel-status-line">
                {them?.name ?? "Your opponent"} has answered. Your turn!
              </p>
            )}

            {resolved && (
              <div className="trivia-reveal">
                {q.state.winner === seated && (
                  <p className="trivia-reveal-text trivia-reveal-correct">
                    You won this question!
                  </p>
                )}
                {q.state.winner === (seated === "p1" ? "p2" : "p1") && (
                  <p className="trivia-reveal-text trivia-reveal-wrong">
                    {them?.name ?? "Opponent"} got there first.
                  </p>
                )}
                {q.state.winner === "none" && (
                  <p className="trivia-reveal-text">
                    Both wrong — no points awarded.
                  </p>
                )}
                {myCorrect === false && q.state.winner !== seated && (
                  <p className="duel-fineprint">You picked wrong — eliminated for this question.</p>
                )}
                {q.fact && <p className="trivia-fact">{q.fact}</p>}
                <p className="duel-fineprint">Next question in a moment…</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* FINISHED */}
      {seated && room.status === "finished" && (() => {
        const myScore = me?.score ?? 0;
        const theirScore = them?.score ?? 0;
        const result =
          myScore > theirScore
            ? "win"
            : myScore < theirScore
              ? "lose"
              : "draw";
        return (
          <div className="answer-card">
            <h3 className="answer-card-title">
              {result === "win" && "You won the duel!"}
              {result === "lose" && "Out-duelled."}
              {result === "draw" && "It's a tie."}
            </h3>
            <p className="answer-card-detail">
              Final score: {myScore} — {theirScore}
            </p>

            <div className="answer-buttons">
              <Link href="/duel" className="answer-share">
                New duel
              </Link>
              <Link href="/trivia" className="answer-challenge">
                Play solo Trivia
              </Link>
            </div>
          </div>
        );
      })()}

      <footer>
        <p>{BRAND.domain} · Trivia Duel</p>
      </footer>
    </main>
  );
}
