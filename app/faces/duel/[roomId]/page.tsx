"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  loadChallengerName,
  saveChallengerName,
} from "@/lib/challenge";
import { GOLFERS } from "@/lib/data/golfers";
import { searchableName } from "@/lib/text";

const PLAYER_TOKEN_KEY = "pardle.facesDuel.playerToken";
const MAX_PLAYERS = 4;
const MIN_PLAYERS_TO_START = 2;
const ROUNDS_PER_DUEL = 6;
const POLL_MS = 1000;
const ROUND_DURATION_MS = 60_000;

interface PublicClaim {
  side: "left" | "right";
  text: string;
  slot: number;
  claimedAt: number;
}

interface PublicRoundState {
  leftClaim: PublicClaim | null;
  rightClaim: PublicClaim | null;
  wrongCounts: number[];
  startedAt: number | null;
  resolved: boolean;
  resolvedAt: number | null;
}

interface PublicRound {
  leftImage: string | null;
  rightImage: string | null;
  leftName: string | null;
  rightName: string | null;
  leftId: string | null;
  rightId: string | null;
  state: PublicRoundState;
}

interface PublicPlayer {
  name: string;
  score: number;
}

interface PublicRoom {
  roomId: string;
  players: (PublicPlayer | null)[];
  status: "waiting" | "active" | "finished";
  currentRoundIndex: number;
  rounds: PublicRound[];
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

export default function FacesDuelRoom() {
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId ?? "";
  const playerToken = useMemo(() => getOrCreatePlayerToken(), []);

  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [seatedSlot, setSeatedSlot] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = window.localStorage.getItem(
        `pardle.facesDuel.seated.${roomId}`,
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
  const [guess, setGuess] = useState("");
  /** Brief shake when a wrong claim comes back. */
  const [wrongFlash, setWrongFlash] = useState(false);
  /** Live tick so the per-round countdown updates. */
  const [now, setNow] = useState(() => Date.now());

  const fetchState = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(`/api/faces-duel/${roomId}`, {
        cache: "no-store",
      });
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  async function handleJoin() {
    setJoinError(null);
    const trimmed = joinName.trim().slice(0, 30);
    if (!trimmed) {
      setJoinError("Enter your name first.");
      return;
    }
    saveChallengerName(trimmed);
    try {
      const res = await fetch(`/api/faces-duel/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerToken, playerName: trimmed }),
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
            `pardle.facesDuel.seated.${roomId}`,
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
      const res = await fetch(`/api/faces-duel/${roomId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken: playerToken }),
      });
      const data = await res.json();
      if (res.ok && data.room) setRoom(data.room);
    } catch {
      // ignore
    } finally {
      setStarting(false);
    }
  }

