import type {
  AttributeReveal,
  CellState,
  Golfer,
  GuessReveal,
} from "./types";

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

function countryReveal(guess: Golfer, mystery: Golfer): AttributeReveal {
  if (guess.countryCode === mystery.countryCode) {
    return { state: "green", arrow: null };
  }
  if (guess.continent === mystery.continent) {
    return { state: "yellow", arrow: null };
  }
  return { state: "grey", arrow: null };
}

function ryderCupReveal(
  guess: Golfer,
  mystery: Golfer,
): AttributeReveal {
  // null = ineligible (player from a non-USA, non-European country).
  // Two ineligible players match exactly (both N/A).
  // One ineligible + one eligible never matches.
  if (guess.ryderCup === null && mystery.ryderCup === null) {
    return { state: "green", arrow: null };
  }
  if (guess.ryderCup === null || mystery.ryderCup === null) {
    return { state: "grey", arrow: null };
  }
  return numericReveal(guess.ryderCup, mystery.ryderCup, 0, 1, 2);
}

export function revealGuess(guess: Golfer, mystery: Golfer): GuessReveal {
  const isWin = guess.id === mystery.id;
  return {
    golfer: guess,
    country: countryReveal(guess, mystery),
    // Reveal windows: green = exact, warm = very close (small arrow),
    // yellow = close, grey = far.
    age: numericReveal(guess.age, mystery.age, 0, 2, 5),
    height: numericReveal(guess.heightCm, mystery.heightCm, 1, 4, 8),
    majors: numericReveal(guess.majors, mystery.majors, 0, 1, 2),
    pgaTourWins: numericReveal(guess.pgaTourWins, mystery.pgaTourWins, 0, 2, 5),
    ryderCup: ryderCupReveal(guess, mystery),
    isWin,
  };
}
