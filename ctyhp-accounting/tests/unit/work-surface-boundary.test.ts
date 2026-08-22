import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shared work surface must not learn one area's business.
 *
 * `WorkAreaOverview` is the reason this test exists. It began as a shared
 * component and became one screen's composition that four areas were fitted
 * into: eighteen fixed fields, so Banking got a "trend" and Inventory got
 * "stages" — not because anyone asked what those screens were for, but because
 * the shape was already there.
 *
 * Nothing stops that happening again except a rule that fails the build. A
 * primitive earns its place by being about *work*; the moment it knows what a
 * ledger, an invoice or a bank feed is, it is one area's code with a general
 * name, and the next area will be bent to fit it.
 *
 * Design record: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

const SHARED_DIRECTORIES = [
  "lib/domain/work-surface",
  "lib/services/work-surface",
  "components/work-surface",
];

/** Modules that belong to one area. A shared file importing one has picked a side. */
const AREA_IMPORT = /from\s+["']@?[./\w-]*(accounting-dashboard|work-areas|work-area-overview)/;

/**
 * Words that only mean something inside one area.
 *
 * Kept to nouns that are unambiguously domain-specific. General money and
 * business words — amount, due, overdue, balance — are fair game on any surface
 * and are deliberately absent.
 */
const AREA_VOCABULARY = [
  "ledger",
  "journal",
  "trial balance",
  "subledger",
  "invoice",
  "bill ",
  "vendor",
  "customer",
  "reconciliation",
  "bank",
  "period close",
  "fiscal",
  "debit",
  "credit",
  "inventory",
  "stock",
  "purchase order",
];

function filesUnder(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // A directory that does not exist yet is not a failure: the areas arrive one
    // at a time, and this test should pass before the first of them lands.
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sharedFiles = SHARED_DIRECTORIES.flatMap(filesUnder).filter((path) =>
  /\.(ts|tsx|css)$/.test(path),
);

describe("the shared work surface", () => {
  it("has files to check, so a passing run means something", () => {
    expect(sharedFiles.length).toBeGreaterThan(3);
  });

  it("imports nothing from an area", () => {
    const offenders = sharedFiles.filter((path) => AREA_IMPORT.test(readFileSync(path, "utf8")));
    expect(
      offenders,
      "a shared primitive that imports from an area is that area's code with a general name",
    ).toEqual([]);
  });

  it("does not name an area's vocabulary", () => {
    const offenders: string[] = [];
    for (const path of sharedFiles) {
      const text = readFileSync(path, "utf8").toLowerCase();
      for (const word of AREA_VOCABULARY) {
        // Comments explaining *why* a primitive is general legitimately name the
        // areas they are general across. Only code is checked.
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|\s)\/\/[^\n]*/g, " ");
        if (code.includes(word)) offenders.push(`${path}: "${word.trim()}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
