import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A status reads the same way everywhere: through StatusTag
 * (components/ui/StatusTag.tsx) or statusLabel (lib/domain/status-label.ts),
 * first letter capitalized, never as the code the database keeps.
 *
 * The UI review of 2026-10-17 found "open", "received", "draft", "void",
 * "not enrolled" and "stock_count" on screen beside screens that said "Open"
 * and "Partially paid"; "State" heading the column other screens call
 * "Status"; and "New Journal Entry" beside "New invoice". This test is the
 * boundary for each of those shapes.
 *
 * Documents & Attachments is left out: its screens are frozen while the
 * feature is paused.
 */
const FROZEN = [/^components\/documents\//, /^app\/\(app\)\/documents\//];

const RULES: { name: string; pattern: RegExp; exempt?: RegExp[] }[] = [
  {
    // <Tag>draft</Tag>, <Tag color="gold">needs coding</Tag>
    name: "a tag whose word starts in lowercase",
    pattern: /<Tag\b[^>]*>\s*[a-z]/,
  },
  {
    // <Tag color={STATUS_COLOR[s]}>{s}</Tag>, <Tag>{period.status}</Tag>
    name: "a tag that prints a stored code as it is",
    pattern: /<Tag\b[^>]*>\s*\{\s*([a-z]|value|status|[A-Za-z_.]*\.(status|state|kind|basis|method|role|lifecycle))\s*\}\s*<\/Tag>/,
  },
  {
    // v.replace(/_/g, " ") → "attention required", "bill variance"
    name: "a code turned into lowercase words by hand (use humanizeStatus or statusLabel)",
    pattern: /replace(All)?\(\s*("_"|'_'|\/_\/g)\s*,\s*("\s"|" "|' ')\s*\)/,
  },
  {
    // "New Journal Entry" beside "New invoice": actions are sentence case.
    name: "an action label in Title Case",
    pattern: /["'>`]\s*(New|Add|Create|Edit|Record|Set) [A-Z][a-z]+( [A-Z][a-z]+)*\s*["'<`]/,
  },
  {
    // The column other screens call Status. A US state is a different thing.
    name: 'a status column headed "State"',
    pattern: /title:\s*"State"/,
    exempt: [/^app\/\(app\)\/sales-tax\//],
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

describe("statuses and actions read one way on every screen", () => {
  const root = process.cwd();
  const files = [...sourceFiles(join(root, "app"), root), ...sourceFiles(join(root, "components"), root)].filter(
    (file) => !FROZEN.some((frozen) => frozen.test(file)),
  );
  // Read while the suite is collected, so no single test carries the disk time.
  for (const file of files) linesOf(file);

  it("finds the files it is supposed to be guarding", () => {
    expect(files).toContain("app/(app)/bills/BillsClient.tsx");
    expect(files).toContain("components/ui/StatusTag.tsx");
  });

  for (const rule of RULES) {
    it(`nothing shows ${rule.name}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        if (rule.exempt?.some((exempt) => exempt.test(file))) continue;
        linesOf(file)
          .forEach((line, index) => {
            if (!isComment(line) && rule.pattern.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("tells a lowercase tag from a capitalized one, and a code from a label", () => {
    const [lower, raw, , title] = RULES.map((rule) => rule.pattern);
    expect("<Tag>draft</Tag>").toMatch(lower);
    expect('<Tag color="gold">Needs coding</Tag>').not.toMatch(lower);
    expect("<Tag color={STATUS_COLOR[s]}>{s}</Tag>").toMatch(raw);
    expect("<Tag>{period.status}</Tag>").toMatch(raw);
    expect("<Tag>{statusLabel(period.status)}</Tag>").not.toMatch(raw);
    expect('title="New Journal Entry"').toMatch(title);
    expect('title="New journal entry"').not.toMatch(title);
  });
});
