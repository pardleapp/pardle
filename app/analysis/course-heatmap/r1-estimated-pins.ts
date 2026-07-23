/**
 * r1-estimated-pins.ts
 *
 * When the PGA Tour orchestrator hasn't yet published a hole's
 * Round 1 pin coordinate (it only serves a pin once at least one
 * group has finished the hole), we can still place a marker on the
 * green by falling back to the cluster centroid we've identified as
 * where R1 sits on the SHOTLINK sheet.
 *
 * The mapping below is TOURNAMENT-SPECIFIC — refresh each round /
 * each event. It's the "which historical cluster does today's R1
 * pin sit on" call, made by eye against the SHOTLINK sheet the tour
 * publishes at 11:40 the day before.
 *
 * When the orchestrator later publishes the real coord, the page's
 * merge logic prefers the API value — so this is a temporary
 * pre-play placeholder, not the source of truth.
 */

/** Cluster letter today's R1 pin sits on, per hole, per tournament.
 *  Keyed by tournamentId. Only include holes whose orchestrator
 *  coord is still null — API-served holes are always preferred. */
export const R1_CLUSTER_BY_TOURNAMENT: Record<
  string,
  Record<number, string>
> = {
  // 3M Open 2026 — Round 1, Thursday 23 July 2026 pin sheet.
  R2026525: {
    6:  "D",
    7:  "A",
    8:  "A",
    9:  "E",
    13: "A",
    14: "A",
    15: "B",
    16: "C",
    17: "A",
    18: "B",
  },
};
