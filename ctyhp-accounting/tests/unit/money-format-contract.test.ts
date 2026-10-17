import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A screen shows money one way: "$1,234.56", and "-$1,234.56" below zero.
 *
 * The UI review of 2026-10-17 found three ways side by side. Invoices said
 * "$14,610.00", Bills said "990.00 USD", Purchase Orders "3985.00 USD" with no
 * thousands separator, and the reconcile, journal and ledger screens printed
 * "1,234.56" with no symbol at all and "-2,400.00" for a negative. Each screen
 * had written its own `fmt`, so a reader comparing a bill with its invoice saw
 * two currencies where there was one.
 *
 * `formatMoney` in lib/format.ts is the one formatter. This test is the
 * boundary: it fails on the three shapes the local helpers took, wherever a
 * new screen writes one again.
 */
const RULES: { name: string; pattern: RegExp }[] = [
  {
    // `${(minor / 10 ** d).toFixed(d)} ${code}` → "1234.56 USD"
    name: "an amount with toFixed followed by its currency code",
    pattern: /toFixed\([^)]*\)\s*\}?\s*\$?\{\s*[\w.]*(currency|code|Currency)[\w.]*\s*\}/,
  },
  {
    // `$${(v / 100).toFixed(2)}` → "$1234.56", no separators and always 2 places
    name: "a hand-written dollar sign in front of toFixed",
    pattern: /\$\$\{\s*\(?[^`]*\.toFixed\(/,
  },
  {
    // fromMinor(m, d).toLocaleString(undefined, { minimumFractionDigits: d })
    // → "1,234.56" with no symbol, in whatever locale the browser runs.
    name: "a money amount in the browser's locale with no currency",
    pattern: /toLocaleString\(\s*undefined\s*,\s*\{\s*minimumFractionDigits/,
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

describe("money on screen goes through formatMoney", () => {
  const root = process.cwd();
  const files = [...sourceFiles(join(root, "app"), root), ...sourceFiles(join(root, "components"), root)];

  it("finds the files it is supposed to be guarding", () => {
    expect(files).toContain("app/(app)/bills/BillsClient.tsx");
    expect(files).toContain("components/payables/PayRunPanel.tsx");
  });

  for (const rule of RULES) {
    it(`no screen formats ${rule.name}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        readFileSync(join(root, file), "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (rule.pattern.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
          });
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the shared formatter writes the one shape", async () => {
    const { formatMoney } = await import("@/lib/format");
    expect(formatMoney(123456, "USD", 2)).toBe("$1,234.56");
    expect(formatMoney(-240000, "USD", 2)).toBe("-$2,400.00");
    expect(formatMoney(0, "USD", 2)).toBe("$0.00");
  });
});
