/**
 * Per-game streak + stats tracking, persisted in localStorage.
 *
 * Each game (pros, holes, …) keeps its own streak so playing Holes
 * doesn't keep your Pros streak alive (and vice versa). Storage key
 * is `pardle.stats.<game>`.
 */

export interface PardleStats {
  current: number;
  longest: number;
  lastPlayedDay: number | null;
  totalPlayed: number;
  totalWon: number;
  guessDistribution: Record<string, number>;
}

const DEFAULT_STATS: PardleStats = {
  current: 0,
  longest: 0,
  lastPlayedDay: null,
  totalPlayed: 0,
  totalWon: 0,
  guessDistribution: {},
};

function statsKey(game: string): string {
  return `pardle.stats.${game}`;
}

export function loadStats(game: string): PardleStats {
  if (typeof window === "undefined") return { ...DEFAULT_STATS };
  try {
    const raw = window.localStorage.getItem(statsKey(game));
    if (!raw) return { ...DEFAULT_STATS };
    return { ...DEFAULT_STATS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveStats(game: string, stats: PardleStats): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(statsKey(game), JSON.stringify(stats));
  } catch {
    // localStorage full or disabled — fail silently
  }
}

export function applyMissedDayReset(
  game: string,
  currentDay: number,
): PardleStats {
  const stats = loadStats(game);
  if (
    stats.lastPlayedDay !== null &&
    stats.lastPlayedDay < currentDay - 1 &&
    stats.current > 0
  ) {
    stats.current = 0;
    saveStats(game, stats);
  }
  return stats;
}

export function recordResult(
  game: string,
  currentDay: number,
  isWin: boolean,
  guessCount: number,
): PardleStats {
  const stats = loadStats(game);
  if (stats.lastPlayedDay === currentDay) return stats;

  const isContinuation =
    stats.lastPlayedDay !== null && currentDay - stats.lastPlayedDay === 1;

  if (isWin) {
    stats.current = isContinuation ? stats.current + 1 : 1;
  } else {
    stats.current = 0;
  }

  stats.longest = Math.max(stats.longest, stats.current);
  stats.lastPlayedDay = currentDay;
  stats.totalPlayed += 1;
  if (isWin) stats.totalWon += 1;

  const distKey = isWin ? String(guessCount) : "X";
  stats.guessDistribution[distKey] =
    (stats.guessDistribution[distKey] ?? 0) + 1;

  saveStats(game, stats);
  return stats;
}

const TUTORIAL_KEY_PREFIX = "pardle.tutorialSeen.";

export function hasSeenTutorial(game: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TUTORIAL_KEY_PREFIX + game) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(game: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TUTORIAL_KEY_PREFIX + game, "1");
  } catch {
    // ignore
  }
}

/**
 * One-time migration: if an old `pardle.stats` blob exists from before the
 * per-game key format, copy it into `pardle.stats.pros` so existing players
 * don't lose their streak when the platform refactor lands.
 */
export function migrateLegacyStats(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem("pardle.stats");
    if (!legacy) return;
    const target = statsKey("pros");
    if (window.localStorage.getItem(target)) {
      // Already migrated — drop the legacy blob.
      window.localStorage.removeItem("pardle.stats");
      return;
    }
    window.localStorage.setItem(target, legacy);
    window.localStorage.removeItem("pardle.stats");
    // Same for the tutorial flag.
    const legacyTutorial = window.localStorage.getItem("pardle.tutorialSeen");
    if (legacyTutorial) {
      window.localStorage.setItem(TUTORIAL_KEY_PREFIX + "pros", legacyTutorial);
      window.localStorage.removeItem("pardle.tutorialSeen");
    }
  } catch {
    // ignore
  }
}
