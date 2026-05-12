/**
 * Lightweight text helpers shared across games.
 */

/** Strip combining diacritical marks so "Åberg" becomes "Aberg" for
 *  autocomplete matching. Keeps the result lowercase-friendly. */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lower-cased, accent-stripped form for substring matching. */
export function searchableName(s: string): string {
  return stripAccents(s).toLowerCase();
}
