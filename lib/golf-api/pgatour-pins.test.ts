/**
 * Tests for parseCoursePinsPayload's raw/enhanced coord fallback and
 * roundless-pin replication. The pipeline that turned "we only have
 * birdie data for 2 years" into "we have 7 years" runs through here.
 */
import { describe, expect, it } from "vitest";
import { parseCoursePinsPayload, pickPinCoord } from "./pgatour";

describe("pickPinCoord — enhanced/raw fallback", () => {
  it("prefers enhanced when both are valid", () => {
    expect(
      pickPinCoord({
        x: 0.5,
        y: 0.7,
        enhancedX: 0.48,
        enhancedY: 0.61,
      }),
    ).toEqual({ x: 0.48, y: 0.61 });
  });

  it("falls back to raw when enhanced is the -1 sentinel (2023 case)", () => {
    expect(
      pickPinCoord({
        x: 0.5,
        y: 0.7,
        enhancedX: -1,
        enhancedY: -1,
      }),
    ).toEqual({ x: 0.5, y: 0.7 });
  });

  it("falls back to raw when enhanced fields are undefined", () => {
    expect(pickPinCoord({ x: 0.5, y: 0.7 })).toEqual({ x: 0.5, y: 0.7 });
  });

  it("returns null when raw is also -1 sentinel", () => {
    expect(
      pickPinCoord({ x: -1, y: -1, enhancedX: -1, enhancedY: -1 }),
    ).toBeNull();
  });

  it("returns null on missing / null / undefined coord blob", () => {
    expect(pickPinCoord(undefined)).toBeNull();
    expect(pickPinCoord(null)).toBeNull();
    expect(pickPinCoord({})).toBeNull();
  });

  it("returns null when only one axis is populated", () => {
    expect(pickPinCoord({ x: 0.5, y: -1 })).toBeNull();
    expect(pickPinCoord({ enhancedX: 0.5, enhancedY: -1 })).toBeNull();
  });
});

