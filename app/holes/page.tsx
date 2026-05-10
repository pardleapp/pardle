"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { COURSES } from "@/lib/data/courses";
import { COURSE_TOURS } from "@/lib/data/course-tours";
import { HOLE_COORDS } from "@/lib/data/hole-coords";
import {
  type Course,
  type CourseGuessReveal,
  type Difficulty,
  type HardCourseGuess,
  type HardHoleGuess,
  type TourFilter,
  HOLES_MAX_GUESSES,
} from "@/lib/game/holes-types";
import type { AttributeReveal, CellState } from "@/lib/game/types";
import {
  revealCourseGuess,
  revealHardCourseGuess,
  revealHardHoleGuess,
} from "@/lib/game/holes-reveal";
import { mapboxStaticUrl } from "@/lib/mapbox";
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

const GAME_ID = "holes";
const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 10);
const DIFFICULTY_KEY = "pardle.holesDifficulty";
const TOUR_FILTER_KEY = "pardle.holesTourFilter";

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
  if (filter === "all") return COURSES;
  return COURSES.filter((c) => {
    const tours = COURSE_TOURS[c.id];
    return tours?.includes(filter);
  });
}

function loadDifficulty(): Difficulty {
  if (typeof window === "undefined") return "easy";
  try {
    const stored = window.localStorage.getItem(DIFFICULTY_KEY);
    return stored === "hard" ? "hard" : "easy";
  } catch {
    return "easy";
  }
}

function saveDifficulty(d: Difficulty): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    // ignore
  }
}

interface SatelliteCoords {
  lat: number;
  lng: number;
  zoom: number;
  bbox?: [number, number, number, number];
  path?: string;
}

