import { describe, expect, it } from "vitest";
import { relatedCompanyInputSchema, relatedCompanyPreviewSchema } from "@/lib/domain/schemas";
import { relatedDuplicateMessage, relatedPreviewFrom } from "@/lib/services/related-companies";

const waiting = (date: string, description: string, amountMinor: number, inBaseCurrency = true) => ({
  date,
  description,
  amountMinor,
  inBaseCurrency,
});

describe("relatedPreviewFrom", () => {
  it("counts the waiting lines the words name, in or out, on base-currency banks", () => {
    const preview = relatedPreviewFrom({ matchWords: "example affiliate, exa" }, [
      waiting("2026-09-02", "WIRE TO EXAMPLE AFFILIATE", -1_500_000),
      waiting("2026-09-05", "WIRE FROM EXA", 700_000),
      waiting("2026-09-06", "WIRE FROM EXA", 700_000, false),
      waiting("2026-09-07", "EXAMPLE SUPPLY", -10_000),
      waiting("2026-09-08", "EXA ZERO", 0),
    ]);
    expect(preview).toEqual({
      waiting: 2,
      lines: [
        { date: "2026-09-05", description: "WIRE FROM EXA", amountMinor: 700_000 },
        { date: "2026-09-02", description: "WIRE TO EXAMPLE AFFILIATE", amountMinor: -1_500_000 },
      ],
    });
  });
  it("lists at most the newest ten", () => {
    const many = Array.from({ length: 12 }, (_, i) => waiting(`2026-09-${String(i + 1).padStart(2, "0")}`, "WIRE TO EXA", -100));
    const preview = relatedPreviewFrom({ matchWords: "exa" }, many);
    expect(preview.waiting).toBe(12);
    expect(preview.lines).toHaveLength(10);
    expect(preview.lines[0].date).toBe("2026-09-12");
  });
});

describe("relatedDuplicateMessage", () => {
  it("says which of the two unique rules a save broke", () => {
    expect(relatedDuplicateMessage('duplicate key value violates unique constraint "acc_related_company_account_id_key"')).toBe(
      "This account already belongs to a related company",
    );
    expect(relatedDuplicateMessage('duplicate key value violates unique constraint "acc_related_company_name_key"')).toBe(
      "A related company of this name is already here",
    );
  });
});

describe("related company schemas", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("take a company with a name, an account, words and a switch", () => {
    const parsed = relatedCompanyInputSchema.safeParse({ name: "  Example Affiliate, LLC ", accountId: id, matchWords: "exa", isActive: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe("Example Affiliate, LLC");
  });
  it("refuse a blank or long name, a missing account and long words", () => {
    const ok = { name: "Example Affiliate", accountId: id, matchWords: "exa", isActive: true };
    expect(relatedCompanyInputSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, name: "x".repeat(121) }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, accountId: "" }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, matchWords: "x".repeat(201) }).success).toBe(false);
    expect(relatedCompanyPreviewSchema.safeParse({ matchWords: "x".repeat(201) }).success).toBe(false);
  });
});
