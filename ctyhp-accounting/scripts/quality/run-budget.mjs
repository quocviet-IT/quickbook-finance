/**
 * The bundle gate that actually refuses.
 *
 * `quality:bundle` measures and reports; in report mode it returns 0 whatever
 * it finds, which is right for a weekly audit and useless as a guard. This
 * reads the same artifact and fails the build when a stated ceiling is crossed.
 *
 * Deterministic on purpose: it needs a build and nothing else — no server, no
 * sign-in, no network, no clock. A gate that only works when six other things
 * are up is a gate that gets switched off.
 *
 * The ceilings live in tests/quality/budgets.json, next to the figure each one
 * was set from, so raising one is a visible edit in a diff rather than a flag
 * somebody passed.
 *
 * Run: npm run quality:budget   (after npm run build && npm run quality:bundle)
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { qualityPaths } from "./config.mjs";

const root = process.cwd();
const paths = qualityPaths(root);
const budgetsPath = resolve(root, "tests", "quality", "budgets.json");
const reportPath = join(paths.resultsDir, "bundle.json");

function read(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Could not read ${what} at ${path}: ${error.message}`);
    if (path === reportPath) {
      console.error("Run `npm run build && npm run quality:bundle` first.");
    }
    process.exit(1);
  }
}

const budgets = read(budgetsPath, "the budgets");
const report = read(reportPath, "the bundle report").bundle;

let failures = 0;
let checks = 0;

function compare(label, actual, ceiling) {
  checks += 1;
  const over = actual - ceiling;
  if (over > 0) {
    failures += 1;
    console.log(`  OVER  ${label}: ${actual} gzip, ceiling ${ceiling} — over by ${over}`);
  } else {
    console.log(`  ok    ${label}: ${actual} gzip, ceiling ${ceiling} (${-over} to spare)`);
  }
}

for (const [route, budget] of Object.entries(budgets.routes ?? {})) {
  const measured = report.routes.find((entry) => entry.route === route);
  if (!measured) {
    // A budgeted route that no longer exists is a stale budget, not a pass.
    // Saying nothing here would let a renamed page quietly lose its ceiling.
    failures += 1;
    checks += 1;
    console.log(`  GONE  ${route}: budgeted but not in the build`);
    continue;
  }
  if (typeof budget.gzipBytes === "number") {
    compare(`${route} total`, measured.gzipBytes, budget.gzipBytes);
  }
  if (typeof budget.ownedGzipBytes === "number") {
    compare(`${route} owned`, measured.owned.gzipBytes, budget.ownedGzipBytes);
  }
}

if (typeof budgets.total?.gzipBytes === "number") {
  compare("all routes", report.total.gzipBytes, budgets.total.gzipBytes);
}

console.log(`\n${checks - failures} within budget, ${failures} over.`);
if (failures > 0) {
  console.log("Raise a ceiling in tests/quality/budgets.json only with a reason in the commit.");
  process.exit(1);
}
