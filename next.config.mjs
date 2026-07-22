/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Per-course geometry JSONs in lib/data/courses/ are read at
  // runtime by /api/course/geo/[id] via fs.readFile. Without this
  // include hint, Vercel's serverless bundler doesn't trace them
  // (no import statement), so they ship empty and every request
  // returns 404. Force-include the directory so the JSON ships
  // alongside the function bundle.
  outputFileTracingIncludes: {
    "/api/course/geo/**": ["./lib/data/courses/*.json"],
    // Per-year historical event data — read at runtime via
    // fs.readFile with a dynamic `${year}` in the path, so the
    // Vercel bundler can't trace them from imports. Two routes
    // need them: the birdies endpoint reads per-player-per-hole
    // scoring to compute cluster rates, the pins endpoint reads
    // per-hole yardage to populate yardsByRound for older years
    // (2019-2022) where courseStats only carried a single
    // roundless yardage. Without this hint 2019-2022 TEE Δ was
    // empty even though the JSON files existed on disk locally.
    "/api/course-pin-birdies/**": ["./data/historical/*.json"],
    "/api/course-pins/**": ["./data/historical/*.json"],
  },
};

export default nextConfig;
