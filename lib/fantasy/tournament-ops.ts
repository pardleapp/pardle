/**
 * Tournament lifecycle — discover the next PGA Tour event from
 * DataGolf, persist a Tournament row, and refresh it as the field
 * and scores come in.
 *
 * Tournament rows in Redis are keyed by our slug (e.g.
 * "us-open-2026") rather than DataGolf's numeric event_id, so the URL
 * stays human-readable.
 */

import "server-only";
import { getTournament, putTournament } from "./store";
import {
  getFieldForActiveEvent,
  getScheduleRaw,
  type DGScheduleEvent,
} from "@/lib/golf-api/datagolf";
import type { Tournament } from "./types";

/** Lower-case, hyphenated event name + year, suitable for a URL slug. */
export function slugifyEvent(eventName: string, startDate: string): string {
  const year = startDate.slice(0, 4);
  const cleaned = eventName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${cleaned}-${year}`;
}

/**
 * Look at the DataGolf PGA schedule, pick the NEXT upcoming event,
 * and load/persist a Tournament row for it.
 *
 * "Next upcoming" = lowest start_date >= today among `status: upcoming`
 * entries. Falls back to the most recent completed event if everything
 * is in the past (i.e. off-season).
 */
export async function getOrInitNextTournament(): Promise<Tournament> {
  const schedule = await getScheduleRaw("pga");
  const now = new Date();
  const todayMs = now.getTime();

  const upcoming = schedule
    .filter((e) => {
      const start = new Date(e.start_date + "T00:00:00Z").getTime();
      return start >= todayMs - 24 * 60 * 60 * 1000;
    })
    .sort(
      (a, b) =>
        new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
    );

  const pick = upcoming[0] ?? schedule[schedule.length - 1];
  if (!pick) throw new Error("DataGolf schedule is empty");

  return ensureTournament(pick);
}

/**
 * Persist (or refresh) a Tournament row for one schedule entry.
 * Skips re-fetching the field if the row already has one.
 */
export async function ensureTournament(
  evt: DGScheduleEvent,
): Promise<Tournament> {
  const id = slugifyEvent(evt.event_name, evt.start_date);
  const existing = await getTournament(id);

  // Compute end date as start + 3 days (Thu→Sun standard).
  const start = new Date(evt.start_date + "T00:00:00Z");
  const end = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
  const endIso = end.toISOString().slice(0, 10);

  // For schedule entries that haven't had their field published yet,
  // field-updates will return an empty/different event — skip in that
  // case and leave field empty until closer to tee-off.
  let field = existing?.field ?? [];
  if (field.length === 0) {
    try {
      field = await getFieldForActiveEvent("pga");
    } catch {
      // Network errors during init shouldn't block creation — UI will
      // show "field loading" until we fetch successfully.
      field = [];
    }
  }

  const tournament: Tournament = {
    id,
    name: evt.event_name,
    course: evt.course,
    startDate: evt.start_date,
    endDate: endIso,
    status: existing?.status ?? "scheduled",
    rounds: existing?.rounds ?? {
      1: "scheduled",
      2: "scheduled",
      3: "scheduled",
      4: "scheduled",
    },
    dgEventId: evt.event_id,
    field,
    cutLineToPar: existing?.cutLineToPar ?? null,
    scores: existing?.scores ?? {},
    updatedAt: Date.now(),
  };

  await putTournament(tournament);
  return tournament;
}
