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
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const POLL_MS = 1000;

interface PublicPick {
  answer: number;
  correct: boolean;
  clickedAt: number;
}

interface PublicQuestionState {
  picks: (PublicPick | null)[];
  resolved: boolean;
  winnerSlot: number | null;
  resolvedAt: number | null;
}

interface PublicQuestion {
  id: string;
  q: string;
  options: [string, string, string, string];
  correct: number | null;
  fact: string | null;
  state: PublicQuestionState;
}

interface PublicPlayer {
  name: string;
  score: number;
}

interface PublicRoom {
  roomId: string;
  difficulty: "easy" | "medium" | "hard";
  players: (PublicPlayer | null)[];
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

export default function DuelGamePage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId ?? "";
  const playerToken = useMemo(() => getOrCreatePlayerToken(), []);

  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Slot index 0..3 once the player has been seated.
  const [seatedSlot, setSeatedSlot] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = window.localStorage.getItem(
        `pardle.duel.seated.${roomId}`,
      );
      if (v) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n < MAX_PLAYERS) return n;
      }
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
  const [starting, setStarting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

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
      // best-effort poll
    }
  }, [roomId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (!roomId) return;
    const id = setInterval(fetchState, POLL_MS);
    return () => clearInterval(id);
  }, [roomId, fetchState]);

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
            ? "Room is full or has already started."
            : "Couldn't join — try again.",
        );
        return;
      }
      setRoom(data.room);
      if (typeof data.slot === "number") {
        setSeatedSlot(data.slot);
        try {
          window.localStorage.setItem(
            `pardle.duel.seated.${roomId}`,
            String(data.slot),
          );
        } catch {
          // ignore
        }
      }
    } catch {
      setJoinError("Network issue — try again.");
    }
  }

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/duel/${roomId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken: playerToken }),
      });
      const data = await res.json();
      if (res.ok && data.room) setRoom(data.room);
    } catch {
      // ignore — next poll will catch up
    } finally {
      setStarting(false);
    }
  }

  async function handleAnswer(answerIndex: number) {
    if (!room || seatedSlot === null || submitting) return;
    if (room.status !== "active") return;
    const idx = room.currentQuestionIndex;
    const q = room.questions[idx];
    const mine = q.state.picks[seatedSlot];
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
    const url = `${BRAND.url}/duel/${roomId}`;
    const hostName = room?.players[0]?.name ?? "A friend";
    const text = `${hostName} is challenging you to a Pardle Trivia Duel! 10 questions, fastest correct answer wins. Click to play:`;
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

  const activePlayers = room.players.filter((p): p is PublicPlayer => p !== null);
  const isHost = seatedSlot === 0;
  const me = seatedSlot !== null ? room.players[seatedSlot] : null;
  const needsToJoin =
    seatedSlot === null && room.status === "waiting" && activePlayers.length < MAX_PLAYERS;
  const cannotJoin =
    seatedSlot === null &&
    (room.status !== "waiting" || activePlayers.length >= MAX_PLAYERS);

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
      {seatedSlot !== null && (
        <div
          className={`duel-scoreboard duel-scoreboard-${activePlayers.length}`}
        >
          {room.players.map((p, i) => {
            if (!p) return null;
            return (
              <div
                key={i}
                className={`duel-scoreboard-player ${seatedSlot === i ? "duel-scoreboard-me" : ""}`}
              >
                <div className="duel-scoreboard-name">{p.name}</div>
                <div className="duel-scoreboard-score">{p.score}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* HOST view: lobby with invite link + start button */}
      {seatedSlot !== null && isHost && room.status === "waiting" && (
        <div className="duel-waiting">
          <h2>Send this to your friends to play</h2>
          <p>
            {activePlayers.length === 1 ? (
              <>Up to 3 friends can join. Hit start when ready.</>
            ) : (
              <>
                {activePlayers.length} player
                {activePlayers.length === 1 ? "" : "s"} in the room. Add up to{" "}
                {MAX_PLAYERS - activePlayers.length} more, or start now.
              </>
            )}
          </p>
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
          <button
            type="button"
            className="duel-cta duel-cta-start"
            onClick={handleStart}
            disabled={activePlayers.length < MIN_PLAYERS_TO_START || starting}
          >
            {starting
              ? "Starting…"
              : activePlayers.length < MIN_PLAYERS_TO_START
                ? "Waiting for at least one friend…"
                : `Start the duel (${activePlayers.length} player${activePlayers.length === 1 ? "" : "s"})`}
          </button>
        </div>
      )}

      {/* NON-HOST seated view while host is still in the lobby */}
      {seatedSlot !== null && !isHost && room.status === "waiting" && (
        <div className="duel-waiting">
          <h2>You&apos;re in</h2>
          <p>
            Waiting for{" "}
            <strong>{room.players[0]?.name ?? "the host"}</strong> to start
            the duel. {activePlayers.length} player
            {activePlayers.length === 1 ? "" : "s"} in the room so far.
          </p>
        </div>
      )}

      {/* JOIN — fresh visitor */}
      {needsToJoin && (
        <div className="duel-join">
          <h2>You&apos;ve been challenged</h2>
          <p>
            <strong>{room.players[0]?.name || "A friend"}</strong> wants a
            Pardle Trivia Duel. 10 {room.difficulty} questions, fastest
            correct answer wins each one.
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
              placeholder="What should the others see?"
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
          <p>
            This room is full or the duel has already started.
          </p>
          <Link href="/duel" className="duel-cta">
            Start a new duel →
          </Link>
        </div>
      )}

      {/* ACTIVE GAME */}
      {seatedSlot !== null && room.status === "active" && (() => {
        const q = room.questions[room.currentQuestionIndex];
        const myPick = q.state.picks[seatedSlot];
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
                    width: `${(room.currentQuestionIndex / 10) * 100}%`,
                    background: "#7BAE3F",
                  }}
                />
              </div>
            </div>

            <h2 className="trivia-question">{q.q}</h2>

            <div className="trivia-options">
              {q.options.map((opt, idx) => {
                // Which players (by slot) picked this option?
                const pickers: number[] = [];
                room.players.forEach((p, slot) => {
                  if (!p) return;
                  const pick = q.state.picks[slot];
                  if (pick && pick.answer === idx) pickers.push(slot);
                });
                const isMine = myPick !== null && myPick.answer === idx;
                let cls = "trivia-option";
                if (resolved && q.correct !== null) {
                  if (idx === q.correct) cls += " trivia-option-correct";
                  else if (pickers.length > 0) cls += " trivia-option-wrong";
                  else cls += " trivia-option-disabled";
                } else if (isMine) {
                  cls += " trivia-option-picked";
                } else if (myPick !== null || resolved) {
                  cls += " trivia-option-disabled";
                }
                return (
                  <button
                    key={idx}
                    type="button"
                    className={cls}
                    onClick={() => handleAnswer(idx)}
                    disabled={myPick !== null || resolved || submitting}
                  >
                    <span className="trivia-option-letter">
                      {["A", "B", "C", "D"][idx]}
                    </span>
                    <span className="trivia-option-text">{opt}</span>
                    {/* Show name tags for any player who picked this option */}
                    {pickers.length > 0 && (
                      <span className="duel-tags">
                        {pickers.map((slot) => (
                          <span
                            key={slot}
                            className={`duel-tag ${slot === seatedSlot ? "duel-tag-me" : "duel-tag-them"}`}
                          >
                            {slot === seatedSlot
                              ? "you"
                              : (room.players[slot]?.name ?? "?")}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Status line */}
            {!resolved && (() => {
              const unanswered = room.players
                .map((p, slot) =>
                  p && q.state.picks[slot] === null ? p.name : null,
                )
                .filter((n): n is string => n !== null && room.players.findIndex((pp) => pp?.name === n) !== seatedSlot);
              if (myPick !== null && unanswered.length > 0) {
                return (
                  <p className="duel-status-line">
                    You&apos;ve answered. Waiting for {unanswered.join(", ")}…
                  </p>
                );
              }
              return null;
            })()}

            {resolved && (
              <div className="trivia-reveal">
                {q.state.winnerSlot === seatedSlot && (
                  <p className="trivia-reveal-text trivia-reveal-correct">
                    You won this question!
                  </p>
                )}
                {q.state.winnerSlot !== null &&
                  q.state.winnerSlot !== -1 &&
                  q.state.winnerSlot !== seatedSlot && (
                    <p className="trivia-reveal-text trivia-reveal-wrong">
                      {room.players[q.state.winnerSlot]?.name ?? "Someone"} got there first.
                    </p>
                  )}
                {q.state.winnerSlot === -1 && (
                  <p className="trivia-reveal-text">
                    Everyone wrong — no points awarded.
                  </p>
                )}
                {myPick !== null && !myPick.correct && q.state.winnerSlot !== seatedSlot && (
                  <p className="duel-fineprint">
                    You picked wrong — eliminated for this question.
                  </p>
                )}
                {q.fact && <p className="trivia-fact">{q.fact}</p>}
                <p className="duel-fineprint">Next question in a moment…</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* FINISHED */}
      {seatedSlot !== null && room.status === "finished" && (() => {
        const ranked = room.players
          .map((p, slot) => (p ? { slot, ...p } : null))
          .filter((p): p is { slot: number; name: string; score: number } => p !== null)
          .sort((a, b) => b.score - a.score);
        const myScore = me?.score ?? 0;
        const topScore = ranked[0]?.score ?? 0;
        const iWon = myScore === topScore && ranked.filter((p) => p.score === topScore).length === 1;
        const tied = myScore === topScore && ranked.filter((p) => p.score === topScore).length > 1;
        return (
          <div className="answer-card">
            <h3 className="answer-card-title">
              {iWon && "You won the duel!"}
              {!iWon && tied && "Tied for the win."}
              {!iWon && !tied && myScore !== topScore && "Out-duelled."}
            </h3>
            <div className="duel-final-table">
              {ranked.map((p, i) => (
                <div
                  key={p.slot}
                  className={`duel-final-row ${p.slot === seatedSlot ? "duel-final-me" : ""}`}
                >
                  <span className="duel-final-rank">{i + 1}</span>
                  <span className="duel-final-name">{p.name}</span>
                  <span className="duel-final-score">{p.score}</span>
                </div>
              ))}
            </div>

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
        <p>{BRAND.domain} · Trivia Duel · Up to 4 players</p>
      </footer>
    </main>
  );
}
