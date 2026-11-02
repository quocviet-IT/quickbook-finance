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
 * This gate covers source, schema, tests and docs: `lib/`, `app/`,
 * `supabase/`, `tests/`, and the repository root's `docs/`. Source is in
 * scope because the worst instance of this leak so far was not in a test
 * fixture or a planning doc — it was in production code, rendered on the
 * import screen as the worked example shown to every user, and it was found
 * by a person reading the code, not by this gate. An earlier version of
 * this gate, scanning only `tests/` and root `docs/`, would not have caught
 * it.
 *
 * Eleven files predated this gate and carried that shape; they were
 * grandfathered by exact path until 2 November 2026, when all of them were
 * rewritten with made-up labels, dates and amounts in the same shape (and the
 * real figures beside the labels went with them, which this gate could never
 * have seen). The list is now empty and must stay so: nothing anywhere in the
 * scan roots may carry the marker. History still holds the old versions; that
 * was decided, and is not this test's business.
 *
 * The first version of this list named 5 files, written from memory rather
 * than from a run of this test. Running it found 5 more — a sixth test file
 * plus four planning docs the first pass never looked at — so that list was
 * the result of actually running the scan, not of guessing at it again: 10
 * files, settled by measurement. Widening the scan roots to source and
 * schema found one more: a migration comment describing how the importer
 * resolves an account name — 11 files, settled by measurement rather than
 * memory. That migration had been applied, which first kept it on the list;
 * the marker sat in a comment, and the runner tracks a migration by its file
 * name and the provisioner runs its statements, not its prose, so the
 * comment was rewritten like the rest.
 *
 * `.claude/settings.json` also contains the `pc49` token once, but as part
 * of a recorded Bash permission pattern (a scratchpad script's filename from
 * an earlier session), not as ledger data. That file sits outside this
 * gate's scan roots already, and stays there deliberately rather than being
 * added below — allowlisting it would imply it is the same kind of debt as
 * the eleven were, which it is not.
 */

/** This file's own path, exempt because it necessarily names the pattern. */
const SELF = "tests/unit/customer-data.test.ts";

/**
 * Files exempt from the gate. Empty since 2 November 2026, when the last
 * eleven were cleaned. Do not add to it to silence a failure — that defeats
 * the gate; rewrite the data in the file instead, in the same shape with
 * made-up values ("Riverbend Bank CK 4471" is the bank label the fixtures use).
 */
const GRANDFATHERED = new Set<string>([]);

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

/**
 * Directories that are never source material for a leak: dependency and
 * build output (`node_modules`, `.next`, `coverage`), VCS internals
 * (`.git`), and the Supabase CLI's local, gitignored scratch state
 * (`.temp`, e.g. `supabase/.temp/pooler-url`) — machine-local, never
 * committed, and not what this gate is watching for.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", ".temp"]);

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

// Source and schema, alongside tests and docs: the worst leak of all was in
// `lib/`, not in either of those — see the header comment above.
const SCAN_ROOTS = ["lib", "app", "supabase", "tests"].map((root) => join(PROJECT_ROOT, root));

const files = SCAN_ROOTS.flatMap(scan)
  .concat(scan(DOCS_ROOT))
  .filter((file) => file.path !== SELF);

describe("customer data leak gate", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("tells the marker apart from ordinary text", () => {
    // The two mistakes this guard exists to avoid making itself.
    // The digits here are made up; only the shape is the client's.
    expect(markerPattern().test("PC49 BoA CK 0000")).toBe(true);
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

  it("exempts nothing, so a leaked file cannot be waved through", () => {
    // The allowlist was the outstanding cleanup, and the cleanup is done.
    // Adding to it is how a guard quietly stops guarding, and it reads in a
    // diff exactly like an unrelated change; raising this number has to be
    // argued for, out loud, to a person.
    expect(GRANDFATHERED.size).toBe(0);
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
