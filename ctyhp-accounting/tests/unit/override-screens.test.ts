import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NamedStatementOverride } from "@/lib/domain/statement-overrides";
import { overridesForReconciliation, overridesSettledBy } from "@/lib/domain/statement-overrides";

const listStatementOverrides = vi.fn();
const getCurrentCompanySettings = vi.fn();
const listReconciliations = vi.fn();
const listCurrencies = vi.fn();

vi.mock("@/lib/services/statement-overrides", () => ({ listStatementOverrides: () => listStatementOverrides() }));
vi.mock("@/lib/services/company", () => ({ getCurrentCompanySettings: () => getCurrentCompanySettings() }));
vi.mock("@/lib/services/reference", () => ({ listCurrencies: () => listCurrencies() }));
vi.mock("@/lib/services/bankrec", () => ({ listReconciliations: (...a: unknown[]) => listReconciliations(...a) }));

const { reconciliationOverrideSentences } = await import("@/lib/services/override-notices");
const { listBankStatementImports } = await import("@/lib/services/banking");

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

const override = (over: Partial<NamedStatementOverride> = {}): NamedStatementOverride => ({
  batchId: "b1",
  bankAccountId: "acct-1",
  filename: "example.csv",
  importedAt: "2026-09-09T23:30:00Z",
  overriddenBy: "u1",
  overriddenByName: "Dana Example",
  reason: "Bank typo",
  outByMinor: 1250,
  openingMinor: 0,
  closingMinor: 0,
  firstLineDate: "2026-09-01",
  lastLineDate: "2026-09-30",
  settledByReconciliationId: null,
  settledThrough: null,
  ...over,
});

describe("which overrides a reconciliation in progress shows", () => {
  const period = { bankAccountId: "acct-1", endingDate: "2026-09-30", previousEndingDate: "2026-08-31" };

  it("takes an open override of the account whose last line falls in the period", () => {
    expect(overridesForReconciliation([override()], period)).toHaveLength(1);
  });

  it("includes a last line on the statement end and excludes one on the previous end", () => {
    expect(overridesForReconciliation([override({ lastLineDate: "2026-09-30" })], period)).toHaveLength(1);
    expect(overridesForReconciliation([override({ lastLineDate: "2026-08-31" })], period)).toHaveLength(0);
    expect(overridesForReconciliation([override({ lastLineDate: "2026-10-01" })], period)).toHaveLength(0);
  });

  it("has no lower bound when no reconciliation was completed before", () => {
    const first = { ...period, previousEndingDate: null };
    expect(overridesForReconciliation([override({ lastLineDate: "2020-01-01" })], first)).toHaveLength(1);
  });

  it("leaves out another account, a settled override and a batch with no lines", () => {
    const rows = [
      override({ bankAccountId: "acct-2" }),
      override({ settledByReconciliationId: "r0", settledThrough: "2026-09-30" }),
      override({ lastLineDate: null }),
    ];
    expect(overridesForReconciliation(rows, period)).toEqual([]);
  });

  it("finds what a completed reconciliation settled by its id", () => {
    const rows = [
      override({ batchId: "a", settledByReconciliationId: "r1", settledThrough: "2026-09-30" }),
      override({ batchId: "b", settledByReconciliationId: "r2", settledThrough: "2026-10-31" }),
      override({ batchId: "c" }),
    ];
    expect(overridesSettledBy(rows, "r1").map((o) => o.batchId)).toEqual(["a"]);
  });
});

