import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    // Measured on the nightly runs (2.89): up to 75 seconds for the largest
    // company. The last snapshot started inside the budget has the rest of the
    // ceiling to finish, with half again for growth.
    expect(BACKUP_TIME_BUDGET_MS).toBeLessThanOrEqual(300_000 - 1.5 * 75_000);
  });

  it("leaves out a company already backed up today, so a later run covers only the rest (2.89)", () => {
    const due = companiesDueForBackup(
      [company("done", "2026-10-29"), company("left", "2026-10-28"), company("new", null)],
      "2026-10-29",
    );
    expect(due.map((c) => c.slug)).toEqual(["new", "left"]);
  });
});

describe("the night's runs (2.89)", () => {
  const crons = (JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons.filter(
    (cron) => cron.path.startsWith("/api/backups/run"),
  );

  it("are three, each once a day, ten minutes apart within one UTC hour, each with a path of its own", () => {
    expect(crons.map((c) => c.schedule)).toEqual(["0 12 * * *", "10 12 * * *", "20 12 * * *"]);
    expect(new Set(crons.map((c) => c.path)).size).toBe(3);
  });

  it("have room for every company: three budgets well past seven companies at their measured times", () => {
    const measuredSeconds = [40, 40, 75, 35, 38, 62, 38];
    const needed = measuredSeconds.reduce((sum, s) => sum + s, 0) * 1000;
    expect(crons.length * BACKUP_TIME_BUDGET_MS).toBeGreaterThan(1.5 * needed);
  });
});
