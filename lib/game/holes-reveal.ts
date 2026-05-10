import type { AttributeReveal, CellState } from "./types";
import type {
  CompassDirection,
  Course,
  CourseGuessReveal,
  DirectionReveal,
  HardCourseGuess,
  HardHoleGuess,
} from "./holes-types";

const COMPASS: CompassDirection[] = [
  "N", "NE", "E", "SE", "S", "SW", "W", "NW",
];

function distanceMi(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function compassBearing(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): CompassDirection {
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const x = Math.sin(dLng) * Math.cos(toLat);
  const y =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLng);
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

function directionReveal(guess: Course, mystery: Course): DirectionReveal {
  const d = distanceMi(guess, mystery);
  if (d === 0 || guess.id === mystery.id) {
    return { distanceMi: 0, bearing: null };
  }
  return { distanceMi: d, bearing: compassBearing(guess, mystery) };
}


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

// For the Holes game we treat UK home nations (GB-ENG, GB-SCT, GB-WLS,
// GB-NIR) as a single country: from a course-identification standpoint a
// Scottish links shares more with an English links than with the rest of
// Europe, and the visual signal "British Isles" is the useful one.
function topLevelCountry(countryCode: string): string {
  return countryCode.includes("-") ? countryCode.split("-")[0] : countryCode;
}

function countryReveal(guess: Course, mystery: Course): AttributeReveal {
  if (topLevelCountry(guess.countryCode) === topLevelCountry(mystery.countryCode)) {
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

export function revealHardCourseGuess(
  guess: Course,
  mystery: Course,
): HardCourseGuess {
  return {
    course: guess,
    country: countryReveal(guess, mystery),
    par: numericReveal(guess.par, mystery.par, 0, 1, 2),
    direction: directionReveal(guess, mystery),
    courseType: courseTypeReveal(guess, mystery),
    isCourseMatch: guess.id === mystery.id,
  };
}

export function revealHardHoleGuess(
  holeGuessed: number,
  mysteryHole: number,
): HardHoleGuess {
  return {
    holeGuessed,
    hole: numericReveal(holeGuessed, mysteryHole, 0, 1, 3),
    isHoleMatch: holeGuessed === mysteryHole,
  };
}

export function revealCourseGuess(
  guess: Course,
  holeGuessed: number,
  mystery: Course,
): CourseGuessReveal {
  const courseMatches = guess.id === mystery.id;
  const holeMatches = holeGuessed === mystery.iconicHole;
  return {
    course: guess,
    holeGuessed,
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
    // Hole 1-18; green = exact, warm = within 1, yellow = within 3.
    hole: numericReveal(holeGuessed, mystery.iconicHole, 0, 1, 3),
    isWin: courseMatches && holeMatches,
  };
}