describe("parseCoursePinsPayload — full season shapes", () => {
  /** Modern seasons (2024-2025): per-round data, enhanced coords
   *  populated. Every pin from roundHoleStats R1-R4 lands in
   *  pinByRound with its enhanced x/y. */
  it("modern season — per-round enhanced pins", () => {
    const raw = {
      courseStats: {
        courses: [
          {
            roundHoleStats: [
              {
                roundNum: 1,
                holeStats: [
                  {
                    courseHoleNum: 3,
                    parValue: "4",
                    yards: 445,
                    pinGreen: {
                      leftToRightCoords: {
                        x: 0.51,
                        y: 0.72,
                        enhancedX: 0.49,
                        enhancedY: 0.61,
                      },
                    },
                    holePickle: { greenLeftToRight: "" },
                  },
                ],
              },
              {
                roundNum: 4,
                holeStats: [
                  {
                    courseHoleNum: 3,
                    parValue: "4",
                    yards: 445,
                    pinGreen: {
                      leftToRightCoords: {
                        x: 0.64,
                        y: 0.68,
                        enhancedX: 0.61,
                        enhancedY: 0.66,
                      },
                    },
                    holePickle: { greenLeftToRight: "" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const sheet = parseCoursePinsPayload("R2025525", raw);
    expect(sheet).not.toBeNull();
    expect(sheet!.holes).toHaveLength(1);
    const h = sheet!.holes[0];
    expect(h.holeNumber).toBe(3);
    expect(h.par).toBe(4);
    expect(h.pinByRound).toEqual({
      1: { x: 0.49, y: 0.61 },
      4: { x: 0.61, y: 0.66 },
    });
  });

  /** 2023: per-round data present, but every enhanced pair is the
   *  -1 sentinel. Parser falls back to raw x/y so R1-R4 pins all
   *  land in pinByRound. */
  it("2023 shape — per-round raw when enhanced is -1", () => {
    const raw = {
      courseStats: {
        courses: [
          {
            roundHoleStats: [
              { roundNum: 1, x: 0.52, y: 0.69 },
              { roundNum: 2, x: 0.54, y: 0.68 },
              { roundNum: 3, x: 0.56, y: 0.67 },
              { roundNum: 4, x: 0.58, y: 0.66 },
            ].map(({ roundNum, x, y }) => ({
              roundNum,
              holeStats: [
                {
                  courseHoleNum: 3,
                  parValue: "4",
                  yards: 445,
                  pinGreen: {
                    leftToRightCoords: {
                      x,
                      y,
                      enhancedX: -1,
                      enhancedY: -1,
                    },
                  },
                  holePickle: { greenLeftToRight: "" },
                },
              ],
            })),
          },
        ],
      },
    };
    const sheet = parseCoursePinsPayload("R2023525", raw);
    expect(sheet).not.toBeNull();
    const h = sheet!.holes[0];
    expect(h.pinByRound[1]).toEqual({ x: 0.52, y: 0.69 });
    expect(h.pinByRound[2]).toEqual({ x: 0.54, y: 0.68 });
    expect(h.pinByRound[3]).toEqual({ x: 0.56, y: 0.67 });
    expect(h.pinByRound[4]).toEqual({ x: 0.58, y: 0.66 });
  });

  /** 2019-2022: only roundNum=null. Parser replicates that single
   *  pin across R1-R4 so per-round birdie counts still join. */
  it("older season — roundless pin replicated to R1-R4", () => {
    const raw = {
      courseStats: {
        courses: [
          {
            roundHoleStats: [
              {
                roundNum: null,
                holeStats: [
                  {
                    courseHoleNum: 3,
                    parValue: "4",
                    yards: 440,
                    pinGreen: {
                      leftToRightCoords: {
                        x: 0.53,
                        y: 0.71,
                        enhancedX: -1,
                        enhancedY: -1,
                      },
                    },
                    holePickle: { greenLeftToRight: "" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const sheet = parseCoursePinsPayload("R2020525", raw);
    expect(sheet).not.toBeNull();
    const h = sheet!.holes[0];
    expect(h.pinByRound).toEqual({
      1: { x: 0.53, y: 0.71 },
      2: { x: 0.53, y: 0.71 },
      3: { x: 0.53, y: 0.71 },
      4: { x: 0.53, y: 0.71 },
    });
    expect(h.par).toBe(4);
  });

  /** Mixed shape (defensive): if BOTH a roundless entry AND real
   *  per-round entries exist for the same hole, the per-round
   *  values win and the roundless one only fills gaps. */
  it("mixed shape — per-round wins over roundless fallback", () => {
    const raw = {
      courseStats: {
        courses: [
          {
            roundHoleStats: [
              {
                roundNum: null,
                holeStats: [
                  {
                    courseHoleNum: 3,
                    parValue: "4",
                    pinGreen: {
                      leftToRightCoords: {
                        x: 0.99,
                        y: 0.99,
                        enhancedX: -1,
                        enhancedY: -1,
                      },
                    },
                  },
                ],
              },
              {
                roundNum: 2,
                holeStats: [
                  {
                    courseHoleNum: 3,
                    parValue: "4",
                    pinGreen: {
                      leftToRightCoords: {
                        x: 0.5,
                        y: 0.5,
                        enhancedX: 0.48,
                        enhancedY: 0.48,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const sheet = parseCoursePinsPayload("R2023525", raw);
    const h = sheet!.holes[0];
    expect(h.pinByRound[2]).toEqual({ x: 0.48, y: 0.48 });
    // R1, R3, R4 fall back to the roundless pin
    expect(h.pinByRound[1]).toEqual({ x: 0.99, y: 0.99 });
    expect(h.pinByRound[3]).toEqual({ x: 0.99, y: 0.99 });
    expect(h.pinByRound[4]).toEqual({ x: 0.99, y: 0.99 });
  });

  it("returns null when courseStats is empty", () => {
    expect(
      parseCoursePinsPayload("X", { courseStats: { courses: [] } }),
    ).toBeNull();
    expect(parseCoursePinsPayload("X", null)).toBeNull();
    expect(
      parseCoursePinsPayload("X", { courseStats: null }),
    ).toBeNull();
  });
});
