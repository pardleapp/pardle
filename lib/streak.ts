const KEY = "pardle.stats";

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

export function loadStats(): PardleStats {
  if (typeof window === "undefined") return { ...DEFAULT_STATS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_STATS };
    return { ...DEFAULT_STATS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

function saveStats(stats: PardleStats): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // localStorage full or disabled — fail silently
  }
}

/**
 * If the user missed one or more days since last playing, reset the streak.
 * Called on page load before any UI uses the streak.
 */
export function applyMissedDayReset(currentDay: number): PardleStats {
  const stats = loadStats();
  if (
    stats.lastPlayedDay !== null &&
    stats.lastPlayedDay < currentDay - 1 &&
    stats.current > 0
  ) {
    stats.current = 0;
    saveStats(stats);
  }
  return stats;
}

/**
 * Record the outcome of today's puzzle. Idempotent for the same day —
 * calling twice with the same dayNumber will not double-count.
 */
export function recordResult(
  currentDay: number,
  isWin: boolean,
  guessCount: number,
): PardleStats {
  const stats = loadStats();

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

  saveStats(stats);
  return stats;
}

const TUTORIAL_KEY = "pardle.tutorialSeen";

export function hasSeenTutorial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTutorialSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    // ignore
  }
}
