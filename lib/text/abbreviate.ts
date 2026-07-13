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
  const trimmed = full.trim();
  // IMG's shot pipeline sometimes stores names in "LASTNAME, First"
  // format (e.g. "Fitzpatrick, Matt"). Handle that shape first —
  // otherwise the standard "First Last" logic below would treat
  // "Fitzpatrick," as the first name and produce "F. Matt". Older
  // historical events already stored in Redis still carry this shape,
  // so the fix has to live at display time not just emit time.
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx > 0) {
    const last = trimmed.slice(0, commaIdx).trim();
    const first = trimmed.slice(commaIdx + 1).trim();
    if (last && first) {
      const initial = [...first][0] ?? "";
      if (initial) return `${initial.toUpperCase()}. ${last}`;
    }
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return full;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = [...first][0] ?? "";
  if (!initial) return full;
  return `${initial.toUpperCase()}. ${last}`;
}
