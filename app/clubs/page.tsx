"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { COURSES } from "@/lib/data/courses";
import { COURSE_TOURS } from "@/lib/data/course-tours";
import { CLUBHOUSE_SVG_IDS } from "@/lib/data/clubhouse-svgs";
import {
  type Course,
  type HardCourseGuess,
  type TourFilter,
  HOLES_MAX_GUESSES,
} from "@/lib/game/holes-types";
import type { AttributeReveal, CellState } from "@/lib/game/types";
import { revealHardCourseGuess } from "@/lib/game/holes-reveal";
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

const GAME_ID = "clubs";
const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 11);
const TOUR_FILTER_KEY = "pardle.clubsTourFilter";

function loadTourFilter(): TourFilter {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(TOUR_FILTER_KEY);
    if (stored === "PGA" || stored === "DPW") return stored;
    return "all";
  } catch {
    return "all";
  }
}

function saveTourFilter(f: TourFilter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_FILTER_KEY, f);
  } catch {
    // ignore
  }
}

function coursePool(filter: TourFilter): Course[] {
  const base = COURSES.filter((c) => CLUBHOUSE_SVG_IDS.has(c.id));
  if (filter === "all") return base;
  return base.filter((c) => COURSE_TOURS[c.id]?.includes(filter));
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

// Per-filter rotation offset so day-0 isn't the same course across filters.
// Bumping the version suffix shuffles every filter's start by an
// unpredictable amount.
function filterDayOffset(filter: TourFilter): number {
  const key = `pardle-clubs-${filter}-v1`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (((h * 33) ^ key.charCodeAt(i)) >>> 0);
  }
  return h;
}

