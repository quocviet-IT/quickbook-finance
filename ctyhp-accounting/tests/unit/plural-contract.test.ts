import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A count agrees with its noun: "1 record", "2 records". Never "1 records",
 * never "record(s)".
 *
 * The UI review of 2026-10-17 found "1 records" under a list whose filter bar
 * said "1 result", and "bill(s)", "account(s)", "rule(s)" across the import,
 * banking and fixed-asset screens. Twelve modules each kept a private
 * `plural()`, and some sixty sentences wrote `n === 1 ? "" : "s"` by hand.
 *
 * `plural` and `pluralWord` in lib/format.ts are the one helper. This test is
 * the boundary: it fails on the hand-written forms wherever they come back.
 * The parity tooling (lib/parity) prints for developers, and the changelog
 * quotes old wording, so both are left out.
 */
const EXEMPT = [/^lib\/parity\//, /^lib\/domain\/changelog\.ts$/, /^lib\/format\.ts$/];

const RULES: { name: string; pattern: RegExp }[] = [
  {
    // A word, then "(s)", but not a call with an argument named s, such as
    // hasActivity(s)) or toStatementLines(s), which code carries on from.
    name: 'a noun with "(s)"',
    pattern: /[A-Za-z]\(s\)(?!\s*(\)|,|;|\?\?|&&|\|\||\.[A-Za-z_$]|\{))/,
  },
  { name: "a private plural helper", pattern: /\bfunction\s+plural\s*\(|\bconst\s+plural\s*=/ },
  {
    name: 'a hand-written plural ending (n === 1 ? "" : "s")',
    pattern: /(===|!==|>|<|<=|>=)\s*1\s*\?\s*["'](s?)["']\s*:\s*["'](s?)["']/,
  },
];

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

/**
 * Every file read once and kept. Each rule used to read the whole tree again,
 * which ran this test to its 5s limit when the suite ran in parallel.
 */
const fileLines = new Map<string, string[]>();
function linesOf(file: string): string[] {
  let lines = fileLines.get(file);
  if (!lines) {
    lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
    fileLines.set(file, lines);
  }
  return lines;
}
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("counts go through plural()", () => {
  const root = process.cwd();
  const files = ["app", "components", "lib"]
    .flatMap((dir) => sourceFiles(join(root, dir), root))
    .filter((file) => !EXEMPT.some((exempt) => exempt.test(file)));
  // Read while the suite is collected, so no single test carries the disk time.
  for (const file of files) linesOf(file);

  it("finds the files it is supposed to be guarding", () => {
    expect(files).toContain("components/ui/table-data.ts");
    expect(files).toContain("lib/domain/payment-terms.ts");
  });

  it('tells "(s)" in a sentence from a call with an argument named s', () => {
    const noun = RULES[0].pattern;
    for (const prose of ["`${n} account(s) classified`", "Classify {n} account(s)</Button>", "`${n} row(s).`", "rule(s): "]) {
      expect(prose).toMatch(noun);
    }
    for (const code of ["if (!hasActivity(s)) {", "statementProof(s);", "toStatementLines(s),", "counts.get(s) ?? 0"]) {
      expect(code).not.toMatch(noun);
    }
  });

  for (const rule of RULES) {
    it(`nothing writes ${rule.name}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        linesOf(file)
          .forEach((line, index) => {
            if (!isComment(line) && rule.pattern.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }
});
