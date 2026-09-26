import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This repository is public.
 *
 * A real client's ledger — genuine balances and a real, if masked, bank
 * account label — has been committed into it more than once: once in a test
 * file's fixture data, and again a dozen times inside a planning document,
 * because that document's example code is committed too, exactly like any
 * other file. Publishing documentation publishes data just as surely as
 * publishing code does; there is no "it's just a doc" exemption once it is
 * pushed. Every single time, the person who committed it believed the
 * numbers were a made-up example.
 *
 * Pushing to GitHub is permanent. Deleting the file afterward does not
 * remove it from history, and it does not reach anyone who already cloned
 * the repo. So this cannot be a review habit — it has to run with the
 * suite, on every push, so a leak fails the build instead of shipping.
 *
 * A real dollar amount is indistinguishable from a made-up one, so this
 * gate does not look for amounts. It looks for the one thing about this
 * client's data that is NOT interchangeable with a fake: the shape of its
 * chart-of-accounts labels (the `PC49` token, and the `BoA CK <digits>`
 * bank-account label). Nowhere in this file is a real figure written down —
 * that would recreate the exact problem this file exists to prevent.
 *
 * Some files predate this gate and still carry that shape; they are
 * grandfathered below by exact path. Whether and when to clean them up is a
 * decision for a person, not this test — this test only makes sure the
 * grandfathered list cannot grow, cannot go stale, and that nothing outside
 * it is allowed to carry the marker.
 */

/** This file's own path, exempt because it necessarily names the pattern. */
const SELF = "tests/unit/customer-data.test.ts";

/**
 * Files that predate this gate and still contain the marker. Do not add to
 * this set to silence a new failure — that defeats the gate. Do not edit
 * the five files themselves from this test either; removing the leak from
 * them is a separate decision for a human. This set exists only to shrink,
 * enforced by the "only ever shrinks" test below.
 */
const GRANDFATHERED = new Set<string>([
  "tests/unit/account-classification.test.ts",
  "tests/unit/excluded-rows.test.ts",
  "tests/unit/import-preflight.test.ts",
  "tests/unit/import-transactions-migration.test.ts",
  "tests/unit/import-transactions-service.test.ts",
]);

/**
 * Matches the client's chart-of-accounts label shape: the `PC49` token on
 * its own (case-insensitive, in case a lowercase slip gets through), and the
 * `BoA CK <digits>` bank-account label on its own, in case the two are ever
 * split apart or `PC49` is trimmed off in some future copy. Built fresh on
 * each call, matching the convention in table-adoption.test.ts: a `/g`
 * regex carries `lastIndex` between `.test()` calls and would silently
 * report every other file clean.
 */
function markerPattern(): RegExp {
  return /pc49|boa\s+ck\s+\d+/i;
}

const PROJECT_ROOT = process.cwd();

/** Directories that are never source material for a leak. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage"]);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

/**
 * Scans a root directory for files, returning each one's path relative to
 * the project root. Missing roots return no files instead of throwing, so
 * this test never fails for the wrong reason (e.g. `docs/` not existing in
 * some other checkout shape) — only for a marker actually being present.
 */
function scan(root: string): { path: string; source: string }[] {
  if (!existsSync(root)) return [];
  return filesUnder(root).map((file) => ({
    path: relative(PROJECT_ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }));
}

// `docs/` lives at the repository root, one level above this project.
const DOCS_ROOT = resolve(PROJECT_ROOT, "..", "docs");

const files = [...scan(join(PROJECT_ROOT, "tests")), ...scan(DOCS_ROOT)].filter(
  (file) => file.path !== SELF,
);

describe("customer data leak gate", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("tells the marker apart from ordinary text", () => {
    // The two mistakes this guard exists to avoid making itself.
    expect(markerPattern().test("PC49 BoA CK 3388")).toBe(true);
    expect(markerPattern().test("pc49")).toBe(true);
    expect(markerPattern().test("121 - Checking")).toBe(false);
    expect(markerPattern().test("BoA branch visit")).toBe(false);
  });

  it("finds the marker nowhere outside the shrinking list", () => {
    const offenders = files
      .filter(({ path }) => !GRANDFATHERED.has(path))
      .filter(({ source }) => markerPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("only ever shrinks, so a sixth leaked file cannot be waved through", () => {
    // The allowlist is the outstanding cleanup, not a resting place. Adding
    // to it is how a guard quietly stops guarding, and it reads in a diff
    // exactly like an unrelated change. Lowering this number is the
    // cleanup; raising it has to be argued for, out loud, to a person.
    expect(GRANDFATHERED.size).toBeLessThanOrEqual(5);
  });

  it("lists no file that has already been cleaned", () => {
    // Keeps the list honest. Scrub a file and forget to drop its entry and
    // this fails, so the list cannot turn into a record of work already done.
    const byPath = new Map(files.map((file) => [file.path, file.source]));
    const stale = [...GRANDFATHERED].filter((path) => !markerPattern().test(byPath.get(path) ?? ""));
    expect(stale, "already cleaned of the marker").toEqual([]);
  });

  it("names a file that exists for every entry", () => {
    // A path typo would otherwise sit in the list forever, exempting
    // nothing and making the outstanding cleanup look smaller than it is.
    const known = new Set(files.map((file) => file.path));
    const missing = [...GRANDFATHERED].filter((path) => !known.has(path));
    expect(missing, "listed but not found on disk").toEqual([]);
  });
});
