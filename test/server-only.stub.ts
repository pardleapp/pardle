// Vitest-only stub for Next.js's `import "server-only"` sentinel.
// The real module throws when bundled into a client component; in
// tests we run in Node so a no-op is fine.
export {};
