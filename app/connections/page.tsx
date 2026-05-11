"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import {
  type ConnectionsCategory,
  type ConnectionsDifficulty,
  type ConnectionsPuzzle,
  generatePuzzle,
} from "@/lib/game/connections";
import {
  applyMissedDayReset,
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
import { encodeGridConnections, encodeShareCard } from "@/lib/share-card";

const GAME_ID = "connections";
const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 11);
const MAX_MISTAKES = 4;
const STATE_KEY = "pardle.connections.todayState";

// Persisted snapshot of today's puzzle so a refresh — whether mid-game
// or after finishing — restores progress rather than starting over.
interface PersistedDayState {
  dayNumber: number;
  mistakes: number;
  history: ConnectionsDifficulty[][];
  solvedLabels: string[];
  revealedHints: string[];
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
    // ignore — over quota or disabled
  }
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

const DIFFICULTY_EMOJI: Record<ConnectionsDifficulty, string> = {
  yellow: "🟨",
  green: "🟩",
  blue: "🟦",
  purple: "🟪",
};

function buildShareText(
  history: ConnectionsDifficulty[][],
  dayNumber: number,
  won: boolean,
  mistakes: number,
): string {
  const result = won ? `${mistakes} mistake${mistakes === 1 ? "" : "s"}` : "X";
  const grid = history
    .map((row) => row.map((d) => DIFFICULTY_EMOJI[d]).join(""))
    .join("\n");
  const encodedGrid = encodeGridConnections(history);
  const token = encodeShareCard({
    g: "connections",
    d: dayNumber,
    s: won ? String(mistakes) : "X",
    r: encodedGrid,
  });
  return `${BRAND.name}: Connections #${dayNumber} (${result})\n${grid}\n${BRAND.url}/r/${token}`;
}

function compareWithFriend(
  myScore: ChallengeScore,
  friendScore: ChallengeScore,
  friendName: string,
): { line: string; outcome: "win" | "lose" | "tie" } {
  if (myScore === "X" && friendScore === "X") {
    return { line: `Both stumped today.`, outcome: "tie" };
  }
  if (myScore === "X") {
    return {
      line: `${friendName} solved it with ${friendScore} mistake(s). Beat them tomorrow.`,
      outcome: "lose",
    };
  }
  if (friendScore === "X") {
    return { line: `You beat ${friendName} — they didn't solve it.`, outcome: "win" };
  }
  if (myScore < friendScore) {
    return { line: `Cleaner than ${friendName} by ${friendScore - myScore}.`, outcome: "win" };
  }
  if (myScore > friendScore) {
    return { line: `${friendName} beat you by ${myScore - friendScore}.`, outcome: "lose" };
  }
  return { line: `Tied with ${friendName}.`, outcome: "tie" };
}

