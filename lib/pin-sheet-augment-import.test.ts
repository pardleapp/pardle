/**
 * Static import guard — any file that imports getCoursePins from
 * @/lib/golf-api/pgatour must also import augmentYardsFromHistorical
 * from @/lib/pin-sheet-augment.
 *
 * This is the second layer of defense against the "pre-2023 pin dots
 * cluster in one spot" bug recurring:
 *   - Layer 1 (lib/pin-sheet-augment.test.ts): the augment function
 *     itself is correct and idempotent.
 *   - Layer 2 (this file): every consumer of the raw fetcher applies
 *     the augment. If a future PR adds a new caller and forgets to
 *     augment, this test fails at CI time — before it can ship.
 *
 * The check is a grep, not a fancy AST walk. Keeps the coupling
 * intentional and readable, and matches what a code reviewer would
 * do by eye.
 */

import { describe, expect, it } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "collectors",
  "scripts",
  "design-handoff",
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE_PATTERN = /\.test\.tsx?$|__mocks__/;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (
      entry.isFile() &&
      CODE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("import guard: every getCoursePins consumer applies the augment", () => {
  it("finds no consumer that imports getCoursePins without importing augmentYardsFromHistorical", async () => {
    const files = await walk(ROOT);
    const violations: string[] = [];
    for (const file of files) {
      // Skip tests and doc-only mentions — this guard is about
      // production callers.
      if (TEST_FILE_PATTERN.test(file)) continue;
      // Skip the raw fetcher's own file — it exports getCoursePins,
      // it doesn't consume it, so the guard doesn't apply.
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === "lib/golf-api/pgatour.ts") continue;
      // Skip the augment module itself — it references getCoursePins
      // in comments and JSDoc, not in imports.
      if (rel === "lib/pin-sheet-augment.ts") continue;

      const text = await readFile(file, "utf-8");
      // Grep for an actual named import of getCoursePins from the
      // pgatour module. `getCoursePinsRaw`, `getCoursePinsWithDiag`
      // etc. don't match — they're already siblings that bypass
      // augment intentionally when their callers need diagnostics.
      const usesGetCoursePins = /\bimport\b[^;]*\bgetCoursePins\b[^;]*from\s*["']@\/lib\/golf-api\/pgatour["']/s.test(
        text,
      );
      if (!usesGetCoursePins) continue;

      const importsAugment = /\bimport\b[^;]*\baugmentYardsFromHistorical\b[^;]*from\s*["']@\/lib\/pin-sheet-augment["']/s.test(
        text,
      );
      if (!importsAugment) {
        violations.push(rel);
      }
    }
    if (violations.length > 0) {
      const msg =
        "The following files import getCoursePins but do NOT import augmentYardsFromHistorical:\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\n\nEvery consumer of getCoursePins must apply the augment step " +
        "before caching or returning the pin sheet. Otherwise the shared " +
        "pin cache can end up with replicated per-round pins for pre-2023 " +
        "events, and the birdie-history modal's four round dots stack on " +
        "top of each other.\n\nFix: import { augmentYardsFromHistorical } " +
        "from '@/lib/pin-sheet-augment' and call it on the result of " +
        "getCoursePins() before caching or shipping.";
      expect.fail(msg);
    }
  });
});

// Sanity: at least one file is actually being covered (guard against
// the walk missing everything and the test passing vacuously).
describe("import guard sanity", () => {
  it("finds at least one file importing getCoursePins", async () => {
    const files = await walk(ROOT);
    let count = 0;
    for (const file of files) {
      if (TEST_FILE_PATTERN.test(file)) continue;
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === "lib/golf-api/pgatour.ts") continue;
      if (rel === "lib/pin-sheet-augment.ts") continue;
      const text = await readFile(file, "utf-8");
      if (
        /\bimport\b[^;]*\bgetCoursePins\b[^;]*from\s*["']@\/lib\/golf-api\/pgatour["']/s.test(
          text,
        )
      ) {
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});

// Silence the unused-import warning from stat.
void stat;
