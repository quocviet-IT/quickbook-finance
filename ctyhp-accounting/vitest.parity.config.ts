import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The prototype-parity harness (tests/parity). Never part of `npm test`: it
 * needs the prototype's file on this machine, a browser and the database, and
 * takes minutes. Run with `npm run parity` (see docs/superpowers/plans/2026-10-02-parity-harness.md).
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Supplied by the Next.js bundler; unresolvable in a plain vitest run.
      "server-only": fileURLToPath(new URL("./tests/e2e/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/parity/**/*.parity.ts"],
    fileParallelism: false,
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
  },
});
