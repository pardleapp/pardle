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
  majors: 4,
  pgaTourWins: 20,
  ryderCup: 2,
  imageUrl: null,
  tier: "S",
};

const RORY: Golfer = {
  id: "rory-mcilroy",
  name: "Rory McIlroy",
  country: "Northern Ireland",
  countryCode: "GB-NIR",
  continent: "EU",
  age: 37,
  heightCm: 175,
  majors: 6,
  pgaTourWins: 30,
  ryderCup: 8,
  imageUrl: null,
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
  ryderCup: null,
  imageUrl: null,
  tier: "A",
};

const HIDEKI: Golfer = {
  id: "hideki-matsuyama",
  name: "Hideki Matsuyama",
  country: "Japan",
  countryCode: "JP",
  continent: "AS",
  age: 34,
  heightCm: 180,
  majors: 1,
  pgaTourWins: 11,
  ryderCup: null,
  imageUrl: null,
  tier: "S",
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

  it("age: warm + up-arrow when mystery older within 2 years", () => {
    const guess = { ...SCOTTIE, age: 27 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "warm", arrow: "up" });
  });

  it("age: yellow when off by 4 years", () => {
    const guess = { ...SCOTTIE, age: 33 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "yellow", arrow: "down" });
  });

  it("age: grey beyond yellow window with arrow", () => {
    const guess = { ...SCOTTIE, age: 50 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.age).toEqual({ state: "grey", arrow: "down" });
  });

  it("height: green within 1cm", () => {
    const guess = { ...SCOTTIE, heightCm: 190 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.height).toEqual({ state: "green", arrow: "up" });
  });

  it("height: warm within 4cm", () => {
    const guess = { ...SCOTTIE, heightCm: 188 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.height).toEqual({ state: "warm", arrow: "up" });
  });

  it("height: yellow when 7cm off", () => {
    const guess = { ...SCOTTIE, heightCm: 184 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.height).toEqual({ state: "yellow", arrow: "up" });
  });

  it("majors: warm + up-arrow when mystery has 1 more", () => {
    const guess = { ...SCOTTIE, majors: 3 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.majors).toEqual({ state: "warm", arrow: "up" });
  });

  it("majors: grey when off by 3+", () => {
    const guess = { ...SCOTTIE, majors: 0 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.majors).toEqual({ state: "grey", arrow: "up" });
  });

  it("ryderCup: green when both ineligible (both null)", () => {
    const result = revealGuess(CAM_SMITH, HIDEKI);
    expect(result.ryderCup).toEqual({ state: "green", arrow: null });
  });

  it("ryderCup: grey with down-arrow when guess eligible, mystery ineligible", () => {
    // SCOTTIE=2, CAM_SMITH=null. null treated as 0 for direction.
    const result = revealGuess(SCOTTIE, CAM_SMITH);
    expect(result.ryderCup).toEqual({ state: "grey", arrow: "down" });
  });

  it("ryderCup: grey with up-arrow when guess ineligible, mystery eligible", () => {
    const result = revealGuess(CAM_SMITH, SCOTTIE);
    expect(result.ryderCup).toEqual({ state: "grey", arrow: "up" });
  });

  it("ryderCup: green + no arrow on exact match", () => {
    const result = revealGuess(SCOTTIE, SCOTTIE);
    expect(result.ryderCup).toEqual({ state: "green", arrow: null });
  });

  it("ryderCup: warm + arrow when off by 1", () => {
    const guess = { ...SCOTTIE, ryderCup: 1 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.ryderCup).toEqual({ state: "warm", arrow: "up" });
  });

  it("ryderCup: grey when both eligible but off by many", () => {
    const result = revealGuess(SCOTTIE, RORY);
    expect(result.ryderCup).toEqual({ state: "grey", arrow: "up" });
  });

  it("pgaTourWins: arrow direction is from guess to mystery", () => {
    const guess = { ...SCOTTIE, pgaTourWins: 5 };
    const result = revealGuess(guess, SCOTTIE);
    expect(result.pgaTourWins.arrow).toBe("up");
  });
});
