export type Continent = "NA" | "SA" | "EU" | "AS" | "AF" | "OC";

export interface Golfer {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  continent: Continent;
  age: number;
  heightCm: number;
  majors: number;
  pgaTourWins: number;
  /** Ryder Cup appearances. null = ineligible (not from USA or Europe). */
  ryderCup: number | null;
  tier: "S" | "A" | "B" | "C";
}

export type CellState = "green" | "warm" | "yellow" | "grey";
export type Arrow = "up" | "down" | null;

export interface AttributeReveal {
  state: CellState;
  arrow: Arrow;
}

export interface GuessReveal {
  golfer: Golfer;
  country: AttributeReveal;
  age: AttributeReveal;
  height: AttributeReveal;
  majors: AttributeReveal;
  pgaTourWins: AttributeReveal;
  ryderCup: AttributeReveal;
  isWin: boolean;
}

export const MAX_GUESSES = 6;
