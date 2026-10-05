/**
 * Warm data/dg-rounds-full-cache for the course-fit backtest:
 *   node scripts/fetch-dg-rounds-full.mjs --tours pga,euro --from 2018-01-01
 */
import { eventList, eventRounds } from "./lib/dg-history.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const tours = (args.tours ?? "pga,euro").split(",");
const from = args.from ?? "2018-01-01";
for (const tour of tours) {
  const list = (await eventList(tour)).filter((e) => e.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  console.log(`[${tour}] ${list.length} events since ${from}`);
  let n = 0;
  for (const ev of list) {
    const rounds = await eventRounds(tour, ev);
    if (++n % 25 === 0) console.log(`[${tour}] ${n}/${list.length} (${ev.date} ${ev.event_name}: ${rounds.length} rounds)`);
  }
}
console.log("done");