  async function submitClaim(text: string) {
    if (!room || seatedSlot === null || submitting) return;
    if (room.status !== "active") return;
    const idx = room.currentRoundIndex;
    const round = room.rounds[idx];
    if (round.state.resolved) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setGuess("");
    try {
      const res = await fetch(`/api/faces-duel/${roomId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerToken,
          roundIndex: idx,
          text: trimmed,
        }),
      });
      const data = await res.json();
      if (res.ok && data.room) {
        setRoom(data.room);
        // Did the server credit me with a new claim this round?
        const after = (data.room as PublicRoom).rounds[idx];
        const newLeft =
          after.state.leftClaim &&
          after.state.leftClaim.slot === seatedSlot &&
          (!round.state.leftClaim ||
            round.state.leftClaim.claimedAt !== after.state.leftClaim.claimedAt);
        const newRight =
          after.state.rightClaim &&
          after.state.rightClaim.slot === seatedSlot &&
          (!round.state.rightClaim ||
            round.state.rightClaim.claimedAt !== after.state.rightClaim.claimedAt);
        if (!newLeft && !newRight) {
          setWrongFlash(true);
          setTimeout(() => setWrongFlash(false), 400);
        }
      }
    } catch {
      // poll will catch up
    } finally {
      setSubmitting(false);
    }
  }

  function copyInviteLink() {
    const url = `${BRAND.url}/faces/duel/${roomId}`;
    try {
      void navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1800);
      });
    } catch {
      setShareCopied(false);
    }
  }

  async function shareInvite() {
    const url = `${BRAND.url}/faces/duel/${roomId}`;
    const hostName = room?.players[0]?.name ?? "A friend";
    const text = `${hostName} is challenging you to a Pardle Faces Duel! 6 blended-face puzzles, fastest namer wins. Click to play:`;
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

  // Live autocomplete for the input — matches over GOLFERS to help typing.
  const matches = useMemo(() => {
    const q = searchableName(guess.trim());
    if (!q) return [];
    return GOLFERS.filter((g) => searchableName(g.name).includes(q)).slice(0, 6);
  }, [guess]);

  if (fetchError === "not_found") {
    return (
      <main className="container">
        <header className="brand">
          <Link className="brand-back" href="/faces" aria-label="Solo Faces">
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
          <Link href="/faces/duel" className="duel-cta">
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
          <Link className="brand-back" href="/faces" aria-label="Solo Faces">
            ←
          </Link>
          <h1>{BRAND.name}</h1>
          <p className="subtitle">Faces Duel · Loading…</p>
        </header>
      </main>
    );
  }

  const activePlayers = room.players.filter(
    (p): p is PublicPlayer => p !== null,
  );
  const isHost = seatedSlot === 0;
  const me = seatedSlot !== null ? room.players[seatedSlot] : null;
  const needsToJoin =
    seatedSlot === null &&
    room.status === "waiting" &&
    activePlayers.length < MAX_PLAYERS;
  const cannotJoin =
    seatedSlot === null &&
    (room.status !== "waiting" || activePlayers.length >= MAX_PLAYERS);

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/faces" aria-label="Solo Faces">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Faces Duel</p>
      </header>

      {seatedSlot !== null && (
        <div
          className={`duel-scoreboard duel-scoreboard-${activePlayers.length}`}
        >
          {room.players.map((p, i) => {
            if (!p) return null;
            return (
              <div
                key={i}
                className={`duel-scoreboard-player ${
                  seatedSlot === i ? "duel-scoreboard-me" : ""
                }`}
              >
                <div className="duel-scoreboard-name">{p.name}</div>
                <div className="duel-scoreboard-score">{p.score}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* HOST lobby */}
      {seatedSlot !== null && isHost && room.status === "waiting" && (
        <div className="duel-waiting">
          <h2>Send this to your friends to play</h2>
          <p>
            {activePlayers.length === 1
              ? "Up to 3 friends can join. Hit start when ready."
              : `${activePlayers.length} player${
                  activePlayers.length === 1 ? "" : "s"
                } in the room. Add up to ${
                  MAX_PLAYERS - activePlayers.length
                } more, or start now.`}
          </p>
          <div className="duel-link-row">
            <code className="duel-link">{`${BRAND.url}/faces/duel/${roomId}`}</code>
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
            disabled={
              activePlayers.length < MIN_PLAYERS_TO_START || starting
            }
          >
            {starting
              ? "Starting…"
              : activePlayers.length < MIN_PLAYERS_TO_START
                ? "Waiting for at least one friend…"
                : `Start the duel (${activePlayers.length} player${
                    activePlayers.length === 1 ? "" : "s"
                  })`}
          </button>
        </div>
      )}

      {/* Non-host in lobby */}
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

      {/* Fresh visitor joining */}
      {needsToJoin && (
        <div className="duel-join">
          <h2>You&apos;ve been challenged</h2>
          <p>
            <strong>{room.players[0]?.name || "A friend"}</strong> wants a
            Pardle Faces Duel. 6 blended-face puzzles, fastest namer wins
            each round.
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
          <button type="button" className="duel-cta" onClick={handleJoin}>
            Join duel →
          </button>
        </div>
      )}

      {cannotJoin && (
        <div className="duel-empty">
          <h2>Can&apos;t join this duel</h2>
          <p>This room is full or the duel has already started.</p>
          <Link href="/faces/duel" className="duel-cta">
            Start a new duel →
          </Link>
        </div>
      )}

      {/* ACTIVE GAME */}
      {seatedSlot !== null && room.status === "active" && (() => {
        const idx = room.currentRoundIndex;
        const round = room.rounds[idx];
        const startedAt = round.state.startedAt ?? now;
        const elapsed = now - startedAt;
        const remainingMs = Math.max(0, ROUND_DURATION_MS - elapsed);
        const remainingSec = Math.ceil(remainingMs / 1000);
        const leftClaimed = !!round.state.leftClaim;
        const rightClaimed = !!round.state.rightClaim;
        const resolved = round.state.resolved;
        return (
          <div className="duel-stage">
            <div className="faces-progress">
              <div className="faces-progress-text">
                Round {idx + 1} of {ROUNDS_PER_DUEL}
                <span className="trivia-score-tag">
                  ⏱ {remainingSec}s
                </span>
              </div>
              <div className="trivia-progress-bar">
                <div
                  className="trivia-progress-bar-fill"
                  style={{
                    width: `${(idx / ROUNDS_PER_DUEL) * 100}%`,
                    background: "#E07B5B",
                  }}
                />
              </div>
            </div>

            <div
              className={`faces-stage ${wrongFlash ? "faces-stage-wrong" : ""} ${
                resolved ? "faces-stage-over" : ""
              }`}
              onContextMenu={(e) => e.preventDefault()}
            >
              {round.leftImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={round.leftImage}
                  alt=""
                  draggable={false}
                  className="faces-img faces-img-base"
                />
              )}
              {round.rightImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={round.rightImage}
                  alt=""
                  draggable={false}
                  className="faces-img faces-img-overlay"
                />
              )}
            </div>

            <div className="faces-slots">
              <FacesDuelSlot
                num={1}
                claim={round.state.leftClaim}
                imageUrl={round.leftImage}
                name={round.leftName}
                seatedSlot={seatedSlot}
                players={room.players}
                resolved={resolved}
                claimed={leftClaimed}
              />
              <FacesDuelSlot
                num={2}
                claim={round.state.rightClaim}
                imageUrl={round.rightImage}
                name={round.rightName}
                seatedSlot={seatedSlot}
                players={room.players}
                resolved={resolved}
                claimed={rightClaimed}
              />
            </div>

            {!resolved && (
              <div className="input-area">
                <input
                  type="text"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitClaim(
                        matches.length > 0 ? matches[0].name : guess,
                      );
                    }
                  }}
                  placeholder="Type a player's name..."
                  autoComplete="off"
                  autoCapitalize="words"
                  autoFocus
                  disabled={submitting}
                />
                {matches.length > 0 && (
                  <ul className="suggestions">
                    {matches.map((g) => (
                      <li
                        key={g.id}
                        onClick={() => submitClaim(g.name)}
                      >
                        {g.name}{" "}
                        <span className="suggestion-country">
                          {g.country}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {resolved && (
              <div className="trivia-reveal">
                <p className="trivia-reveal-text">
                  Round over — {round.leftName} & {round.rightName}.
                </p>
                <p className="duel-fineprint">Next round in a moment…</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* FINISHED */}
      {seatedSlot !== null && room.status === "finished" && (() => {
        const ranked = room.players
          .map((p, slot) => (p ? { slot, ...p } : null))
          .filter(
            (p): p is { slot: number; name: string; score: number } =>
              p !== null,
          )
          .sort((a, b) => b.score - a.score);
        const myScore = me?.score ?? 0;
        const topScore = ranked[0]?.score ?? 0;
        const winners = ranked.filter((p) => p.score === topScore);
        const iWon = myScore === topScore && winners.length === 1;
        const tied = myScore === topScore && winners.length > 1;
        return (
          <div className="answer-card">
            <h3 className="answer-card-title">
              {iWon && "You won the Faces Duel!"}
              {!iWon && tied && "Tied for the win."}
              {!iWon && !tied && myScore !== topScore && "Out-duelled."}
            </h3>
            <div className="duel-final-table">
              {ranked.map((p, i) => (
                <div
                  key={p.slot}
                  className={`duel-final-row ${
                    p.slot === seatedSlot ? "duel-final-me" : ""
                  }`}
                >
                  <span className="duel-final-rank">{i + 1}</span>
                  <span className="duel-final-name">{p.name}</span>
                  <span className="duel-final-score">{p.score}</span>
                </div>
              ))}
            </div>

            <div className="answer-buttons">
              <Link href="/faces/duel" className="answer-share">
                New duel
              </Link>
              <Link href="/faces" className="answer-challenge">
                Play solo Faces
              </Link>
            </div>
          </div>
        );
      })()}

      <footer>
        <p>{BRAND.domain} · Faces Duel · Up to 4 players</p>
      </footer>
    </main>
  );
}

function FacesDuelSlot({
  num,
  claim,
  imageUrl,
  name,
  seatedSlot,
  players,
  resolved,
  claimed,
}: {
  num: number;
  claim: PublicClaim | null;
  imageUrl: string | null;
  name: string | null;
  seatedSlot: number;
  players: (PublicPlayer | null)[];
  resolved: boolean;
  claimed: boolean;
}) {
  if (claim) {
    const by = players[claim.slot]?.name ?? "Someone";
    return (
      <div className="faces-slot faces-slot-solved">
        <div className="faces-slot-num">{num}</div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="faces-slot-img" src={imageUrl} alt={name ?? ""} />
        )}
        <div className="faces-slot-name">{name ?? claim.text}</div>
        <div
          className={`faces-claim-by ${
            claim.slot === seatedSlot
              ? "faces-claim-by-me"
              : "faces-claim-by-them"
          }`}
        >
          {claim.slot === seatedSlot ? "You got it" : `${by} got it`}
        </div>
      </div>
    );
  }
  if (resolved) {
    return (
      <div className="faces-slot">
        <div className="faces-slot-num">{num}</div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="faces-slot-img" src={imageUrl} alt={name ?? ""} />
        )}
        <div className="faces-slot-name">{name ?? "—"}</div>
        <div className="faces-claim-by faces-claim-by-none">
          Nobody got it
        </div>
      </div>
    );
  }
  return (
    <div className="faces-slot">
      <div className="faces-slot-num">{num}</div>
      <div className="faces-slot-placeholder">{claimed ? "✓" : "?"}</div>
    </div>
  );
}
