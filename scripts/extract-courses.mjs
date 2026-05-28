/**
 * Extract per-course geometry from OpenStreetMap via the Overpass
 * API. Produces normalised JSON for each course in the manifest,
 * suitable for the CourseMap SVG renderer.
 *
 *   node scripts/extract-courses.mjs                # all
 *   node scripts/extract-courses.mjs augusta-national
 *
 * Per-course output goes to lib/data/courses/{slug}.json
 *
 * OSM data is © OpenStreetMap contributors, ODbL.
 * Attribution rendered in-app via the CourseMap footer.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "lib", "data", "courses");
const MANIFEST_PATH = resolve(__dirname, "courses-manifest.json");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Build the Overpass QL query for a course bbox.
 *  bbox is [minLng, minLat, maxLng, maxLat] (GeoJSON / Nominatim
 *  convention). Overpass wants [S, W, N, E] — convert.
 *  Using bbox rather than relation/way ID makes the query work
 *  regardless of how OSM tagged the course (some courses are
 *  multi-polygon relations, others single closed ways). */
function buildQuery(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bb = `${minLat},${minLng},${maxLat},${maxLng}`;
  return `[bbox:${bb}][out:json][timeout:90];
(
  way["golf"];
  way["natural"="water"];
  way["waterway"="ditch"];
);
out geom;`;
}

/** Pad a manifest bbox by ~3% on each side so polygons don't sit
 *  flush against the SVG edge. */
function padManifestBbox(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const padLng = (maxLng - minLng) * 0.03;
  const padLat = (maxLat - minLat) * 0.03;
  return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
}

/** True when a point lies inside a bbox (inclusive). */
function pointInBbox(pt, bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return (
    pt[0] >= minLng && pt[0] <= maxLng && pt[1] >= minLat && pt[1] <= maxLat
  );
}

/** A "way" from Overpass becomes one of our normalised features. */
function normaliseWay(way) {
  if (!way.geometry || way.geometry.length === 0) return null;
  const tags = way.tags || {};

  // Map OSM tag → our feature kind.
  let kind = null;
  if (tags.golf === "fairway") kind = "fairway";
  else if (tags.golf === "green") kind = "green";
  else if (tags.golf === "tee") kind = "tee";
  else if (tags.golf === "bunker") kind = "bunker";
  else if (tags.golf === "rough") kind = "rough";
  else if (tags.golf === "water_hazard") kind = "water";
  else if (tags.golf === "lateral_water_hazard") kind = "water";
  else if (tags.golf === "hole") kind = "hole-path";
  else if (tags.golf === "driving_range") kind = "driving-range";
  else if (tags.golf === "cartpath") return null; // noise
  else if (tags.golf === "path") return null;
  else if (tags.natural === "water") kind = "water";
  else if (tags.waterway === "ditch") kind = "water";
  if (!kind) return null;

  // Convert Overpass {lat,lon} pairs into [lng, lat] tuples that
  // match GeoJSON convention.
  const coords = way.geometry.map((p) => [p.lon, p.lat]);

  const holeRef = tags.ref ? Number(tags.ref) : null;
  const holeNum =
    holeRef != null && Number.isInteger(holeRef) && holeRef >= 1 && holeRef <= 18
      ? holeRef
      : null;
  const par = tags.par ? Number(tags.par) : null;

  return {
    id: way.id,
    kind,
    coords,
    holeNum,
    par: par != null && Number.isFinite(par) ? par : null,
    yardage: tags.yardage ? Number(tags.yardage) : null,
    distance: tags.distance ? tags.distance : null,
    closed:
      coords.length >= 2 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1],
  };
}

/** Pull OSM relation centroid as a fallback when no specific feature
 *  is in scope (used for the course-bbox center). */
function centroid(coords) {
  if (!coords || coords.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  return [lng / coords.length, lat / coords.length];
}

/** Approximate distance in metres between two lng/lat points. Used
 *  for matching unlabelled fairways → nearest hole-path. */
function metresBetween(a, b) {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Assign hole numbers to features that don't carry one by matching
 *  against the nearest tagged hole-path. Best-effort — only works
 *  when at least some hole paths are tagged with ref=N. */
function assignHoleNumbers(features) {
  const holePaths = features.filter((f) => f.kind === "hole-path" && f.holeNum != null);
  if (holePaths.length === 0) return;
  for (const f of features) {
    if (f.holeNum != null) continue;
    if (f.kind === "hole-path") continue;
    const c = centroid(f.coords);
    if (!c) continue;
    let bestHole = null;
    let bestDist = Infinity;
    for (const h of holePaths) {
      // Compare against the hole-path's mid-point.
      const mid = h.coords[Math.floor(h.coords.length / 2)];
      const d = metresBetween(c, mid);
      if (d < bestDist) {
        bestDist = d;
        bestHole = h.holeNum;
      }
    }
    // Only assign if reasonably close — avoid attaching a bunker on
    // the practice range to hole 7. Tour fairways are typically
    // <80m from their hole path's midpoint.
    if (bestDist <= 120) f.holeNum = bestHole;
  }
}

/** Run an Overpass query and return parsed JSON. Retries once on
 *  429 rate-limit response. */
async function fetchOverpass(query) {
  const body = `data=${encodeURIComponent(query)}`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];
  let lastErr = null;
  for (const url of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "pardle-course-extractor/1.0",
          },
          body,
        });
        if (res.ok) {
          const text = await res.text();
          // Some mirrors return an HTML error inside a 200 response.
          if (text.startsWith("<")) {
            lastErr = new Error(`Overpass HTML response from ${url}`);
            break; // try next endpoint
          }
          return JSON.parse(text);
        }
        if (res.status === 429 || res.status === 504) {
          const wait = 4000 + attempt * 4000;
          console.warn(
            `Overpass ${res.status} from ${url}, retrying in ${wait / 1000}s…`,
          );
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        lastErr = new Error(`Overpass HTTP ${res.status} from ${url}`);
        break;
      } catch (err) {
        lastErr = err;
        break;
      }
    }
  }
  throw lastErr ?? new Error("Overpass failed");
}

