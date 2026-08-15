import { describe, expect, it, vi } from "vitest";

// backup-queue.ts (correctly) imports "server-only", matching every other
// service file in lib/services/ — the package isn't in node_modules, so this
// test stubs it the same way automation-jobs.test.ts and company-queue.test.ts
// already do for their own server-only imports.
vi.mock("server-only", () => ({}));

import { companiesDueForBackup, BACKUP_BATCH_LIMIT } from "@/lib/services/backup-queue";

const company = (slug: string, lastBackup: string | null) => ({ slug, lastBackup });

describe("choosing which companies tonight covers", () => {
  it("takes the ones waiting longest first", () => {
    // 18.6 seconds for the largest company today. A run that sweeps every
    // company stops fitting as they grow, so each run takes a batch and the
    // rest wait — the shape the provisioning queue already uses.
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

  it("stops at the batch limit even with more waiting", () => {
    const many = Array.from({ length: 10 }, (_, i) => company(`c${i}`, `2026-08-0${i % 9}`));
    expect(companiesDueForBackup(many)).toHaveLength(BACKUP_BATCH_LIMIT);
  });
});
