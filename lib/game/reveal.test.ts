import { describe, expect, it } from "vitest";
import { revealGuess } from "./reveal";
import type { Golfer } from "./types";

const SCOTTIE: Golfer = {
  id: "scottie-scheffler",
  name: "Scottie Scheffler",
  country: "United States",
  countryCode: "US",
  continent: "NA",
  age: 29,
  heightCm: 191,
  majors: 3,
  pgaTourWins: 14,
  turnedProYear: 2018,
  tier: "S",
};

const RORY: Golfer = {
  id: "rory-mcilroy",
  name: "Rory McIlroy",
  country: "Northern Ireland",
  countryCode: "GB-NIR",
  continent: "EU",
  age: 36,
  heightCm: 175,
  majors: 5,
  pgaTourWins: 27,
  turnedProYear: 2007,
  tier: "S",
};

const CAM_SMITH: Golfer = {
  id: "cameron-smith",
  name: "Cameron Smith",
  country: "Australia",
  countryCode: "AU",
  continent: "OC",
  age: 32,
  heightCm: 180,
  majors: 1,
  pgaTourWins: 6,
  turnedProYear: 2013,
  tier: "A",
};

describe("revealGuess", () => {
  it("returns isWin true when guess matches mystery", () => {
    const result = revealGuess(SCOTTIE, SCOTTIE);
    expect(result.isWin).toBe(true);
  });

  it("returns isWin false when guess does not match mystery", () => {
    const result = revealGuess(RORY, SCOTTIE);
    expect(result.isWin).toBe(false);
  });

  it("country: green when codes match exactly", () => {
    const result = revealGuess(SCOTTIE, SCOTTIE);
    expect(result.country).toEqual({ state: "green", arrow: null });
  });

  it("country: yellow when same continent, different country", () => {
    const usGolfer: Golfer = { ...SCOTTIE, id: "x", countryCode: "CA" };
    const result = revealGuess(usGolfer, SCOTTIE);
    expect(result.country).toEqual({ state: "yellow", arrow: null });
  });

  it("country: grey when different continents", () => {
    const result = revealGuess(CAM_SMITH, SCOTTIE);
    expect(result.country).toEqual({ state: "grey", arrow: null });
  });

  it("age: green and no arrow on exact match", () => {
    const result = revealGuess(SCOTTIE, SCOTTIE);
    expect(result.age).toEqual({ state: "green", arrow: null });
  });

  it("age: yellow + up-arrow when mystery older within 3 years", () => {
    const guess = { ...SCOTTIE, age: 27 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "yellow", arrow: "up" });
  });

  it("age: yellow + down-arrow when mystery younger within 3 years", () => {
    const guess = { ...SCOTTIE, age: 31 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "yellow", arrow: "down" });
  });

  it("age: grey beyond yellow window with arrow", () => {
    const guess = { ...SCOTTIE, age: 50 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "grey", arrow: "down" });
  });

  it("height: green within 2cm", () => {
    const guess = { ...SCOTTIE, heightCm: 190 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.height).toEqual({ state: "green", arrow: "up" });
  });

  it("height: yellow within 6cm", () => {
    const guess = { ...SCOTTIE, heightCm: 186 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.height).toEqual({ state: "yellow", arrow: "up" });
  });

  it("majors: yellow + up-arrow when mystery has 1 more", () => {
    const guess = { ...SCOTTIE, majors: 2 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.majors).toEqual({ state: "yellow", arrow: "up" });
  });

  it("majors: grey when off by 2+", () => {
    const result = revealGuess(RORY, SCOTTIE);
    expect(result.majors).toEqual({ state: "grey", arrow: "down" });
  });

  it("turnedProYear: yellow within 3 years", () => {
    const guess = { ...SCOTTIE, turnedProYear: 2020 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.turnedProYear).toEqual({ state: "yellow", arrow: "down" });
  });

  it("pgaTourWins: arrow direction is from guess to mystery", () => {
    const guess = { ...SCOTTIE, pgaTourWins: 5 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.pgaTourWins.arrow).toBe("up");
  });
});
