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
  yellowWindow: number,
): AttributeReveal {
  const diff = mysteryValue - guessValue;
  const absDiff = Math.abs(diff);

  let state: CellState;
  if (absDiff <= greenWindow) state = "green";
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

export function revealGuess(guess: Golfer, mystery: Golfer): GuessReveal {
  const isWin = guess.id === mystery.id;
  return {
    golfer: guess,
    country: countryReveal(guess, mystery),
    age: numericReveal(guess.age, mystery.age, 0, 3),
    height: numericReveal(guess.heightCm, mystery.heightCm, 2, 6),
    majors: numericReveal(guess.majors, mystery.majors, 0, 1),
    pgaTourWins: numericReveal(guess.pgaTourWins, mystery.pgaTourWins, 0, 3),
    turnedProYear: numericReveal(
      guess.turnedProYear,
      mystery.turnedProYear,
      0,
      3,
    ),
    isWin,
  };
}