async function extractCourse(slug, meta) {
  console.log(`\n[${slug}] fetching OSM data for bbox ${meta.bbox.join(",")}…`);
  const data = await fetchOverpass(buildQuery(meta.bbox));
  const ways = data.elements.filter((e) => e.type === "way");
  console.log(`[${slug}]   ${ways.length} ways returned`);

  const allFeatures = [];
  for (const w of ways) {
    const f = normaliseWay(w);
    if (f) allFeatures.push(f);
  }

  // Filter to features whose centroid sits inside the manifest's
  // course bbox. Overpass returns any way that *intersects* the
  // bbox, which means rivers extending miles beyond the course
  // would otherwise blow out the rendered viewport. Course
  // features stay; out-of-area rivers and rough are dropped.
  const features = allFeatures.filter((f) => {
    const c = centroid(f.coords);
    return c ? pointInBbox(c, meta.bbox) : false;
  });
  console.log(
    `[${slug}]   ${features.length} features inside course bbox (of ${allFeatures.length})`,
  );

  // Best-effort hole-number assignment for ways missing ref=N.
  assignHoleNumbers(features);
  const tagged = features.filter((f) => f.holeNum != null).length;
  console.log(`[${slug}]   ${tagged} features tagged with hole numbers`);

  // Use the manifest bbox as the canonical viewport — the data
  // doesn't dictate what the viewer sees. Padded by 3% so
  // polygons don't sit flush against the edge.
  const bbox = padManifestBbox(meta.bbox);

  // Group features by kind for cleaner consumption client-side.
  const grouped = {
    fairways: [],
    greens: [],
    tees: [],
    bunkers: [],
    rough: [],
    water: [],
    holePaths: [],
    drivingRange: [],
  };
  for (const f of features) {
    const out = {
      id: f.id,
      coords: f.coords,
      holeNum: f.holeNum,
      par: f.par,
    };
    switch (f.kind) {
      case "fairway":
        grouped.fairways.push(out);
        break;
      case "green":
        grouped.greens.push(out);
        break;
      case "tee":
        grouped.tees.push(out);
        break;
      case "bunker":
        grouped.bunkers.push(out);
        break;
      case "rough":
        grouped.rough.push(out);
        break;
      case "water":
        grouped.water.push(out);
        break;
      case "hole-path":
        grouped.holePaths.push({ ...out, yardage: f.yardage });
        break;
      case "driving-range":
        grouped.drivingRange.push(out);
        break;
    }
  }

  // Derive per-hole tee/green centerline points so the renderer
  // can position player dots without re-walking the polygons.
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    const path = grouped.holePaths.find((h) => h.holeNum === n);
    const greens = grouped.greens.filter((g) => g.holeNum === n);
    const tees = grouped.tees.filter((t) => t.holeNum === n);
    if (!path && greens.length === 0 && tees.length === 0) continue;
    const greenCentroid =
      greens.length > 0 ? centroid(greens[0].coords) : null;
    const teeCentroid = tees.length > 0 ? centroid(tees[0].coords) : null;
    let teePoint = teeCentroid;
    let greenPoint = greenCentroid;
    if (path && path.coords.length >= 2) {
      teePoint = teePoint ?? path.coords[0];
      greenPoint = greenPoint ?? path.coords[path.coords.length - 1];
    }
    holes.push({
      number: n,
      par: path?.par ?? null,
      yardage: path?.yardage ?? null,
      tee: teePoint,
      green: greenPoint,
    });
  }

  const output = {
    id: slug,
    name: meta.name,
    city: meta.city || null,
    country: meta.country || null,
    bbox,
    holes,
    fairways: grouped.fairways,
    greens: grouped.greens,
    tees: grouped.tees,
    bunkers: grouped.bunkers,
    rough: grouped.rough,
    water: grouped.water,
    holePaths: grouped.holePaths,
    drivingRange: grouped.drivingRange,
    extractedAt: new Date().toISOString(),
    attribution: "© OpenStreetMap contributors",
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, `${slug}.json`);
  await writeFile(outPath, JSON.stringify(output) + "\n");
  const kb = Math.round((JSON.stringify(output).length / 1024) * 10) / 10;
  console.log(`[${slug}] wrote ${outPath} (${kb} KB)`);
  return output;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const filter = process.argv[2];
  const entries = Object.entries(manifest).filter(
    ([slug]) => !filter || slug === filter,
  );
  if (entries.length === 0) {
    console.error(`No courses match filter '${filter}'.`);
    console.error("Available:", Object.keys(manifest).join(", "));
    process.exit(1);
  }
  for (const [slug, meta] of entries) {
    try {
      await extractCourse(slug, meta);
    } catch (err) {
      console.error(`[${slug}] FAILED:`, err.message);
    }
    // Overpass etiquette: 1.5s pause between heavy queries.
    if (entries.length > 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
