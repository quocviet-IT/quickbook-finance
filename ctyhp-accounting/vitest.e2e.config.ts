import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Supplied by the Next.js bundler; unresolvable in a plain vitest run.
      "server-only": fileURLToPath(
        new URL("./tests/e2e/support/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
