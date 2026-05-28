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
  },
};

export default nextConfig;
