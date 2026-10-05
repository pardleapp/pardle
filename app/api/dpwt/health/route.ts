/**
 * GET /api/dpwt/health — can this server reach the DP World Tour live
 * sources? Pings each with a completed event (this week's endpoints are
 * empty before R1, so they can't tell "blocked" from "not started").
 * Returns status codes and payload sizes only.
 */
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const IMG_HEADERS = (ev: number, op: string, hash: string) => ({
  operator: "europeantour", sport: "GOLF", "event-id": String(ev), "gql-op-name": op,
  "ec-version": "6.0.129", "x-request-from": "6.0.129", "normalise-response": "true", ...(hash ? { "query-hash": hash } : {}),
  origin: "https://europeantour.apps.srarena.io", referer: "https://europeantour.apps.srarena.io/",
});

async function probe(url: string, init?: RequestInit) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const t = await r.text();
    return { status: r.status, bytes: t.length, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, error: (e as Error).name, ms: Date.now() - t0 };
  }
}

export async function GET() {
  const dir = path.join(process.cwd(), "data", "dpwt");
  const events = JSON.parse(await readFile(path.join(dir, "img-events.json"), "utf-8"));
  const stats = JSON.parse(await readFile(path.join(dir, "img-stats-query.json"), "utf-8"));
  const ci = events["1168"].courseInfoHash as string;
  const holesQ = JSON.parse(await readFile(path.join(dir, "img-holes-query.json"), "utf-8"));
  const [sportdata, imgCourse, imgStats, imgHoles] = await Promise.all([
    probe("https://www.europeantour.com/api/sportdata/HoleByHole/Event/2025134/Round/1"),
    probe(`https://btec-http.services.srarena.io/?hash=${ci}`, { headers: IMG_HEADERS(1168, "GetGolfCourseInfo", ci) }),
    probe("https://btec-http.services.srarena.io/", {
      method: "POST",
      headers: { "content-type": "application/json", ...IMG_HEADERS(1168, stats.operationName, stats.queryHash) },
      body: JSON.stringify({ operationName: stats.operationName, query: stats.query, variables: { input: {
        categories: ["Driving"], first: 3, subCats: ["offTheTeeStrokesGained"], tournamentId: 1168,
      } } }),
    }),
    probe("https://btec-http.services.srarena.io/", {
      method: "POST",
      headers: { "content-type": "application/json", ...IMG_HEADERS(1168, holesQ.operationName, "") },
      body: JSON.stringify({ operationName: holesQ.operationName, query: holesQ.query, variables: { input: { roundNums: [1], tournamentId: 1168 } } }),
    }),
  ]);
  // Live routes read IMG only; the Tour's sportdata API is reported for
  // reference (Akamai blocks it from Vercel's IPs).
  const ok = [imgCourse, imgStats, imgHoles].every((p) => p.status === 200 && (p.bytes ?? 0) > 100);
  return NextResponse.json({ ok, imgCourse, imgStats, imgHoles, sportdataReference: sportdata });
}
