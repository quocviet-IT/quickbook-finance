import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  hasPermission: vi.fn(),
  getStatementAlerts: vi.fn(),
  getBalanceEntryBlockers: vi.fn(),
  removeBalanceEntries: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite, isAdmin: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/access")>()),
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/lib/services/statement-alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/statement-alerts")>()),
  getStatementAlerts: mocks.getStatementAlerts,
  getBalanceEntryBlockers: mocks.getBalanceEntryBlockers,
  removeBalanceEntries: mocks.removeBalanceEntries,
}));

import { removeBalanceGroupAction, statementAlertsAction } from "@/app/(app)/banking/reconcile/actions";
import type { GhostGroup, NegativeWatch } from "@/lib/domain/statement-alerts";

const bank = "11111111-1111-4111-8111-111111111111";
const client = { marker: "company-bound" };

const group = (payee: string, entryIds: string[]): GhostGroup => ({
  payee,
  rows: [],
  agree: entryIds.length,
  of: entryIds.length,
  offsetMinor: 0,
  runs: 1,
  totalMinor: -50_000,
  entryIds,
});

const negative: NegativeWatch = { nowMinor: -100, last: null, worst: null, outstanding: [], outstandingCount: 0 };

const REVALIDATED = ["/banking/reconcile", "/banking", "/journal", "/reports", "/reports/exceptions", "/dashboard"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserRole.mockResolvedValue("admin");
  mocks.canWrite.mockReturnValue(true);
  mocks.createClient.mockResolvedValue(client);
  mocks.hasPermission.mockResolvedValue(true);
  mocks.getStatementAlerts.mockResolvedValue({ ghosts: [group("Payroll", ["e1", "e2", "e3"])], negative });
  mocks.getBalanceEntryBlockers.mockResolvedValue([]);
  mocks.removeBalanceEntries.mockResolvedValue({ removed: 3, reversed: 2, voided: 1, total_minor: -50_000 });
});

describe("statementAlertsAction", () => {
  it("returns the alerts with each group's blockers", async () => {
    mocks.getBalanceEntryBlockers.mockResolvedValue([{ entryId: "e2", entryNumber: "JE-000002", reason: "In a closed period" }]);
    const result = await statementAlertsAction(bank);
    expect(result.ok).toBe(true);
    expect(result.data?.negative).toEqual(negative);
    expect(result.data?.ghosts).toHaveLength(1);
    expect(result.data?.ghosts[0].payee).toBe("Payroll");
    expect(result.data?.ghosts[0].blockers).toEqual([{ entryId: "e2", entryNumber: "JE-000002", reason: "In a closed period" }]);
    expect(mocks.getStatementAlerts).toHaveBeenCalledWith(client, bank);
    expect(mocks.getBalanceEntryBlockers).toHaveBeenCalledWith(client, ["e1", "e2", "e3"]);
  });

  it("is open to a viewer, who is given no blockers and none are asked for", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    mocks.canWrite.mockReturnValue(false);
    const result = await statementAlertsAction(bank);
    expect(result.ok).toBe(true);
    expect(result.data?.ghosts[0].blockers).toEqual([]);
    expect(mocks.getBalanceEntryBlockers).not.toHaveBeenCalled();
  });

  it("refuses someone who is not signed in", async () => {
    mocks.getUserRole.mockResolvedValue(null);
    await expect(statementAlertsAction(bank)).resolves.toEqual({ ok: false, error: "Not authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not ask for blockers when nothing is flagged", async () => {
    mocks.getStatementAlerts.mockResolvedValue({ ghosts: [], negative: null });
    const result = await statementAlertsAction(bank);
    expect(result).toEqual({ ok: true, data: { ghosts: [], negative: null } });
    expect(mocks.getBalanceEntryBlockers).not.toHaveBeenCalled();
  });

  it("says what went wrong when a read fails", async () => {
    mocks.getStatementAlerts.mockRejectedValue(new Error("Reading the bank account's entries failed: down"));
    await expect(statementAlertsAction(bank)).resolves.toEqual({
      ok: false,
      error: "Reading the bank account's entries failed: down",
    });
  });
});

describe("removeBalanceGroupAction", () => {
  const input = { bankAccountId: bank, payee: "Payroll", reason: "  Balance column read as amounts  " };

  it("refuses someone who cannot write, before creating a client", async () => {
    mocks.canWrite.mockReturnValue(false);
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses someone without the journal-posting permission", async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const result = await removeBalanceGroupAction(input);
    expect(result).toEqual({ ok: false, error: "Removing entries needs the Post manual journals permission." });
    expect(mocks.hasPermission).toHaveBeenCalledWith(client, "journal.post");
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
  });

  it("rejects input without a reason, a payee or a real account", async () => {
    for (const bad of [
      { ...input, reason: "   " },
      { ...input, payee: "" },
      { ...input, bankAccountId: "not-an-id" },
      null,
    ]) {
      const result = await removeBalanceGroupAction(bad);
      expect(result.ok).toBe(false);
    }
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
  });

  it("finds the group again and removes its entries, then refreshes every screen that shows them", async () => {
    const result = await removeBalanceGroupAction(input);
    expect(result).toEqual({ ok: true, data: { removed: 3, reversed: 2, voided: 1, total_minor: -50_000 } });
    expect(mocks.getStatementAlerts).toHaveBeenCalledWith(client, bank);
    expect(mocks.removeBalanceEntries).toHaveBeenCalledWith(client, bank, ["e1", "e2", "e3"], "Balance column read as amounts");
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);
  });

  it("matches the payee without regard to case or spaces", async () => {
    const result = await removeBalanceGroupAction({ ...input, payee: "  payroll " });
    expect(result.ok).toBe(true);
  });

  it("removes only the entries of the group that was asked for", async () => {
    mocks.getStatementAlerts.mockResolvedValue({
      ghosts: [group("Interest", ["i1", "i2", "i3"]), group("Payroll", ["e1", "e2", "e3"])],
      negative: null,
    });
    await removeBalanceGroupAction(input);
    expect(mocks.removeBalanceEntries.mock.calls[0][2]).toEqual(["e1", "e2", "e3"]);
  });

  it("says the entries are gone when the payee is no longer flagged, and removes nothing", async () => {
    mocks.getStatementAlerts.mockResolvedValue({ ghosts: [group("Interest", ["i1", "i2", "i3"])], negative: null });
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({ ok: false, error: "Those entries are no longer here." });
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes a refusal through as it is, and refreshes nothing", async () => {
    const message = "1 of these entries cannot be removed: JE-000007 (invoice INV-0003, void it there)";
    mocks.removeBalanceEntries.mockRejectedValue(new Error(message));
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({ ok: false, error: message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
