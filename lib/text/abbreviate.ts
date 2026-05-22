/**
 * Format "Joaquin Niemann" as "J. Niemann" — initial + last name.
 * Used across mobile-heavy surfaces (feed rows, bet tracker,
 * leaderboard, momentum strip, putt-poll baseline) to keep names
 * compact on phone screens without losing identity (the avatar
 * carries the visual cue).
 *
 *   "Joaquin Niemann"          → "J. Niemann"
 *   "Joaquín Niemann"          → "J. Niemann"   (accents preserved)
 *   "Scottie Scheffler"        → "S. Scheffler"
 *   "Min Woo Lee"              → "M. Lee"       (collapse middle names)
 *   "Theegala"                 → "Theegala"     (single name, unchanged)
 *   "Aaron Rai"                → "A. Rai"
 *
 * Honours hyphens in surnames ("Hovland-Reed" → "F. Hovland-Reed")
 * by treating the last whitespace-separated token as the surname.
 */
export function abbreviateName(full: string): string {
  if (!full) return full;
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = [...first][0] ?? "";
  if (!initial) return full;
  return `${initial.toUpperCase()}. ${last}`;
}
