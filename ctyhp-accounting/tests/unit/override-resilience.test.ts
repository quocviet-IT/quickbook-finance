import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  OVERRIDE_ELASTIC_FLOOR,
  OVERRIDE_FIXED_WIDTHS,
} from "@/app/(app)/reports/exceptions/override-columns";
import { DEFAULT_TIME_ZONE } from "@/lib/domain/default-time-zone";

const listStatementOverrides = vi.fn();
const getCurrentCompanySettings = vi.fn();
const listReconciliations = vi.fn();
const listCurrencies = vi.fn();

vi.mock("@/lib/services/statement-overrides", () => ({ listStatementOverrides: () => listStatementOverrides() }));
vi.mock("@/lib/services/company", () => ({ getCurrentCompanySettings: () => getCurrentCompanySettings() }));
vi.mock("@/lib/services/reference", () => ({ listCurrencies: () => listCurrencies() }));
vi.mock("@/lib/services/bankrec", () => ({ listReconciliations: (...a: unknown[]) => listReconciliations(...a) }));

const { readReconciliationOverrides } = await import("@/lib/services/override-notices");
const { listBankStatementImports } = await import("@/lib/services/banking");

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the Exceptions overrides table", () => {
  it("fits the 1280 box", () => {
    const fixed = OVERRIDE_FIXED_WIDTHS.reduce((sum, w) => sum + w, 0);
    expect(fitsBox(fixed, OVERRIDE_ELASTIC_FLOOR)).toBe(true);
    expect(TABLE_BOX_AT_1280).toBe(984);
  });

  it("gives each text column a floor and the amount the wide money column", () => {
    const source = read("app/(app)/reports/exceptions/ExceptionsClient.tsx");
    for (const floor of ["ACCOUNT", "FILE", "BY", "REASON"]) expect(source).toContain(`floor: OVERRIDE_${floor}_FLOOR`);
    expect(source).toMatch(/key: "outBy",\s*width: COLUMN\.MONEY_WIDE/);
  });
});

describe("a reconciliation whose overrides cannot be read", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getCurrentCompanySettings.mockResolvedValue({ time_zone: "America/Los_Angeles" });
  });

  it("answers unavailable instead of throwing", async () => {
    listStatementOverrides.mockRejectedValue(new Error("boom"));
    const out = await readReconciliationOverrides(
      {} as SupabaseClient,
      "r1",
      { bankAccountId: "a", endingDate: "2026-09-30", status: "draft" },
      money,
    );
    expect(out).toEqual({ notices: [], settles: [], unavailable: true });
  });

  it("says it could read them otherwise", async () => {
    listStatementOverrides.mockResolvedValue([]);
    const out = await readReconciliationOverrides(
      {} as SupabaseClient,
      "r1",
      { bankAccountId: "a", endingDate: "2026-09-30", status: "completed" },
      money,
    );
    expect(out.unavailable).toBe(false);
  });

  it("is warned about on both pages, and the report reads only when completed", () => {
    const page = read("app/(app)/banking/reconcile/[id]/page.tsx");
    const report = read("app/(app)/banking/reconcile/[id]/report/page.tsx");
    const client = read("app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx");
    expect(page).toContain("readReconciliationOverrides");
    expect(page).not.toMatch(/await readReconciliationOverrides/);
    expect(report).toContain('header.status === "completed"');
    expect(client).toContain("Could not check this period for statements imported out of balance.");
    expect(report).toContain("Could not check this period for statements imported out of balance.");
    expect(client).toContain("key={notice.batchId}");
  });
});

describe("the import history when the overrides cannot be read", () => {
  const sb = { rpc: async () => ({ data: [{ id: "b1", filename: "example.csv" }], error: null }) } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getCurrentCompanySettings.mockResolvedValue({ time_zone: "America/Los_Angeles" });
    listCurrencies.mockResolvedValue([{ code: "USD", decimal_places: 2, is_base: true }]);
  });

  it("keeps the list and flags every row", async () => {
    listStatementOverrides.mockRejectedValue(new Error("boom"));
    const rows = await listBankStatementImports(sb, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "b1", override_detail: null, overrides_unavailable: true });
  });

  it("keeps the list when only the settings or the currencies fail", async () => {
    listStatementOverrides.mockResolvedValue([]);
    getCurrentCompanySettings.mockRejectedValue(new Error("boom"));
    expect((await listBankStatementImports(sb, null))[0].overrides_unavailable).toBe(true);
  });

  it("does not flag a clean read, and the list warns when it is flagged", async () => {
    listStatementOverrides.mockResolvedValue([]);
    expect((await listBankStatementImports(sb, null))[0].overrides_unavailable).toBe(false);
    expect(read("app/(app)/banking/BankImportList.tsx")).toContain(
      "Could not check which of these imports were out of balance.",
    );
  });
});

describe("one default time zone", () => {
  it("is the settings schema default, and no 2.11 fallback names another", () => {
    expect(read("lib/domain/schemas.ts")).toContain(`time_zone: z.string().trim().min(1).max(60).default("${DEFAULT_TIME_ZONE}")`);
    for (const file of [
      "lib/services/override-notices.ts",
      "lib/services/banking.ts",
      "lib/services/exceptions.ts",
      "lib/domain/exceptions.ts",
      "lib/services/report-context.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/time_zone \|\| "|timeZone \?\? "/);
    }
  });
});
