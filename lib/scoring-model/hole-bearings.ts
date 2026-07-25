/**
 * Per-course hole bearings — the compass direction (0-360°) each hole
 * plays from tee to green. Used by the scoring-model regression to
 * compute headwind: `headwind = wind_speed × cos(wind_dir - bearing)`.
 *
 * A hole with bearing 200° plays toward SSW; a wind coming FROM 200°
 * is a pure headwind → cos(0) = 1.0 → full wind speed as headwind.
 * A wind FROM 20° (opposite) is a pure tailwind → cos(180) = −1.0 →
 * negative headwind = tailwind boost.
 *
 * Bearings are derived from OSM tee-to-green geometry for TPC Twin
 * Cities. Add new courses by dropping in a keyed entry — callers of
 * getHoleBearings() return null when the course isn't in the table,
 * and the scoring model gracefully falls back to no-wind adjustment.
 */

const TPC_TWIN_CITIES: Record<number, number> = {
  1: 283, 2: 354, 3: 114, 4: 73, 5: 74, 6: 289, 7: 214, 8: 310,
  9: 149, 10: 167, 11: 175, 12: 336, 13: 140, 14: 54, 15: 14,
  16: 204, 17: 261, 18: 318,
};

const BY_TOURNAMENT_ID: Record<string, Record<number, number>> = {
  R2023525: TPC_TWIN_CITIES,
  R2024525: TPC_TWIN_CITIES,
  R2025525: TPC_TWIN_CITIES,
  R2026525: TPC_TWIN_CITIES,
};

export function getHoleBearings(
  tournamentId: string | null | undefined,
): Record<number, number> | null {
  if (!tournamentId) return null;
  return BY_TOURNAMENT_ID[tournamentId] ?? null;
}
