import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/backup-queue-runner", () => ({
  runDueCompanyBackups: vi.fn(async () => ({ failed: 0, incomplete: [] })),
}));
vi.mock("@/lib/services/automation-jobs", () => ({
  runRecurringAutomationJob: vi.fn(async () => ({ companies: [] })),
  runBankFeedAutomationJob: vi.fn(async () => ({ companies: [] })),
}));
vi.mock("@/lib/services/company-queue", () => ({
  runPendingCompanyProvisioning: vi.fn(async () => ({ processed: 0 })),
}));

import { POST as backups } from "@/app/api/backups/run/route";
import { GET as recurring } from "@/app/api/recurring/run/route";
import { GET as bankFeeds } from "@/app/api/bank-feeds/sync/route";
import { POST as provision } from "@/app/api/companies/provision/route";
import { bearerMatches } from "@/lib/domain/bearer-secret";
import { runDueCompanyBackups } from "@/lib/services/backup-queue-runner";
import { runBankFeedAutomationJob, runRecurringAutomationJob } from "@/lib/services/automation-jobs";
import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

const SECRET = "c".repeat(32);
// The same number of characters as SECRET, but 64 bytes: the case that used to throw.
const ACCENTED = "é".repeat(32);

describe("bearerMatches", () => {
  it("accepts only the exact secret", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
  });

  it("refuses a bearer with the right number of characters but not of bytes, without throwing", () => {
    expect(() => bearerMatches(`Bearer ${ACCENTED}`, SECRET)).not.toThrow();
    expect(bearerMatches(`Bearer ${ACCENTED}`, SECRET)).toBe(false);
  });

  it("never matches a secret shorter than 24 characters, or none", () => {
    expect(bearerMatches("Bearer short", "short")).toBe(false);
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });
});

const ROUTES = [
  { name: "backups/run", call: backups, job: runDueCompanyBackups },
  { name: "recurring/run", call: recurring, job: runRecurringAutomationJob },
  { name: "bank-feeds/sync", call: bankFeeds, job: runBankFeedAutomationJob },
  { name: "companies/provision", call: provision, job: runPendingCompanyProvisioning },
] as const;

const request = (bearer: string) =>
  new Request("https://onebook.test/api/cron", { method: "POST", headers: { authorization: `Bearer ${bearer}` } });

describe.each(ROUTES)("the $name cron route", ({ call, job }) => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.clearAllMocks();
  });

  it("answers 401, not 500, to a same-length non-ASCII bearer, and runs nothing", async () => {
    const res = await call(request(ACCENTED));
    expect(res.status).toBe(401);
    expect(job).not.toHaveBeenCalled();
  });

  it("still runs for the right secret", async () => {
    const res = await call(request(SECRET));
    expect(res.status).not.toBe(401);
    expect(job).toHaveBeenCalledTimes(1);
  });
});
