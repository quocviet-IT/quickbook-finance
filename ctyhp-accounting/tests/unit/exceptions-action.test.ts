import { beforeEach, describe, expect, it, vi } from "vitest";

const getExceptionReport = vi.fn();

vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/services/report-context", () => ({
  companyClock: async () => ({ today: "2026-10-15", timeZone: "America/Los_Angeles" }),
}));
vi.mock("@/lib/services/exceptions", () => ({
  ExceptionsError: class extends Error {},
  getExceptionReport: (...a: unknown[]) => getExceptionReport(...a),
}));

const { exceptionReportAction } = await import("@/app/(app)/reports/exceptions/actions");

describe("the Exceptions action", () => {
  beforeEach(() => getExceptionReport.mockReset());

  it("runs the report with the company's today, not the server's clock", async () => {
    getExceptionReport.mockResolvedValue({ checksRun: 12 });
    const result = await exceptionReportAction("2026-01-01", "2026-10-15");
    expect(result.ok).toBe(true);
    expect(getExceptionReport.mock.calls[0].slice(1)).toEqual(["2026-01-01", "2026-10-15", "2026-10-15"]);
  });
});
