import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportPagination } from "@/components/reports/SimpleReport";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const frame = read("components/reports/SimpleReport.tsx");

const PAGED_BODIES = [
  "components/reports/OpenDocumentsReport.tsx",
  "components/reports/PartyBalancesReport.tsx",
  "components/reports/PartyActivityReport.tsx",
  "app/(app)/reports/reconciliations/ReconciliationsClient.tsx",
  "app/(app)/reports/change-log/ChangeLogClient.tsx",
  "app/(app)/reports/voided-entries/VoidedEntriesClient.tsx",
];

describe("the report frame", () => {
  it("prints every row, and pages them on screen", () => {
    expect(reportPagination(true, 50, () => {}, 50)).toBe(false);
    const onScreen = reportPagination(false, 25, () => {}, 50);
    expect(onScreen).toMatchObject({ pageSize: 25 });
  });

  it("draws every row before the browser takes its print snapshot", () => {
    expect(frame).toMatch(/addEventListener\("beforeprint", before\)/);
    expect(frame).toMatch(/const before = \(\) => flushSync\(\(\) => setPrinting\(true\)\)/);
    expect(frame).toMatch(/props\.render\(shown, ran, \{ printing \}\)/);
  });

  it("shows only the newest run's answer", () => {
    expect(frame).toMatch(/const thisRun = \+\+latestRun\.current;/);
    expect(frame).toMatch(/const result = await load\(when\);\s*if \(overtaken\(\)\) return;/);
    expect(frame).toMatch(/if \(!overtaken\(\)\) setLoading\(false\);/);
  });

  it("fills filter choices only from an answer it shows", () => {
    expect(frame).toMatch(/setRan\(when\);\s*onLoaded\?\.\(result\.data\);/);
    for (const path of ["app/(app)/reports/reconciliations/ReconciliationsClient.tsx", "app/(app)/reports/change-log/ChangeLogClient.tsx"]) {
      const source = read(path);
      expect(source, path).not.toMatch(/loadAndList/);
      expect(source, path).toMatch(/onLoaded=\{/);
    }
  });

  it("is what every paged report table uses", () => {
    for (const path of PAGED_BODIES) {
      const source = read(path);
      expect(source, path).toMatch(/pagination=\{reportPagination\(printing, pageSize, setPageSize, PAGE_SIZE\)\}/);
      expect(source, path).not.toMatch(/pagination=\{clientTablePagination\(/);
    }
  });
});