function coordsForView(course: Course, difficulty: Difficulty): SatelliteCoords {
  if (difficulty === "hard") {
    // Hand-curated coords on the Course type win first.
    if (
      course.iconicHoleLat !== undefined &&
      course.iconicHoleLng !== undefined
    ) {
      return {
        lat: course.iconicHoleLat,
        lng: course.iconicHoleLng,
        zoom: course.iconicHoleZoom ?? 18,
      };
    }
    // Then OSM-derived coords for a real numbered hole on the property.
    // When the OSM record includes a bbox + path (hole-line geometry),
    // we use those so Mapbox auto-fits the whole hole and overlays the
    // tee->green line in yellow.
    const osm = HOLE_COORDS[course.id];
    if (osm) {
      return {
        lat: osm.lat,
        lng: osm.lng,
        zoom: osm.zoom,
        bbox: osm.bbox,
        path: osm.path,
      };
    }
    // Final fallback: zoom in on the Wikipedia centroid (often clubhouse-adjacent).
    return { lat: course.lat, lng: course.lng, zoom: 18 };
  }
  return { lat: course.lat, lng: course.lng, zoom: course.zoom };
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

// Per-filter starting offsets so each filter rotates through its own pool
// independently from day 0 — without this, all three filters would land on
// pool[0] (Augusta) on launch day since Augusta is first in COURSES and
// passes both the PGA and DPW filters.
function filterDayOffset(filter: TourFilter): number {
  if (filter === "PGA") return 11;
  if (filter === "DPW") return 23;
  return 0;
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

function stateToEmoji(state: CellState): string {
  if (state === "green") return "🟩";
  if (state === "warm" || state === "yellow") return "🟨";
  return "⬛";
}

function buildShareText(
  guesses: CourseGuessReveal[],
  dayNumber: number,
  won: boolean,
): string {
  const result = won ? `${guesses.length}/${HOLES_MAX_GUESSES}` : `X/${HOLES_MAX_GUESSES}`;
  const grid = guesses
    .map((g) =>
      [
        stateToEmoji(g.country.state),
        stateToEmoji(g.yearFounded.state),
        stateToEmoji(g.courseType.state),
        stateToEmoji(g.par.state),
        stateToEmoji(g.hole.state),
      ].join(""),
    )
    .join("\n");
  return `${BRAND.name}: Holes #${dayNumber} ${result}\n${grid}\n${BRAND.domain}/holes`;
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
    return { line: `You beat ${friendName} — they didn't solve it.`, outcome: "win" };
  }
  if (myScore < friendScore) {
    return { line: `You beat ${friendName} by ${friendScore - myScore}!`, outcome: "win" };
  }
  if (myScore > friendScore) {
    return { line: `${friendName} beat you by ${myScore - friendScore}.`, outcome: "lose" };
  }
  return { line: `Tied with ${friendName}.`, outcome: "tie" };
}

export default function HolesPage() {
  const [tourFilter, setTourFilter] = useState<TourFilter>("all");
  const mystery = useMemo(() => pickMysteryCourse(tourFilter), [tourFilter]);
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  // Easy mode guesses (course + hole as one pair, current behavior).
  const [guesses, setGuesses] = useState<CourseGuessReveal[]>([]);
  const [courseInput, setCourseInput] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [holeInput, setHoleInput] = useState("");
  // Hard mode guesses — split into two phases. Once a hard course guess
  // matches, we flip to the hole phase and the player narrows on holes.
  const [hardCourseGuesses, setHardCourseGuesses] = useState<HardCourseGuess[]>([]);
  const [hardHoleGuesses, setHardHoleGuesses] = useState<HardHoleGuess[]>([]);
  const [hardCourseInput, setHardCourseInput] = useState("");
  const [hardHoleInput, setHardHoleInput] = useState("");
  const [stats, setStats] = useState<PardleStats | null>(null);
  const [challenge, setChallenge] = useState<ChallengePayload | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [challengeCopied, setChallengeCopied] = useState(false);
  // Difficulty starts on "easy" for SSR consistency, then hydrates from
  // localStorage in the effect below. Avoids hydration mismatch warnings.
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");

  const satelliteUrl = useMemo(() => {
    const view = coordsForView(mystery, difficulty);
    return mapboxStaticUrl({
      lat: view.lat,
      lng: view.lng,
      zoom: view.zoom,
      bbox: view.bbox,
      path: view.path,
      width: 600,
      height: 400,
    });
  }, [mystery, difficulty]);

  // Easy mode win/lose
  const easyWin = guesses.some((g) => g.isWin);
  const easyLose = !easyWin && guesses.length >= HOLES_MAX_GUESSES;

  // Hard mode: course phase is "done" once a match lands. Then hole phase.
  const hardCourseFound = hardCourseGuesses.some((g) => g.isCourseMatch);
  const hardHoleFound = hardHoleGuesses.some((g) => g.isHoleMatch);
  const hardGuessesUsed =
    hardCourseGuesses.length + hardHoleGuesses.length;
  const hardWin = hardCourseFound && hardHoleFound;
  const hardLose = !hardWin && hardGuessesUsed >= HOLES_MAX_GUESSES;

  const isWin = difficulty === "hard" ? hardWin : easyWin;
  const isLose = difficulty === "hard" ? hardLose : easyLose;
  const isOver = isWin || isLose;
  // For backwards-compatible streak/share — score = guess count used.
  const scoreCount =
    difficulty === "hard" ? hardGuessesUsed : guesses.length;

  useEffect(() => {
    setStats(applyMissedDayReset(GAME_ID, dayNumber));
    setDifficulty(loadDifficulty());
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
    setSelectedCourse(null);
    setCourseInput("");
    setHoleInput("");
    setHardCourseGuesses([]);
    setHardHoleGuesses([]);
    setHardCourseInput("");
    setHardHoleInput("");
  }

  const hasActiveGuesses =
    guesses.length > 0 ||
    hardCourseGuesses.length > 0 ||
    hardHoleGuesses.length > 0;

  function changeDifficulty(d: Difficulty) {
    if (d === difficulty) return;
    if (hasActiveGuesses && !isOver) {
      const ok = window.confirm(
        "Switching difficulty mid-puzzle will reset your guesses. Continue?",
      );
      if (!ok) return;
      resetAllGameState();
    }
    setDifficulty(d);
    saveDifficulty(d);
  }

  function changeTourFilter(f: TourFilter) {
    if (f === tourFilter) return;
    if (hasActiveGuesses && !isOver) {
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
    return pool
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.shortName.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [courseInput, tourFilter]);

  function chooseCourse(course: Course) {
    setSelectedCourse(course);
    setCourseInput("");
  }

  function clearCourse() {
    setSelectedCourse(null);
    setHoleInput("");
  }

  function submitGuess() {
    if (isOver || !selectedCourse) return;
    const holeNum = Number.parseInt(holeInput, 10);
    if (!Number.isInteger(holeNum) || holeNum < 1 || holeNum > 18) return;
    setGuesses((prev) => [
      ...prev,
      revealCourseGuess(selectedCourse, holeNum, mystery),
    ]);
    setSelectedCourse(null);
    setCourseInput("");
    setHoleInput("");
  }

  function submitHardCourseGuess(course: Course) {
    if (isOver || hardCourseFound) return;
    setHardCourseGuesses((prev) => [
      ...prev,
      revealHardCourseGuess(course, mystery),
    ]);
    setHardCourseInput("");
  }

  function submitHardHoleGuess() {
    if (isOver || !hardCourseFound) return;
    const holeNum = Number.parseInt(hardHoleInput, 10);
    if (!Number.isInteger(holeNum) || holeNum < 1 || holeNum > 18) return;
    setHardHoleGuesses((prev) => [
      ...prev,
      revealHardHoleGuess(holeNum, mystery.iconicHole),
    ]);
    setHardHoleInput("");
  }

  const hardMatches = useMemo(() => {
    const q = hardCourseInput.trim().toLowerCase();
    if (!q) return [];
    const pool = coursePool(tourFilter);
    const alreadyGuessed = new Set(hardCourseGuesses.map((g) => g.course.id));
    return pool
      .filter(
        (c) =>
          !alreadyGuessed.has(c.id) &&
          (c.name.toLowerCase().includes(q) ||
            c.shortName.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [hardCourseInput, tourFilter, hardCourseGuesses]);

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
    // Easy mode uses the existing 5-emoji grid; hard mode falls back to a
    // simple summary line since the reveal cells aren't 1:1 with easy mode.
    const shareText =
      difficulty === "hard"
        ? `${BRAND.name}: Holes #${dayNumber} ${isWin ? scoreCount : "X"}/${HOLES_MAX_GUESSES} (Hard)\n${BRAND.domain}/holes`
        : buildShareText(guesses, dayNumber, isWin);
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
    const url = `${BRAND.url}/holes?c=${token}`;
    const text = isWin
      ? `I solved today's ${BRAND.name}: Holes in ${scoreCount}/${HOLES_MAX_GUESSES}. Beat me: ${url}`
      : `I couldn't crack today's ${BRAND.name}: Holes. Your turn: ${url}`;
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
          <span aria-hidden="true">🛰️</span>{" "}
          <strong>{challenge?.challengerName || "A friend"}</strong> got
          today&apos;s Holes in{" "}
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
        <p className="subtitle">Holes · Day {dayNumber}</p>
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

      <div className="difficulty-toggle" role="tablist" aria-label="Difficulty">
        <button
          role="tab"
          aria-selected={difficulty === "easy"}
          className={`difficulty-toggle-btn ${
            difficulty === "easy" ? "active" : ""
          }`}
          onClick={() => changeDifficulty("easy")}
        >
          Easy <span className="difficulty-toggle-hint">whole course</span>
        </button>
        <button
          role="tab"
          aria-selected={difficulty === "hard"}
          className={`difficulty-toggle-btn ${
            difficulty === "hard" ? "active" : ""
          }`}
          onClick={() => changeDifficulty("hard")}
        >
          Hard <span className="difficulty-toggle-hint">single hole</span>
        </button>
      </div>

      <div className="satellite-frame">
        {satelliteUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={satelliteUrl}
            alt="Satellite view of today's course"
            className="satellite-image"
          />
        ) : (
          <div className="satellite-fallback">
            <p>Satellite imagery unavailable.</p>
            <p className="satellite-fallback-note">
              Mapbox token missing or rate-limited.
            </p>
          </div>
        )}
      </div>

      {difficulty === "easy" && (
        <div className="grid">
          <div className="header-row header-row-5">
            <span>Country</span>
            <span>
              Year
              <br />
              built
            </span>
            <span>Type</span>
            <span>Par</span>
            <span>Hole</span>
          </div>

          {guesses.map((g, i) => (
            <div key={i} className="guess">
              <div className="guess-name">
                {g.course.shortName} · #{g.holeGuessed}
              </div>
              <div className="guess-cells guess-cells-5">
                <span className={`cell cell-${g.country.state}`}>
                  {flagFor(g.course.countryCode)}
                </span>
                <span className={`cell cell-${g.yearFounded.state}`}>
                  {g.course.yearFounded}
                  <Arrow arrow={g.yearFounded.arrow} />
                </span>
                <span className={`cell cell-${g.courseType.state}`}>
                  {g.course.courseType}
                </span>
                <span className={`cell cell-${g.par.state}`}>
                  {g.course.par}
                  <Arrow arrow={g.par.arrow} />
                </span>
                <span className={`cell cell-${g.hole.state}`}>
                  {g.holeGuessed}
                  <Arrow arrow={g.hole.arrow} />
                </span>
              </div>
            </div>
          ))}

          {Array.from({ length: HOLES_MAX_GUESSES - guesses.length }).map(
            (_, i) => (
              <div key={`empty-${i}`} className="guess empty-guess">
                <div className="guess-cells guess-cells-5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <span key={j} className="cell cell-empty" />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {difficulty === "hard" && (
        <div className="grid">
          <div className="hard-phase-label">
            {hardCourseFound
              ? `Course found in ${hardCourseGuesses.length} — now guess the hole`
              : `Guess the course (${hardGuessesUsed}/${HOLES_MAX_GUESSES} used)`}
          </div>

          {hardCourseGuesses.length > 0 && (
            <>
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
              {hardCourseGuesses.map((g, i) => (
                <div key={`hc-${i}`} className="guess">
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
                          : "cell-info"
                      }`}
                    >
                      {g.direction.distanceMi === 0
                        ? "✓"
                        : `${g.direction.bearing} ${g.direction.distanceMi}mi`}
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
            </>
          )}

          {hardCourseFound && hardHoleGuesses.length > 0 && (
            <>
              <div className="header-row header-row-1">
                <span>Hole guess</span>
              </div>
              {hardHoleGuesses.map((g, i) => (
                <div key={`hh-${i}`} className="guess">
                  <div className="guess-cells guess-cells-1">
                    <span className={`cell cell-${g.hole.state}`}>
                      Hole {g.holeGuessed}
                      <Arrow arrow={g.hole.arrow} />
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* EASY MODE: pick course, then enter hole, submit as a pair. */}
      {!isOver && difficulty === "easy" && !selectedCourse && (
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
                <li key={c.id} onClick={() => chooseCourse(c)}>
                  {c.name}{" "}
                  <span className="suggestion-country">{c.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isOver && difficulty === "easy" && selectedCourse && (
        <div className="hole-input-row">
          <div className="selected-course-pill">
            <span className="selected-course-name">
              {selectedCourse.shortName}
            </span>
            <button
              type="button"
              className="selected-course-clear"
              onClick={clearCourse}
              aria-label="Pick a different course"
            >
              ×
            </button>
          </div>
          <input
            className="hole-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={18}
            value={holeInput}
            onChange={(e) => setHoleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGuess();
            }}
            placeholder="Hole #"
            autoFocus
          />
          <button
            type="button"
            className="hole-submit"
            onClick={submitGuess}
            disabled={
              !holeInput ||
              Number.parseInt(holeInput, 10) < 1 ||
              Number.parseInt(holeInput, 10) > 18
            }
          >
            Guess
          </button>
        </div>
      )}

      {/* HARD MODE PHASE 1: guess the course. */}
      {!isOver && difficulty === "hard" && !hardCourseFound && (
        <div className="input-area">
          <input
            type="text"
            value={hardCourseInput}
            onChange={(e) => setHardCourseInput(e.target.value)}
            placeholder="Type a course name..."
            autoComplete="off"
            autoCapitalize="words"
          />
          {hardMatches.length > 0 && (
            <ul className="suggestions">
              {hardMatches.map((c) => (
                <li key={c.id} onClick={() => submitHardCourseGuess(c)}>
                  {c.name}{" "}
                  <span className="suggestion-country">{c.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* HARD MODE PHASE 2: course is found, now guess the hole. */}
      {!isOver && difficulty === "hard" && hardCourseFound && (
        <div className="hole-input-row">
          <div className="selected-course-pill">
            <span className="selected-course-name">{mystery.shortName}</span>
          </div>
          <input
            className="hole-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={18}
            value={hardHoleInput}
            onChange={(e) => setHardHoleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitHardHoleGuess();
            }}
            placeholder="Hole #"
            autoFocus
          />
          <button
            type="button"
            className="hole-submit"
            onClick={submitHardHoleGuess}
            disabled={
              !hardHoleInput ||
              Number.parseInt(hardHoleInput, 10) < 1 ||
              Number.parseInt(hardHoleInput, 10) > 18
            }
          >
            Guess
          </button>
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
          <p className="answer-card-iconic">
            Iconic hole: <strong>#{mystery.iconicHole}</strong>
            {mystery.iconicHoleNote ? ` — ${mystery.iconicHoleNote}` : ""}
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
        </div>
      )}

      <footer>
        <p>
          {BRAND.domain} · Holes · {COURSES.length} courses
        </p>
      </footer>
    </main>
  );
}
