/**
 * Shared types for the Trivia Duel mode.
 *
 * A "duel" is a 2-player real-time trivia race. Both players see the
 * same 10 questions in the same order. For each question, whoever
 * clicks the *correct* answer first wins that question. Clicking the
 * wrong answer eliminates you from that question; the other player
 * can still try. If both answer wrong, the question is a draw.
 *
 * The host creates a room and is auto-slotted as p1. They share the
 * URL with one friend who joins as p2. State lives in Upstash Redis
 * with a 1-hour TTL.
 */

import type { TriviaDifficulty } from "@/lib/data/trivia";

export type PlayerSlot = "p1" | "p2";

export interface DuelPlayer {
  /** Stable per-device token, also used to authenticate /answer calls. */
  token: string;
  name: string;
  /** Number of questions won so far. */
  score: number;
}

/** Per-question state — what each player picked, who won. */
export interface DuelQuestionState {
  /** Player's chosen answer index for this question, if they've picked yet. */
  p1Answer: number | null;
  p2Answer: number | null;
  /** Was each player's pick correct? null until they've answered. */
  p1Correct: boolean | null;
  p2Correct: boolean | null;
  /** Server timestamps for each player's click (for race auditing). */
  p1ClickedAt: number | null;
  p2ClickedAt: number | null;
  /** Once resolved, who won this question. */
  resolved: boolean;
  winner: PlayerSlot | "none" | null;
  /** Server timestamp at resolution — used by clients to auto-advance. */
  resolvedAt: number | null;
}

export type DuelStatus =
  | "waiting" // p2 hasn't joined yet
  | "active" // game in progress
  | "finished"; // all 10 questions resolved

export interface DuelRoom {
  roomId: string;
  difficulty: TriviaDifficulty;
  /** Mulberry32 seed for picking which 10 questions to use. */
  seed: number;
  p1: DuelPlayer | null;
  p2: DuelPlayer | null;
  status: DuelStatus;
  /** 0..9 — which question is currently active. Equals 10 when finished. */
  currentQuestionIndex: number;
  /** Length-10 array of per-question state. */
  questions: DuelQuestionState[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** Sentinel for "no winner yet" / "this is a draw". */
export const NO_WINNER = "none" as const;