function pickMysteryCourse(filter: TourFilter): Course {
  const pool = coursePool(filter);
  if (pool.length === 0) return COURSES[0];
  const dayIdx = dayIndexToday() + filterDayOffset(filter);
  const safe = ((dayIdx % pool.length) + pool.length) % pool.length;
  return pool[safe];
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

function Arrow({ arrow }: { arrow: AttributeReveal["arrow"] }) {
  if (!arrow) return null;
  return <span className="arrow">{arrow === "up" ? "▲" : "▼"}</span>;
}

const COMPASS_ARROWS: Record<string, string> = {
  N: "↑",
  NE: "↗",
  E: "→",
  SE: "↘",
  S: "↓",
  SW: "↙",
  W: "←",
  NW: "↖",
};

function stateToEmoji(state: CellState): string {
  if (state === "green") return "🟩";
  if (state === "warm" || state === "yellow") return "🟨";
  return "⬛";
}

function buildShareText(
  guesses: HardCourseGuess[],
  dayNumber: number,
  won: boolean,
): string {
  const result = won
    ? `${guesses.length}/${HOLES_MAX_GUESSES}`
    : `X/${HOLES_MAX_GUESSES}`;
  const grid = guesses
    .map((g) =>
      [
        stateToEmoji(g.country.state),
        stateToEmoji(g.par.state),
        g.direction.distanceMi === 0 ? "🟩" : "🧭",
        stateToEmoji(g.courseType.state),
        stateToEmoji(g.yardage.state),
      ].join(""),
    )
    .join("\n");
  return `${BRAND.name}: Clubs #${dayNumber} ${result}\n${grid}\n${BRAND.domain}/clubs`;
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
      line: `${friendName} got it in ${friendScore}/${HOLES_MAX_GUESSES} — beat them tomorrow.`,
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

export default function ClubsPage() {
  const [tourFilter, setTourFilter] = useState<TourFilter>("all");
  const mystery = useMemo(() => pickMysteryCourse(tourFilter), [tourFilter]);
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  const [guesses, setGuesses] = useState<HardCourseGuess[]>([]);
  const [courseInput, setCourseInput] = useState("");
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [challengeCopied, setChallengeCopied] = useState(false);

  const imageUrl = `/clubhouses/${mystery.id}.svg`;

  const isWin = guesses.some((g) => g.isCourseMatch);
  const isLose = !isWin && guesses.length >= HOLES_MAX_GUESSES;
  const isOver = isWin || isLose;
  const scoreCount = guesses.length;

  useEffect(() => {
    setStats(applyMissedDayReset(GAME_ID, dayNumber));
    setTourFilter(loadTourFilter());
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

  function resetAllGameState() {
    setGuesses([]);
    setCourseInput("");
  }

  function changeTourFilter(f: TourFilter) {
    if (f === tourFilter) return;
    if (guesses.length > 0 && !isOver) {
      const ok = window.confirm(
        "Switching tour filter changes today's puzzle. Reset and start over?",
      );
      if (!ok) return;
    }
    resetAllGameState();
    setTourFilter(f);
    saveTourFilter(f);
  }

  useEffect(() => {
    if (!isOver) return;
    setStats(recordResult(GAME_ID, dayNumber, isWin, scoreCount));
  }, [isOver, isWin, dayNumber, scoreCount]);

  const matches = useMemo(() => {
    const q = courseInput.trim().toLowerCase();
    if (!q) return [];
    const pool = coursePool(tourFilter);
    const alreadyGuessed = new Set(guesses.map((g) => g.course.id));
    return pool
      .filter(
        (c) =>
          !alreadyGuessed.has(c.id) &&
          (c.name.toLowerCase().includes(q) ||
            c.shortName.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [courseInput, tourFilter, guesses]);

  function submitGuess(course: Course) {
    if (isOver) return;
    setGuesses((prev) => [...prev, revealHardCourseGuess(course, mystery)]);
    setCourseInput("");
  }

  const challengeIsForToday =
    challenge !== null && challenge.dayNumber === dayNumber;
  const challengeIsExpired =
    challenge !== null && challenge.dayNumber !== dayNumber;
  const myScore: ChallengeScore = isWin ? scoreCount : "X";
  const versus =
    challengeIsForToday && isOver && challenge
      ? compareWithFriend(
          myScore,
          challenge.score,
          challenge.challengerName || "your friend",
        )
      : null;

  async function handleShare() {
    const shareText = buildShareText(guesses, dayNumber, isWin);
    const nav = navigator as Navigator & {
      share?: (data: { text: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ text: shareText });
        return;
      } catch {
        // fall through
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
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
    const url = `${BRAND.url}/clubs?c=${token}`;
    const text = isWin
      ? `I solved today's ${BRAND.name}: Clubs in ${scoreCount}/${HOLES_MAX_GUESSES}. Beat me: ${url}`
      : `I couldn't crack today's ${BRAND.name}: Clubs. Your turn: ${url}`;
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
          <span aria-hidden="true">🏛️</span>{" "}
          <strong>{challenge?.challengerName || "A friend"}</strong> got
          today&apos;s Clubs in{" "}
          <strong>
            {challenge?.score}/{HOLES_MAX_GUESSES}
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
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Clubs · Day {dayNumber}</p>
        {stats && stats.current > 0 && (
          <div className="brand-streak" title={`Longest: ${stats.longest}`}>
            <span aria-hidden="true">🔥</span> {stats.current} day
            {stats.current === 1 ? "" : "s"}
          </div>
        )}
      </header>

      <div className="tour-filter" role="tablist" aria-label="Tour filter">
        <button
          role="tab"
          aria-selected={tourFilter === "all"}
          className={`tour-filter-btn ${tourFilter === "all" ? "active" : ""}`}
          onClick={() => changeTourFilter("all")}
        >
          All
        </button>
        <button
          role="tab"
          aria-selected={tourFilter === "PGA"}
          className={`tour-filter-btn ${tourFilter === "PGA" ? "active" : ""}`}
          onClick={() => changeTourFilter("PGA")}
        >
          PGA Tour
        </button>
        <button
          role="tab"
          aria-selected={tourFilter === "DPW"}
          className={`tour-filter-btn ${tourFilter === "DPW" ? "active" : ""}`}
          onClick={() => changeTourFilter("DPW")}
        >
          DP World
        </button>
      </div>

      <div className="satellite-frame clubhouse-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Top-down silhouette of today's clubhouse"
          className="satellite-image"
        />
      </div>

      <div className="grid">
        <div className="header-row header-row-hard5">
          <span>Country</span>
          <span>Par</span>
          <span>Direction</span>
          <span>Type</span>
          <span>
            Total
            <br />
            yards
          </span>
        </div>

        {guesses.map((g, i) => (
          <div key={i} className="guess">
            <div className="guess-name">{g.course.shortName}</div>
            <div className="guess-cells guess-cells-hard5">
              <span className={`cell cell-${g.country.state}`}>
                {flagFor(g.course.countryCode)}
              </span>
              <span className={`cell cell-${g.par.state}`}>
                {g.course.par}
                <Arrow arrow={g.par.arrow} />
              </span>
              <span
                className={`cell ${
                  g.direction.distanceMi === 0
                    ? "cell-green"
                    : "cell-direction"
                }`}
              >
                {g.direction.distanceMi === 0 ? (
                  "✓"
                ) : (
                  <span className="direction-content">
                    <span className="direction-miles">
                      {g.direction.distanceMi.toLocaleString()} mi
                    </span>
                    <span className="direction-arrow">
                      {COMPASS_ARROWS[g.direction.bearing ?? "N"]}
                    </span>
                  </span>
                )}
              </span>
              <span className={`cell cell-${g.courseType.state}`}>
                {g.course.courseType}
              </span>
              <span className={`cell cell-${g.yardage.state}`}>
                {g.guessYardage}
                <Arrow arrow={g.yardage.arrow} />
              </span>
            </div>
          </div>
        ))}

        {Array.from({ length: HOLES_MAX_GUESSES - guesses.length }).map(
          (_, i) => (
            <div key={`empty-${i}`} className="guess empty-guess">
              <div className="guess-cells guess-cells-hard5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <span key={j} className="cell cell-empty" />
                ))}
              </div>
            </div>
          ),
        )}
      </div>

      {!isOver && (
        <div className="input-area">
          <input
            type="text"
            value={courseInput}
            onChange={(e) => setCourseInput(e.target.value)}
            placeholder="Type a course name..."
            autoComplete="off"
            autoCapitalize="words"
          />
          {matches.length > 0 && (
            <ul className="suggestions">
              {matches.map((c) => (
                <li key={c.id} onClick={() => submitGuess(c)}>
                  {c.name}{" "}
                  <span className="suggestion-country">{c.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isOver && (
        <div className="answer-card">
          <h3 className="answer-card-title">
            {isWin ? "Got it!" : "Out of guesses"}
          </h3>
          <p className="answer-card-name">
            {flagFor(mystery.countryCode)} {mystery.name}
          </p>
          <p className="answer-card-detail">
            Founded {mystery.yearFounded} · {mystery.courseType} · Par{" "}
            {mystery.par}
          </p>

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

          <NotifySignup gameId="clubs" dayNumber={dayNumber} />
        </div>
      )}

      <footer>
        <p>
          {BRAND.domain} · Clubs · {coursePool("all").length} clubhouses
        </p>
      </footer>
    </main>
  );
}
