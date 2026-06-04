/**
 * Canonical win-% formatter for bet surfaces (bet detail hero +
 * hole-by-hole table, desktop right-rail bet rows, anywhere else
 * we render a model probability).
 *
 * Uses one decimal for sub-5% probabilities so a longshot down on
 * the round still reads "0.4%" instead of collapsing to "0%". The
 * shared helper keeps every bet surface lined up — a row in the
 * desktop rail must show the same string as the same bet's detail
 * page.
 */
export function formatWinPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p) || p < 0) return "—";
  const pct = p * 100;
  if (pct > 0 && pct < 5) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}
