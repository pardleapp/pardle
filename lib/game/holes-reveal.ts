import type { AttributeReveal, CellState } from "./types";
import type { Course, CourseGuessReveal } from "./holes-types";

function numericReveal(
  guessValue: number,
  mysteryValue: number,
  greenWindow: number,
  warmWindow: number,
  yellowWindow: number,
): AttributeReveal {
  const diff = mysteryValue - guessValue;
  const absDiff = Math.abs(diff);
  let state: CellState;
  if (absDiff <= greenWindow) state = "green";
  else if (absDiff <= warmWindow) state = "warm";
  else if (absDiff <= yellowWindow) state = "yellow";
  else state = "grey";
  const arrow = diff === 0 ? null : diff > 0 ? "up" : "down";
  return { state, arrow };
}

function countryReveal(guess: Course, mystery: Course): AttributeReveal {
  if (guess.countryCode === mystery.countryCode) {
    return { state: "green", arrow: null };
  }
  if (guess.continent === mystery.continent) {
    return { state: "yellow", arrow: null };
  }
  return { state: "grey", arrow: null };
}

function courseTypeReveal(guess: Course, mystery: Course): AttributeReveal {
  if (guess.courseType === mystery.courseType) {
    return { state: "green", arrow: null };
  }
  return { state: "grey", arrow: null };
}

export function revealCourseGuess(
  guess: Course,
  mystery: Course,
): CourseGuessReveal {
  return {
    course: guess,
    country: countryReveal(guess, mystery),
    // Year founded: green within 5 years, warm within 15, yellow within 40.
    yearFounded: numericReveal(
      guess.yearFounded,
      mystery.yearFounded,
      5,
      15,
      40,
    ),
    courseType: courseTypeReveal(guess, mystery),
    // Par: most courses are par 70-72; tight windows.
    par: numericReveal(guess.par, mystery.par, 0, 1, 2),
    isWin: guess.id === mystery.id,
  };
}
