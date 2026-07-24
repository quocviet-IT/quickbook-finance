import { describe, it, expect } from "vitest";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("reconciliation schemas", () => {
  it("create requires bank account, date, ending balance (int)", () => {
    expect(reconciliationCreateSchema.safeParse({ bank_account_id: uuid, statement_ending_date: "2026-07-31", statement_ending_balance_minor: 100 }).success).toBe(true);
    expect(reconciliationCreateSchema.safeParse({ bank_account_id: uuid, statement_ending_date: "2026-07-31", statement_ending_balance_minor: 1.5 }).success).toBe(false);
  });
  it("adjustment requires offset account + non-empty reason", () => {
    expect(reconciliationAdjustmentSchema.safeParse({ offset_account_id: uuid, reason: "bank fee" }).success).toBe(true);
    expect(reconciliationAdjustmentSchema.safeParse({ offset_account_id: uuid, reason: "" }).success).toBe(false);
  });
  it("reopen requires a non-empty reason", () => {
    expect(reconciliationReopenSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(reconciliationReopenSchema.safeParse({ reason: "error found" }).success).toBe(true);
  });
});
