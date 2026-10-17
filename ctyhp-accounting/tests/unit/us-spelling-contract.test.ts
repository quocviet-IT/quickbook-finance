import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The words on screen are US English.
 *
 * The UI review of 2026-10-17 found British spellings scattered through the
 * screens a US bookkeeper reads every day: "Realisable" as a column title,
 * "summarised", "categorised", "ageing", "behaviour", "enrol", "Cancelled".
 * Each was one string in one file, so nothing caught the next one.
 *
 * This looks only inside quoted strings, where the words a reader sees live.
 * Identifiers such as `categoriseBankTransaction` stay as they are — renaming
 * them changes nothing on screen — and so does the stored status value
 * "cancelled", which is data, not wording.
 */
const BRITISH = new RegExp(
  "\\b(" +
    [
      "realisable", "realis(e|ed|es|ing)", "summaris(e|ed|es|ing)", "recognis(e|ed|es|ing)",
      "categoris(e|ed|es|ing)", "organis(e|ed|es|ing|ation)", "prioritis(e|ed|es|ing)",
      "finalis(e|ed|es|ing)", "authoris(e|ed|es|ing|ation)", "analys(ed|es|ing)",
      "behaviours?", "colours?", "favourites?", "ageing", "enrol", "enrols", "enrolment",
      "modelled", "labelled", "centre", "catalogue",
    ].join("|") +
    ")\\b",
  "i",
);

/** A quoted run of text: what a reader can be shown. */
const QUOTED = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g;

export function britishIn(line: string): string[] {
  const found: string[] = [];
  for (const match of line.matchAll(QUOTED)) {
    const text = match[0].slice(1, -1);
    const word = text.match(BRITISH);
    if (word) found.push(word[0]);
    // "cancelled" alone is a stored status; inside a sentence or capitalised
    // as a label it is wording.
    if (/\bCancelled\b/.test(text) || (/\bcancelled\b/.test(text) && /\s/.test(text))) found.push("cancelled");
  }
  return found;
}

/** History is left as published; parsing lists read other people's files. */
const EXEMPT = new Set([
  "lib/domain/changelog.ts",
  "lib/domain/statement-import.ts",
  "lib/domain/statement-pairing.ts",
  "lib/domain/reconcile-statement.ts",
  "lib/domain/coding-names.ts",
  "lib/domain/account-search.ts",
]);

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

describe("the words on screen are US English", () => {
  it("catches the spellings it is meant to, and leaves names and stored values alone", () => {
    expect(britishIn(`title: "Realisable",`)).toEqual(["Realisable"]);
    expect(britishIn(`message.error("Could not categorise this line")`)).toEqual(["categorise"]);
    expect(britishIn("label: `Open the ageing report`")).toEqual(["ageing"]);
    expect(britishIn(`{ value: "cancelled", label: "Cancelled" }`)).toEqual(["cancelled"]);
    expect(britishIn(`"Only an order with no bills can be cancelled."`)).toEqual(["cancelled"]);
    expect(britishIn(`row.status !== "cancelled" &&`)).toEqual([]);
    expect(britishIn(`await categoriseBankTransaction(sb, id, accountId);`)).toEqual([]);
    expect(britishIn(`netRealisableValue(item())`)).toEqual([]);
  });

  it("finds none in app/, components/ or lib/", () => {
    const root = process.cwd();
    const files = ["app", "components", "lib"].flatMap((dir) => sourceFiles(join(root, dir), root));
    expect(files).toContain("app/(app)/reports/inventory-review/InventoryReviewClient.tsx");
    const offenders: string[] = [];
    for (const file of files) {
      if (EXEMPT.has(file)) continue;
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
          for (const word of britishIn(line)) offenders.push(`${file}:${index + 1}  ${word}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
