import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A screen shows a date one way, `10/16/2026`, and a time one way, `11:07 PM`,
 * on the company's clock.
 *
 * The UI review of 2026-10-17 found `2026-10-16`, `Aug 31, 2026` and
 * `October 16, 2026` side by side, times in 24-hour and 12-hour, and two
 * reports a day apart on their "as of" line: one took today from UTC, one
 * from the reader's browser, one from the company's time zone. Each screen had
 * written its own formatter.
 *
 * lib/format.ts holds the formatters (`formatDate`, `formatDateRange`,
 * `formatTime`, `formatDateTime`, `formatDateInTimeZone`, `todayInTimeZone`)
 * and components/CompanyClock.tsx gives client screens the company's time zone
 * and today. This test is the boundary: it fails on each shape the local
 * versions took, wherever a new screen writes one again.
 *
 * Documents & Attachments is left out: its screens are frozen while the
 * feature is paused.
 */
const FROZEN = [/^components\/documents\//, /^app\/\(app\)\/documents\//];

/**
 * A file where a rule's shape is right, and why. The nightly backup run ranks
 * every company by days since its last backup on one clock, so its day is UTC
 * on purpose; no reader sees it.
 */
const EXEMPT: Record<string, string> = {
  "lib/services/backup-queue-runner.ts": "today taken from UTC (new Date().toISOString().slice(0, 10))",
};

/** Formats a date picker value may be sent to the server in; anything else is a display format. */
const MACHINE_FORMATS = new Set(["YYYY-MM-DD", "YYYY-MM", "YYYY"]);

const RULES: { name: string; pattern: RegExp; scope: "screens" | "screens-and-services" }[] = [
  {
    name: "a date in the browser's own locale (toLocaleDateString / toLocaleTimeString)",
    pattern: /\.toLocale(Date|Time)String\(/,
    scope: "screens",
  },
  {
    name: "a moment in the browser's locale and time zone (toLocaleString with no arguments)",
    pattern: /\.toLocaleString\(\s*\)/,
    scope: "screens",
  },
  {
    name: "a hand-built date format (toLocaleString with date fields)",
    pattern: /toLocaleString\([^)]*\{[^}]*\b(year|month|day|hour|minute)\s*:/,
    scope: "screens",
  },
  {
    name: "a screen's own Intl.DateTimeFormat",
    pattern: /Intl\.DateTimeFormat\(/,
    scope: "screens",
  },
  {
    name: "a timestamp cut at its T (`2026-10-16 23:07`, UTC, 24-hour)",
    pattern: /\.replace\(\s*["']T["']\s*,\s*["'] ["']\s*\)/,
    scope: "screens",
  },
  {
    name: "today taken from UTC (new Date().toISOString().slice(0, 10))",
    pattern: /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    scope: "screens-and-services",
  },
  {
    name: "today taken from the browser's clock (dayjs())",
    pattern: /\bdayjs\(\s*\)/,
    scope: "screens",
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

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("dates on screen go through lib/format", () => {
  const root = process.cwd();
  const screens = [...sourceFiles(join(root, "app"), root), ...sourceFiles(join(root, "components"), root)].filter(
    (file) => !FROZEN.some((frozen) => frozen.test(file)),
  );
  const services = sourceFiles(join(root, "lib", "services"), root);

  it("finds the files it is supposed to be guarding", () => {
    expect(screens).toContain("app/(app)/bills/BillsClient.tsx");
    expect(screens).toContain("components/ui/columns.tsx");
    expect(services).toContain("lib/services/dashboard.ts");
  });

  for (const rule of RULES) {
    it(`no screen shows ${rule.name}`, () => {
      const files = rule.scope === "screens" ? screens : [...screens, ...services];
      const offenders: string[] = [];
      for (const file of files) {
        if (EXEMPT[file] === rule.name) continue;
        readFileSync(join(root, file), "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (!isComment(line) && rule.pattern.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("no screen formats a date picker value for display (only YYYY-MM-DD, YYYY-MM or YYYY go to the server)", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (isComment(line)) return;
          for (const match of line.matchAll(/\.format\(\s*["']([^"']*)["']\s*\)/g)) {
            const looksLikeDate = /^[YMDdHhmsAaQo:/,.\- [\]]+$/.test(match[1]) && /[YMDHh]/.test(match[1]);
            if (looksLikeDate && !MACHINE_FORMATS.has(match[1])) {
              offenders.push(`${file}:${index + 1}  ${line.trim()}`);
            }
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("a date column shows the one date style", () => {
    const source = readFileSync(join(root, "components", "ui", "columns.tsx"), "utf8");
    expect(source).toMatch(/formatDate\(/);
  });

  it("every date picker shows MM/DD/YYYY", () => {
    const source = readFileSync(join(root, "app", "providers.tsx"), "utf8");
    expect(source).toMatch(/fieldDateFormat:\s*"MM\/DD\/YYYY"/);
  });
});
