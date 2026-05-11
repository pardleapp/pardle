/**
 * Shared types for Pardle: Connections — split out so the category
 * library and the puzzle generator can import without circular deps.
 */

export type ConnectionsDifficulty = "yellow" | "green" | "blue" | "purple";

export const DIFFICULTY_ORDER: ConnectionsDifficulty[] = [
  "yellow",
  "green",
  "blue",
  "purple",
];

export interface ConnectionsCategory {
  label: string;
  difficulty: ConnectionsDifficulty;
  /** golfer ids actually shown in this puzzle (exactly 4) */
  memberIds: string[];
}

export interface ConnectionsItem {
  id: string;
  name: string;
}

export interface ConnectionsPuzzle {
  dayNumber: number;
  items: ConnectionsItem[]; // 16, shuffled
  categories: ConnectionsCategory[]; // 4, ordered yellow → purple
}
