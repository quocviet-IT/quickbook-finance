// Cash Flow Statement verification entrypoint.
//
// Runs the real migration and ledger fixtures in an isolated schema inside one
// database transaction. The E2E test always rolls back, so this verifier never
// creates, voids, deletes, or renumbers documents in the company's books.
//
// Run: node --env-file=.env.local scripts/verify-cashflow.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    "vitest.e2e.config.ts",
    "tests/e2e/cash-flow-indirect.e2e.ts",
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
