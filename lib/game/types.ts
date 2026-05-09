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
  turnedProYear: number;
  tier: "S" | "A" | "B" | "C";
}

export type CellState = "green" | "yellow" | "grey";
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
  turnedProYear: AttributeReveal;
  isWin: boolean;
}

export const MAX_GUESSES = 6;
