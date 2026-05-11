/**
 * Encoding for Trivia async-challenge URLs.
 *
 * After finishing a Trivia round solo, a player can press 'Challenge a
 * friend' which packs their answers + difficulty + day into a token
 * embedded in pardle.app/trivia/c/{token}. The friend opens the URL,
 * plays the SAME 10 questions (regenerated deterministically from day
 * + difficulty), and after each question sees what the challenger
 * picked. Final scorecard compares both players head-to-head.
 *
 * Tokens are NOT a security boundary — anyone can forge one. The
 * worst case is rendering a forged challenge card, which is harmless.
 */

import type { TriviaDifficulty } from "@/lib/data/trivia";

export interface TriviaChallengePayload {
  /** Difficulty tier. */
  d: TriviaDifficulty;
  /** Day number — used by the friend's page to regenerate the same Qs. */
  n: number;
  /** Challenger's name (up to 30 chars). */
  p: string;
  /** Their 10 answer indices (0..3). Use -1 for 'didn't answer in time'. */
  a: number[];
  /** Their final score (0..10) — convenience field, derivable from `a`. */
  s: number;
}

const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

function toBase64Url(s: string): string {
  const b64 =
    typeof window !== "undefined"
      ? window.btoa(unescape(encodeURIComponent(s)))
      : Buffer.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const full = remainder ? padded + "=".repeat(4 - remainder) : padded;
  if (typeof window !== "undefined") {
    return decodeURIComponent(escape(window.atob(full)));
  }
  return Buffer.from(full, "base64").toString("utf8");
}

export function encodeTriviaChallenge(p: TriviaChallengePayload): string {
  return toBase64Url(JSON.stringify(p));
}

export function decodeTriviaChallenge(
  token: string,
): TriviaChallengePayload | null {
  if (!token) return null;
  try {
    const json = fromBase64Url(token);
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<TriviaChallengePayload>;
    if (
      typeof parsed.d !== "string" ||
      !VALID_DIFFICULTIES.has(parsed.d) ||
      typeof parsed.n !== "number" ||
      !Number.isInteger(parsed.n) ||
      parsed.n < 1 ||
      typeof parsed.p !== "string" ||
      !Array.isArray(parsed.a) ||
      parsed.a.length !== 10 ||
      typeof parsed.s !== "number" ||
      parsed.s < 0 ||
      parsed.s > 10
    ) {
      return null;
    }
    // Coerce answer entries to valid integers in -1..3.
    const answers: number[] = parsed.a.map((v) => {
      if (typeof v !== "number" || !Number.isInteger(v)) return -1;
      if (v < -1 || v > 3) return -1;
      return v;
    });
    return {
      d: parsed.d as TriviaDifficulty,
      n: parsed.n,
      p: parsed.p.slice(0, 30),
      a: answers,
      s: parsed.s,
    };
  } catch {
    return null;
  }
}
