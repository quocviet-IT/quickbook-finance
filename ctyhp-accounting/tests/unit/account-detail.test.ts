import { describe, expect, it } from "vitest";
import {
  CURRENT_ASSET_DETAIL_TYPES,
  detailLabel,
  detailTypeOptions,
  isBankSectionDetail,
} from "@/lib/domain/account-detail";
import { accountCreateSchema, accountUpdateSchema } from "@/lib/domain/schemas";

describe("detail types", () => {
  it("offers bank kinds for a bank, the two money-in-transit kinds for a current asset, and nothing else", () => {
    expect(detailTypeOptions("bank").map((o) => o.value)).toEqual(["checking", "savings", "money_market", "cash_on_hand", "other_bank"]);
    expect(detailTypeOptions("current_asset").map((o) => o.value)).toEqual([...CURRENT_ASSET_DETAIL_TYPES]);
    expect(detailTypeOptions("expense")).toEqual([]);
  });

  it("puts undeposited funds and transfer clearing with the bank accounts", () => {
    expect(isBankSectionDetail("undeposited_funds")).toBe(true);
    expect(isBankSectionDetail("transfer_clearing")).toBe(true);
    expect(isBankSectionDetail("checking")).toBe(false);
    expect(isBankSectionDetail(null)).toBe(false);
  });

  it("reads a detail type under an account's name", () => {
    expect(detailLabel("bank", "savings")).toBe("Savings account");
    expect(detailLabel("current_asset", "undeposited_funds")).toBe("Undeposited funds");
    expect(detailLabel("fixed_asset", "Contra fixed asset")).toBe("Contra fixed asset");
    expect(detailLabel("expense", null)).toBeNull();
  });

  it("says what the two Uncategorized holding accounts are for", () => {
    expect(detailLabel("income", "uncategorized_income")).toBe("Holding account — money in not yet coded");
    expect(detailLabel("expense", "uncategorized_expense")).toBe("Holding account — money out not yet coded");
  });
});

describe("the contra flag on an account", () => {
  const base = { account_code: "3300", name: "Owner's Draw", account_type: "equity" as const };

  it("defaults to false when an account is created", () => {
    expect(accountCreateSchema.parse(base).is_contra).toBe(false);
    expect(accountCreateSchema.parse({ ...base, is_contra: true }).is_contra).toBe(true);
  });

  it("is left alone by an update that does not mention it", () => {
    expect("is_contra" in accountUpdateSchema.parse({ name: "Owner's Draw" })).toBe(false);
    expect(accountUpdateSchema.parse({ is_contra: true }).is_contra).toBe(true);
  });
});
