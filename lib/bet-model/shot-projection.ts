/**
 * Per-shot hole projection.
 *
 * Given an IMG shot event that has just landed, compute the expected
 * total strokes for THIS hole based on where the ball ended up + how
 * many shots the player has already taken.
 *
 *   projected_hole_total = imgShotNum + expected_remaining_from_position
 *
 * This is the whole point of the shot-level bet tracker: as the ball
 * moves closer to the pin, expected_remaining drops, so the
 * projected total drops, so the bet's implied outcome moves — all
 * before the hole actually completes.
 */

import type { FeedEvent } from "@/lib/feed/types";
import { expectedPutts, strokesToHole } from "./expected-strokes";

export interface PlayerSkill {
  /** DG per-round SG stats. Default 0 = tour average. */
  sgApp?: number;
  sgArg?: number;
  sgPutt?: number;
}

export interface ShotHoleProjection {
  /** Expected total strokes for this hole given the ball's position. */
  expectedTotal: number;
  /** Expected total minus par. Signed. */
  expectedVsPar: number;
  /** Shot number just completed. */
  shotsTaken: number;
  /** Expected remaining strokes from the ball's current position. */
  expectedRemaining: number;
  /** Whether the hole is already complete (Ball Holed). */
  isHoled: boolean;
}

/** Normalise IMG surface strings to the LIE_PENALTY keys. */
export function normaliseLie(imgSurface: string | undefined | null): string {
  const s = (imgSurface || "").toLowerCase();
  if (!s) return "unknown";
  if (/ball\s*holed/.test(s)) return "holed";
  if (/deep\s*rough/.test(s)) return "deep_rough";
  if (/green/.test(s)) return "green";
  if (/fringe|collar/.test(s)) return "fringe";
  if (/fairway/.test(s)) return "fairway";
  if (/bunker|sand/.test(s)) return "bunker";
  if (/native|waste/.test(s)) return "native";
  if (/rough/.test(s)) return "rough";
  if (/tree/.test(s)) return "trees";
  if (/water|hazard|penalty/.test(s)) return "water";
  if (/tee/.test(s)) return "tee";
  return "unknown";
}

/**
 * Parse imgToPin into {value, unit}.
 *   "163yds"       → { value: 163, unit: 'yds' }
 *   "163 yds"      → { value: 163, unit: 'yds' }
 *   "9ft. 6in."    → { value: 9.5, unit: 'ft' }
 *   "0ft. 2in."    → { value: 0.167, unit: 'ft' }
 *   "5ft 1in to pin" → { value: 5.083, unit: 'ft' }
 */
export function parseToPin(
  imgToPin: string | undefined | null,
): { value: number; unit: "yds" | "ft" } | null {
  if (!imgToPin) return null;
  const t = imgToPin.trim();
  const ydsMatch = t.match(/(\d+(?:\.\d+)?)\s*yds?/i);
  if (ydsMatch) return { value: parseFloat(ydsMatch[1]), unit: "yds" };
  const ftMatch = t.match(/(\d+(?:\.\d+)?)\s*ft/i);
  if (ftMatch) {
    const ft = parseFloat(ftMatch[1]);
    const inMatch = t.match(/(\d+(?:\.\d+)?)\s*in/i);
    const inch = inMatch ? parseFloat(inMatch[1]) : 0;
    return { value: ft + inch / 12, unit: "ft" };
  }
  return null;
}

/**
 * Compute the expected hole total for a shot event. Returns null
 * when the event isn't an IMG-sourced shot or the shape is missing
 * required fields.
 */
export function projectShotOnHole(
  ev: FeedEvent,
  skill: PlayerSkill = {},
): ShotHoleProjection | null {
  if (ev.type !== "shot") return null;
  if (!ev.imgSourced) return null;
  const shotNum = ev.imgShotNum;
  const par = ev.par;
  if (typeof shotNum !== "number" || shotNum < 1) return null;
  if (typeof par !== "number" || par < 3) return null;

  const lie = normaliseLie(ev.imgSurface);

  // Ball Holed on this shot — hole is finished, expected_remaining = 0.
  if (lie === "holed") {
    return {
      expectedTotal: shotNum,
      expectedVsPar: shotNum - par,
      shotsTaken: shotNum,
      expectedRemaining: 0,
      isHoled: true,
    };
  }

  const toPin = parseToPin(ev.imgToPin);
  let expectedRemaining: number;

  if (lie === "green") {
    const distFt =
      toPin == null
        ? null
        : toPin.unit === "ft"
          ? toPin.value
          : toPin.value * 3;
    expectedRemaining = expectedPutts(distFt, skill.sgPutt ?? 0);
  } else {
    // Off-green — need yards to pin.
    let yards: number;
    if (toPin) {
      yards = toPin.unit === "yds" ? toPin.value : toPin.value / 3;
    } else {
      // No distance — moderate default. Tuned to "somewhere between
      // tee shot and green" as a generic fallback.
      yards = 60;
    }
    expectedRemaining = strokesToHole(
      yards,
      lie,
      skill.sgApp ?? 0,
      skill.sgArg ?? 0,
    );
  }

  const expectedTotal = shotNum + expectedRemaining;
  return {
    expectedTotal,
    expectedVsPar: expectedTotal - par,
    shotsTaken: shotNum,
    expectedRemaining,
    isHoled: false,
  };
}
