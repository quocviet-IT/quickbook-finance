import { describe, expect, it, vi } from "vitest";

// backup-queue.ts (correctly) imports "server-only", matching every other
// service file in lib/services/ — the package isn't in node_modules, so this
// test stubs it the same way automation-jobs.test.ts and company-queue.test.ts
// already do for their own server-only imports.
vi.mock("server-only", () => ({}));

import { companiesDueForBackup, BACKUP_TIME_BUDGET_MS } from "@/lib/services/backup-queue";

const company = (slug: string, lastBackup: string | null) => ({ slug, lastBackup });

describe("choosing which companies tonight covers", () => {
  it("takes the ones waiting longest first", () => {
    // The order matters on a night that runs out of time: whoever is left
    // over is the longest waiting tomorrow, so nobody is skipped twice.
    const due = companiesDueForBackup([
      company("a", "2026-08-14"),
      company("b", "2026-08-10"),
      company("c", "2026-08-12"),
    ]);
    expect(due.map((c) => c.slug)).toEqual(["b", "c", "a"]);
  });

  it("puts a company that has never been backed up at the front", () => {
    const due = companiesDueForBackup([company("a", "2026-08-14"), company("new", null)]);
    expect(due[0].slug).toBe("new");
  });

  it("keeps every company: the time budget, not a count, decides how many a night covers", () => {
    const many = Array.from({ length: 10 }, (_, i) => company(`c${i}`, `2026-08-0${i % 9}`));
    expect(companiesDueForBackup(many)).toHaveLength(10);
  });

  it("leaves a snapshot under way room to finish inside the route's 300 seconds", () => {
    // 18.6 seconds for the largest company when measured; the last snapshot
    // started inside the budget has the rest of the ceiling to finish.
    expect(BACKUP_TIME_BUDGET_MS).toBeLessThanOrEqual(300_000 - 5 * 18_600);
  });
});
