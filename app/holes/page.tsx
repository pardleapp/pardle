"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { COURSES } from "@/lib/data/courses";
import {
  type Course,
  type CourseGuessReveal,
  HOLES_MAX_GUESSES,
} from "@/lib/game/holes-types";
import type { AttributeReveal } from "@/lib/game/types";
import { revealCourseGuess } from "@/lib/game/holes-reveal";
import { mapboxStaticUrl } from "@/lib/mapbox";

const LAUNCH_DATE_UTC = Date.UTC(2026, 4, 10);

function dayIndexToday(): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - LAUNCH_DATE_UTC) / (1000 * 60 * 60 * 24));
}

function pickMysteryCourse(): Course {
  const dayIdx = dayIndexToday();
  const safe = ((dayIdx % COURSES.length) + COURSES.length) % COURSES.length;
  return COURSES[safe];
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

export default function HolesPage() {
  const mystery = useMemo(() => pickMysteryCourse(), []);
  const dayNumber = useMemo(() => dayIndexToday() + 1, []);
  const [guesses, setGuesses] = useState<CourseGuessReveal[]>([]);
  const [input, setInput] = useState("");
  const satelliteUrl = useMemo(
    () =>
      mapboxStaticUrl({
        lat: mystery.lat,
        lng: mystery.lng,
        zoom: mystery.zoom,
        width: 600,
        height: 400,
      }),
    [mystery],
  );

  const isWin = guesses.some((g) => g.isWin);
  const isLose = !isWin && guesses.length >= HOLES_MAX_GUESSES;
  const isOver = isWin || isLose;

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return COURSES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.shortName.toLowerCase().includes(q),
    )
      .filter((c) => !guesses.some((g) => g.course.id === c.id))
      .slice(0, 6);
  }, [input, guesses]);

  function submitGuess(course: Course) {
    if (isOver) return;
    setGuesses((prev) => [...prev, revealCourseGuess(course, mystery)]);
    setInput("");
  }

  return (
    <main className="container">
      <header className="brand">
        <Link className="brand-back" href="/" aria-label="All games">
          ←
        </Link>
        <h1>{BRAND.name}</h1>
        <p className="subtitle">Holes · Guess the course #{dayNumber}</p>
      </header>

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

      <div className="grid">
        <div className="header-row">
          <span>Country</span>
          <span>
            Year
            <br />
            built
          </span>
          <span>Type</span>
          <span>Par</span>
        </div>

        {guesses.map((g, i) => (
          <div key={i} className="guess">
            <div className="guess-name">{g.course.shortName}</div>
            <div className="guess-cells guess-cells-4">
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
            </div>
          </div>
        ))}

        {Array.from({ length: HOLES_MAX_GUESSES - guesses.length }).map(
          (_, i) => (
            <div key={`empty-${i}`} className="guess empty-guess">
              <div className="guess-cells guess-cells-4">
                {Array.from({ length: 4 }).map((_, j) => (
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
          <p className="answer-card-iconic">
            Iconic hole: <strong>#{mystery.iconicHole}</strong>
            {mystery.iconicHoleNote ? ` — ${mystery.iconicHoleNote}` : ""}
          </p>
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
