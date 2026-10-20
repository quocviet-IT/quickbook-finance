import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the journal amounts release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Amount on every journal entry"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("says both journal screens show the amount, the export carries it, and descriptions sit on one line", () => {
    for (const words of ["Journal Entries and the Journal Report", "Entry amount", "on one line"]) {
      expect(said).toContain(words);
    }
  });
});

describe("the journal screens' columns", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const entries = read("app/(app)/journal/JournalClient.tsx");
  const report = read("app/(app)/reports/journal/JournalReportClient.tsx");

  it("show each entry's amount, worked out the same way on both", () => {
    for (const source of [entries, report]) {
      expect(source).toContain('title: "Amount"');
      expect(source).toContain("journalEntryAmountMinor(e.lines)");
    }
  });

  it("give the Journal Report's description the room the other columns leave", () => {
    // With no widths at all, antd's fixed layout split the table five ways.
    expect(report).toMatch(/flexColumn<JournalEntrySummary>\(\{ title: "Description"/);
    for (const width of ["COLUMN.CODE", "COLUMN.DATE", "SOURCE_WIDTH", "COLUMN.MONEY_WIDE", "COLUMN.STATUS"]) {
      expect(report).toContain(`width: ${width}`);
    }
  });
});
