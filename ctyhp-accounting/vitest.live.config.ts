import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Read-only checks against the live books (tests/live). Never part of `npm test`:
 * they need `.env.local`, sign in as the smoke user, and take minutes.
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
    include: ["tests/live/**/*.live.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 120_000,
  },
});
