/**
 * Shared types for the Trivia Duel mode (up to 4 players).
 *
 * A duel is a real-time trivia race for 2–4 players. All players see
 * the same 10 questions in the same order. For each question, whoever
 * clicks the *correct* answer first wins that question. Clicking the
 * wrong answer eliminates you from that question; remaining players
 * can still try. If everyone left clicks wrong (or all answer wrong),
 * the question is a draw and no points are awarded.
 *
 * The host creates a room and is seated in slot 0. They share the URL
 * with friends — up to 3 more can join. The host explicitly starts
 * the duel when ready (any time after the second player joins).
 * Rooms live in Upstash Redis with a 1-hour TTL.
 */

import type { TriviaDifficulty } from "@/lib/data/trivia";

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS_TO_START = 2;

export interface DuelPlayer {
  /** Stable per-device token, also used to authenticate /answer calls. */
  token: string;
  name: string;
  score: number;
}

export interface DuelPick {
  /** Index 0..3 of the player's chosen option. */
  answer: number;
  correct: boolean;
  /** Server timestamp when the click was recorded. */
  clickedAt: number;
}

export interface DuelQuestionState {
  /** Length-MAX_PLAYERS, null for "this player hasn't answered yet". */
  picks: (DuelPick | null)[];
  /** Once the question has been decided. */
  resolved: boolean;
  /**
   * Index of the winning player slot once resolved.
   *   -1 = nobody won (everyone wrong, or no answers landed before all
   *   non-eliminated players had taken their attempt).
   *   null = not resolved yet.
   */
  winnerSlot: number | null;
  resolvedAt: number | null;
}

export type DuelStatus =
  | "waiting" // host hasn't started the duel yet
  | "active" // game in progress
  | "finished"; // all 10 questions resolved

export interface DuelRoom {
  roomId: string;
  difficulty: TriviaDifficulty;
  /** Mulberry32 seed for picking the 10 questions. */
  seed: number;
  /** Length-MAX_PLAYERS — null = empty slot. Slot 0 is the host. */
  players: (DuelPlayer | null)[];
  status: DuelStatus;
  /** 0..9 — currently active question. Equals 10 when finished. */
  currentQuestionIndex: number;
  /** Length-10 array of per-question state. */
  questions: DuelQuestionState[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}