export default function ConnectionsPage() {
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  const puzzle: ConnectionsPuzzle = useMemo(
    () => generatePuzzle(dayNumber),
    [dayNumber],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [solved, setSolved] = useState<ConnectionsCategory[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [history, setHistory] = useState<ConnectionsDifficulty[][]>([]);
  const [shake, setShake] = useState(false);
  // Hint state: revealed category labels (free help, doesn't cost
  // mistakes) and a transient 'one away' flash when a wrong guess
  // had 3 of 4 in the same group.
  const [revealedHints, setRevealedHints] = useState<Set<string>>(new Set());
  const [oneAwayFlash, setOneAwayFlash] = useState(false);
  // True when this page load restored a *finished* game from
  // localStorage (player came back to today's puzzle). Drives the
  // 'you already played today' banner so the celebration ('Solved!')
  // doesn't reappear every time they revisit.
  const [returnedAfterFinish, setReturnedAfterFinish] = useState(false);
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [challengeCopied, setChallengeCopied] = useState(false);

  const itemById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const it of puzzle.items) m.set(it.id, it);
    return m;
  }, [puzzle]);

  const solvedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of solved) for (const id of c.memberIds) s.add(id);
    return s;
  }, [solved]);

  const isWin = solved.length === 4;
  const isLose = !isWin && mistakes >= MAX_MISTAKES;
  const isOver = isWin || isLose;

  // Items still on the board, in their original shuffled order.
  const remainingItems = useMemo(
    () => puzzle.items.filter((it) => !solvedIds.has(it.id)),
    [puzzle, solvedIds],
  );

  useEffect(() => {
    setStats(applyMissedDayReset(GAME_ID, dayNumber));
    // Restore today's in-progress (or completed) game from localStorage
    // so a refresh doesn't blow away guesses, mistakes, or the final
    // answer-card view.
    const saved = loadDayState(dayNumber);
    if (saved) {
      setMistakes(saved.mistakes);
      setHistory(saved.history);
      const solvedSet = new Set(saved.solvedLabels);
      setSolved(
        puzzle.categories.filter((c) => solvedSet.has(c.label)),
      );
      setRevealedHints(new Set(saved.revealedHints));
      const finishedAlready =
        saved.solvedLabels.length === 4 || saved.mistakes >= MAX_MISTAKES;
      if (finishedAlready) setReturnedAfterFinish(true);
    }
    try {
      const code = new URLSearchParams(window.location.search).get("c");
      if (code) {
        const decoded = decodeChallenge(code);
        if (decoded) setChallenge(decoded);
      }
    } catch {
      // ignore
    }
    // puzzle.categories is derived from dayNumber so referencing it once
    // here is stable; intentionally not in deps to avoid re-restoring on
    // every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayNumber]);

  // Persist day-state every time the meaningful slices change. Keeps
  // the localStorage snapshot in lockstep with what the player sees.
  useEffect(() => {
    saveDayState({
      dayNumber,
      mistakes,
      history,
      solvedLabels: solved.map((c) => c.label),
      revealedHints: Array.from(revealedHints),
    });
  }, [dayNumber, mistakes, history, solved, revealedHints]);

  useEffect(() => {
    if (!isOver) return;
    // Score = number of mistakes used (lower is better; X if loss).
    setStats(recordResult(GAME_ID, dayNumber, isWin, mistakes));
  }, [isOver, isWin, dayNumber, mistakes]);

  function toggleItem(id: string) {
    if (isOver || solvedIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
  }

  function submitGuess() {
    if (selected.size !== 4 || isOver) return;
    const selectedArr = Array.from(selected);

    // Record this attempt's pattern for the share grid: one tile per
    // selected item, coloured by which category that item actually
    // belongs to. Mirrors NYT Connections' share format.
    const idToDiff = new Map<string, ConnectionsDifficulty>();
    for (const cat of puzzle.categories) {
      for (const id of cat.memberIds) idToDiff.set(id, cat.difficulty);
    }
    const row = selectedArr.map((id) => idToDiff.get(id) ?? "yellow");
    setHistory((prev) => [...prev, row]);

    // Did all 4 land in one (unsolved) category?
    const matching = puzzle.categories.find((c) => {
      if (solved.some((s) => s.label === c.label)) return false;
      return selectedArr.every((id) => c.memberIds.includes(id));
    });

    if (matching) {
      setSolved((prev) => [...prev, matching]);
      setSelected(new Set());
    } else {
      // One-away check: if 3 of the 4 selected items belong to the
      // same (unsolved) category, surface "One away!" so the player
      // knows to swap one tile rather than blow up the whole guess.
      let bestOverlap = 0;
      for (const cat of puzzle.categories) {
        if (solved.some((s) => s.label === cat.label)) continue;
        const overlap = selectedArr.filter((id) =>
          cat.memberIds.includes(id),
        ).length;
        if (overlap > bestOverlap) bestOverlap = overlap;
      }
      if (bestOverlap === 3) {
        setOneAwayFlash(true);
        setTimeout(() => setOneAwayFlash(false), 2200);
      }
      // Wrong guess — flash a shake animation, count a mistake, clear selection.
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setMistakes((m) => m + 1);
      setSelected(new Set());
    }
  }

  function deselectAll() {
    if (isOver) return;
    setSelected(new Set());
  }

  function revealHint() {
    if (isOver) return;
    // Reveal the easiest still-unsolved unrevealed category. Puzzles are
    // built in difficulty order (yellow → purple) so iterating in that
    // order gives the most helpful hint first.
    const next = puzzle.categories.find(
      (c) =>
        !solved.some((s) => s.label === c.label) &&
        !revealedHints.has(c.label),
    );
    if (!next) return;
    setRevealedHints((prev) => new Set([...prev, next.label]));
  }

  const remainingHints = puzzle.categories.filter(
    (c) =>
      !solved.some((s) => s.label === c.label) &&
      !revealedHints.has(c.label),
  ).length;

  const challengeIsForToday =
    challenge !== null && challenge.dayNumber === dayNumber;
  const challengeIsExpired =
    challenge !== null && challenge.dayNumber !== dayNumber;
  const myScore: ChallengeScore = isWin ? mistakes : "X";
  const versus =
    challengeIsForToday && isOver && challenge
      ? compareWithFriend(
          myScore,
          challenge.score,
          challenge.challengerName || "your friend",
        )
      : null;

  async function handleShare() {
    const text = buildShareText(history, dayNumber, isWin, mistakes);
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

  async function handleChallenge() {
    let name = loadChallengerName();
    if (!name) {
      const entered = window.prompt(
        "What name should your friend see? (Optional)",
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
    });
    const url = `${BRAND.url}/connections?c=${token}`;
    const text = isWin
      ? `I solved today's ${BRAND.name}: Connections with ${mistakes} mistakes. Beat me: ${url}`
      : `I couldn't crack today's ${BRAND.name}: Connections. Your turn: ${url}`;
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
      setChallengeCopied(true);
      setTimeout(() => setChallengeCopied(false), 1800);
    } catch {
      setChallengeCopied(false);
    }
  }

  return (
    <main className="container">
      {challengeIsForToday && (
        <div className="challenge-banner">
          <span aria-hidden="true">🧩</span>{" "}
          <strong>{challenge?.challengerName || "A friend"}</strong> solved
          today&apos;s Connections with{" "}
          <strong>
            {challenge?.score === "X"
              ? "X"
              : `${challenge?.score} mistake${challenge?.score === 1 ? "" : "s"}`}
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
      {returnedAfterFinish && (
        <div className="challenge-banner">
          <span aria-hidden="true">✅</span> You&apos;ve already finished
          today&apos;s Connections. Come back tomorrow for a new puzzle.
        </div>
      )}

      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Connections · Day {dayNumber}</p>
        {stats && stats.current > 0 && (
          <div className="brand-streak" title={`Longest: ${stats.longest}`}>
            <span aria-hidden="true">🔥</span> {stats.current} day
            {stats.current === 1 ? "" : "s"}
          </div>
        )}
      </header>

      <p className="conn-prompt">
        Find four groups of four. Every item has a golf connection.
      </p>

      {solved.length > 0 && (
        <div className="conn-solved-stack">
          {solved.map((c) => (
            <div
              key={c.label}
              className={`conn-solved-strip conn-strip-${c.difficulty}`}
            >
              <div className="conn-solved-label">{c.label}</div>
              <div className="conn-solved-members">
                {c.memberIds
                  .map((id) => itemById.get(id)?.name ?? id)
                  .join(", ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isOver && revealedHints.size > 0 && (
        <div className="conn-hints">
          <div className="conn-hints-label">Revealed categories</div>
          <ul className="conn-hints-list">
            {Array.from(revealedHints).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      {!isOver && (
        <>
          <div className={`conn-grid ${shake ? "conn-shake" : ""}`}>
            {remainingItems.map((item) => {
              const isSel = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`conn-tile ${isSel ? "conn-tile-selected" : ""}`}
                  onClick={() => toggleItem(item.id)}
                >
                  {item.name}
                </button>
              );
            })}
          </div>

          {oneAwayFlash && (
            <div className="conn-one-away" role="status">
              One away!
            </div>
          )}

          <div className="conn-status">
            <div className="conn-mistakes">
              Mistakes
              <span className="conn-dots">
                {Array.from({ length: MAX_MISTAKES }).map((_, i) => (
                  <span
                    key={i}
                    className={`conn-dot ${i < mistakes ? "conn-dot-used" : ""}`}
                  />
                ))}
              </span>
            </div>
          </div>

          <div className="conn-controls">
            <button
              type="button"
              className="conn-btn conn-btn-secondary"
              onClick={deselectAll}
              disabled={selected.size === 0}
            >
              Deselect all
            </button>
            <button
              type="button"
              className="conn-btn conn-btn-secondary"
              onClick={revealHint}
              disabled={remainingHints === 0}
              title="Reveal one category's label (free help)"
            >
              Hint
            </button>
            <button
              type="button"
              className="conn-btn conn-btn-primary"
              onClick={submitGuess}
              disabled={selected.size !== 4}
            >
              Submit
            </button>
          </div>
        </>
      )}

      {isOver && (
        <div className="answer-card">
          <h3 className="answer-card-title">
            {isWin ? "Solved!" : "Out of mistakes"}
          </h3>
          <p className="answer-card-detail">
            {isWin
              ? `${mistakes} mistake${mistakes === 1 ? "" : "s"} used.`
              : "Here's the full grid."}
          </p>

          <div className="conn-solved-stack">
            {puzzle.categories.map((c) => (
              <div
                key={c.label}
                className={`conn-solved-strip conn-strip-${c.difficulty}`}
              >
                <div className="conn-solved-label">{c.label}</div>
                <div className="conn-solved-members">
                  {c.memberIds
                    .map((id) => itemById.get(id)?.name ?? id)
                    .join(", ")}
                </div>
              </div>
            ))}
          </div>

          {versus && (
            <p className={`modal-versus modal-versus-${versus.outcome}`}>
              {versus.line}
            </p>
          )}

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
            <button className="answer-challenge" onClick={handleChallenge}>
              {challengeCopied ? "Challenge copied!" : "Challenge a friend"}
            </button>
          </div>

          <NotifySignup gameId="connections" dayNumber={dayNumber} />
        </div>
      )}

      <footer>
        <p>
          {BRAND.domain} · Connections · 4 groups of 4 golfers
        </p>
      </footer>
    </main>
  );
}
