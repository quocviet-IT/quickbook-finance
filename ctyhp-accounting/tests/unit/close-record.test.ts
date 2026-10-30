import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CloseStep } from "@/lib/domain/accounting-dashboard/close-checklist";
import { checklistRecord, checklistSummary, NO_CHECKLIST_KEPT, readChecklist, type RecordedCloseStep } from "@/lib/domain/close-record";
import { checklistCell, closeLog, closeLogSheet, type ClosePeriod } from "@/lib/domain/close-log";

const step = (key: string, status: CloseStep["status"], over: Partial<CloseStep> = {}): CloseStep => ({
  key,
  title: `Example check ${key}`,
  status,
  passCondition: "Example condition",
  evidence: `Example evidence ${key}`,
  blocksClose: false,
  href: "/accounting",
  workKey: null,
  ...over,
});

describe("checklistRecord (2.84)", () => {
  it("keeps the check, its status, what it found and whether it stops a close; not the screen's links", () => {
    const [kept] = checklistRecord([step("trial-balance", "complete", { blocksClose: true })]);
    expect(kept).toEqual({
      key: "trial-balance",
      title: "Example check trial-balance",
      status: "complete",
      evidence: "Example evidence trial-balance",
      blocksClose: true,
    });
  });
  it("cuts a long finding short rather than refusing the close", () => {
    const [kept] = checklistRecord([step("long", "outstanding", { evidence: "x".repeat(900) })]);
    expect(kept.evidence).toHaveLength(600);
    expect(kept.evidence.endsWith("…")).toBe(true);
  });
});

describe("readChecklist", () => {
  it("reads back what was kept", () => {
    const kept = checklistRecord([step("a", "complete"), step("b", "outstanding")]);
    expect(readChecklist(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });
  it("says none was kept for nothing, an empty list, or something it cannot read", () => {
    expect(readChecklist(null)).toBeNull();
    expect(readChecklist([])).toBeNull();
    expect(readChecklist([{ key: "a", title: "A", status: "maybe" }])).toBeNull();
    expect(readChecklist({ key: "a" })).toBeNull();
  });
});

describe("checklistSummary", () => {
  const kept = (statuses: CloseStep["status"][]): RecordedCloseStep[] => checklistRecord(statuses.map((s, i) => step(String(i), s)));
  it("counts what applied, then what was outstanding and what could not run", () => {
    expect(checklistSummary(kept(["complete", "complete", "outstanding", "not-applicable"]))).toBe("2 of 3 complete, 1 outstanding");
    expect(checklistSummary(kept(["complete", "unavailable"]))).toBe("1 of 1 complete, 1 check could not run");
    expect(checklistSummary(kept(["not-applicable"]))).toBe("Nothing to check");
  });
});

describe("the Month-End Close Log with checklists", () => {
  const periods: ClosePeriod[] = [{ id: "p1", label: "September 2026", periodStart: "2026-09-01", status: "closed" }];
  const checklist = checklistRecord([step("a", "complete"), step("b", "outstanding")]);
  const report = closeLog(periods, [
    { periodId: "p1", event: "close", reason: "Done", actorName: "Example Accountant", createdAt: "2026-10-03T10:00:00Z" },
    { periodId: "p1", event: "reopen", reason: "Late bill", actorName: "Example Admin", createdAt: "2026-10-04T10:00:00Z" },
    { periodId: "p1", event: "close", reason: "Done again", actorName: "Example Accountant", createdAt: "2026-10-05T10:00:00Z", checklist },
  ]);

  it("carries each close's checklist, says when one kept none, and says nothing on a reopen", () => {
    expect(report.lines.map(checklistCell)).toEqual([NO_CHECKLIST_KEPT, null, "1 of 2 complete, 1 outstanding"]);
    expect(report.lines[2].checklist).toEqual(checklist);
  });

  it("exports the same words", () => {
    const sheet = closeLogSheet(report, { companyName: "Example Co", fiscalYear: 2026, currencyCode: "USD", timeZone: "America/Los_Angeles" });
    expect(sheet.columns.map((c) => c.header)).toContain("Checklist at close");
    expect(sheet.rows.map((r) => r.checklist)).toEqual([NO_CHECKLIST_KEPT, "", "1 of 2 complete, 1 outstanding"]);
  });

  it("no longer says the books keep no checklist", () => {
    const client = readFileSync(join(process.cwd(), "app/(app)/reports/close-log/CloseLogClient.tsx"), "utf8");
    expect(client).not.toContain("does not show a count of them");
    expect(client).toContain("expandedRowRender");
  });
});
