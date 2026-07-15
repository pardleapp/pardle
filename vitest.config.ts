import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest doesn't read tsconfig paths natively — mirror the `@` alias
// (which resolves to the repo root in tsconfig.json) so tests can
// import code that lives at `@/lib/...` and `@/app/...`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
