/**
 * SG-by-category we compute ourselves from ShotLink shots, for events
 * the PGA Tour tracks but leaves out of its published SG stats, so
 * DataGolf only has SG: Total (scripts/compute-shot-sg.mjs). Overlaid
 * onto DataGolf's historical payloads so every consumer (course
 * history, player pages) treats these events like any other.
 *
 * Overlays only fill nulls, so they're idempotent and safe to apply to
 * cached payloads, and DataGolf's own numbers win if it ever publishes
 * categories for the event.
 *
 * Add an event: run the script's build step, then import the file here.
 */
import type {
  DGHistoricalEvent,
  DGHistoricalRoundsPayload,
} from "./datagolf";
import baycurrent2025 from "@/data/sg-computed/527-2025.json";

interface ComputedRound {
  sg_ott: number;
  sg_app: number;
  sg_arg: number;
  sg_putt: number;
  sg_t2g: number;
}
interface ComputedEvent {
  eventId: number;
  year: number;
  players: Record<string, Record<string, ComputedRound>>;
}

const EVENTS: ComputedEvent[] = [baycurrent2025 as ComputedEvent];
const BY_KEY = new Map(EVENTS.map((e) => [`${e.eventId}:${e.year}`, e]));

export function hasComputedSg(eventId: number, year: number): boolean {
  return BY_KEY.has(`${eventId}:${year}`);
}

export function withComputedSgEvents(
  list: DGHistoricalEvent[],
): DGHistoricalEvent[] {
  return list.map((e) =>
    e.sg_categories !== "yes" && hasComputedSg(e.event_id, e.calendar_year)
      ? { ...e, sg_categories: "yes" }
      : e,
  );
}

export function withComputedSgRounds(
  payload: DGHistoricalRoundsPayload,
  eventId: number,
  year: number,
): DGHistoricalRoundsPayload {
  const ev = BY_KEY.get(`${eventId}:${year}`);
  if (!ev || !payload?.scores) return payload;
  return {
    ...payload,
    scores: payload.scores.map((s) => {
      const pr = ev.players[String(s.dg_id)];
      if (!pr) return s;
      const next = { ...s };
      for (const r of [1, 2, 3, 4] as const) {
        const key = `round_${r}` as const;
        const rd = next[key];
        const c = pr[String(r)];
        if (!rd || !c) continue;
        next[key] = {
          ...rd,
          sg_ott: rd.sg_ott ?? c.sg_ott,
          sg_app: rd.sg_app ?? c.sg_app,
          sg_arg: rd.sg_arg ?? c.sg_arg,
          sg_putt: rd.sg_putt ?? c.sg_putt,
          sg_t2g: rd.sg_t2g ?? c.sg_t2g,
        };
      }
      return next;
    }),
  };
}