describe("the sentences of a reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCurrentCompanySettings.mockResolvedValue({ time_zone: "America/Los_Angeles" });
    listReconciliations.mockResolvedValue([
      { status: "completed", statement_ending_date: "2026-08-31" },
      { status: "draft", statement_ending_date: "2026-09-15" },
    ]);
  });

  it("says, in progress, that completing it settles the override, with the date in the company's zone", async () => {
    listStatementOverrides.mockResolvedValue([override(), override({ batchId: "x", lastLineDate: "2026-08-15" })]);
    const out = await reconciliationOverrideSentences(
      {} as SupabaseClient,
      "r1",
      { bankAccountId: "acct-1", endingDate: "2026-09-30", status: "draft" },
      money,
    );
    expect(out.settles).toEqual([]);
    expect(out.notices).toEqual([
      "A statement in this period was imported out of balance: out by $12.50, by Dana Example on Sep 9, 2026, “Bank typo”. Completing this reconciliation settles it.",
    ]);
  });

  it("says, completed, what it settled, and shows no notice", async () => {
    listStatementOverrides.mockResolvedValue([
      override({ settledByReconciliationId: "r1", settledThrough: "2026-09-30" }),
      override({ batchId: "other" }),
    ]);
    const out = await reconciliationOverrideSentences(
      {} as SupabaseClient,
      "r1",
      { bankAccountId: "acct-1", endingDate: "2026-09-30", status: "completed" },
      money,
    );
    expect(out.notices).toEqual([]);
    expect(out.settles).toEqual([
      "Settles a statement imported out of balance: out by $12.50, by Dana Example on Sep 9, 2026, “Bank typo”.",
    ]);
  });

  it("says nothing when the account has no override", async () => {
    listStatementOverrides.mockResolvedValue([]);
    const out = await reconciliationOverrideSentences(
      {} as SupabaseClient,
      "r1",
      { bankAccountId: "acct-1", endingDate: "2026-09-30", status: "draft" },
      money,
    );
    expect(out).toEqual({ notices: [], settles: [] });
  });
});

describe("the import history", () => {
  const imports = [
    { id: "b1", filename: "example.csv" },
    { id: "b2", filename: "clean.csv" },
  ];
  const sb = { rpc: async () => ({ data: imports, error: null }) } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.resetAllMocks();
    getCurrentCompanySettings.mockResolvedValue({ time_zone: "America/Los_Angeles" });
    listCurrencies.mockResolvedValue([{ code: "USD", decimal_places: 2, is_base: true }]);
  });

  it("joins an override by batch id and leaves a clean import without one", async () => {
    listStatementOverrides.mockResolvedValue([override()]);
    const rows = await listBankStatementImports(sb, null);
    expect(rows[0].override_detail).toBe(
      "Out by $12.50. Imported by Dana Example on Sep 9, 2026 at 16:30: “Bank typo”. Open until a reconciliation through Sep 30, 2026 is completed.",
    );
    expect(rows[1].override_detail).toBeNull();
  });

  it("says the override is settled once a reconciliation reached it", async () => {
    listStatementOverrides.mockResolvedValue([override({ settledByReconciliationId: "r1", settledThrough: "2026-09-30" })]);
    const rows = await listBankStatementImports(sb, null);
    expect(rows[0].override_detail).toMatch(/Settled by the reconciliation to Sep 30, 2026\.$/);
  });

  it("is drawn with the tag and the sentence under the file name, only when there is one", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/banking/BankImportList.tsx"), "utf8");
    expect(source).toContain("Imported out of balance");
    expect(source).toContain("row.override_detail === null");
    expect(source).toContain("{row.override_detail}");
  });
});

describe("the screens", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("shows the notices above the lines, only while the reconciliation is not completed", () => {
    const source = read("app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx");
    expect(source).toMatch(/!completed\s*\?\s*overrideNotices\.map/);
  });

  it("puts the settled sentence on the report", () => {
    const source = read("app/(app)/banking/reconcile/[id]/report/page.tsx");
    expect(source).toContain("settles.map");
  });

  it("draws the twelfth Exceptions section from the report's open overrides", () => {
    const source = read("app/(app)/reports/exceptions/ExceptionsClient.tsx");
    expect(source).toContain("title={CHECK_LABEL.statementOverride}");
    expect(source).toContain("dataSource={r.statementOverride}");
    expect(source).not.toMatch(/eleven/i);
  });
});
