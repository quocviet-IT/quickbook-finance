import { describe, expect, it } from "vitest";
import {
  BANK_SETUP_DETAIL_TYPES,
  bankDetailLabel,
  holdsBankStatement,
  selectableBankLedgerAccounts,
  suggestBankLedgerAccount,
  suggestNewLedgerAccount,
  BANK_SETUP_KINDS,
  bankKindLabel,
  type LedgerAccountLike,
} from "@/lib/domain/bank-account-detail";

const account = (over: Partial<LedgerAccountLike> & { id: string; account_code: string }): LedgerAccountLike => ({
  name: "Account",
  account_type: "bank",
  detail_type: null,
  is_posting_account: true,
  status: "active",
  ...over,
});

const CASH = account({
  id: "cash",
  account_code: "1000",
  name: "Cash on Hand",
  detail_type: "cash_on_hand",
});
const CHECKING = account({
  id: "chk",
  account_code: "1010",
  name: "Operating Bank Account",
  detail_type: "checking",
});
const SAVINGS = account({
  id: "sav",
  account_code: "1020",
  name: "Reserve Savings",
  detail_type: "savings",
});
const UNCLASSIFIED = account({ id: "old", account_code: "1030", name: "Second Bank Account" });

describe("classification", () => {
  it("names each kind the way the chart reads", () => {
    expect(bankDetailLabel("checking")).toBe("Checking account");
    expect(bankDetailLabel("cash_on_hand")).toBe("Cash on hand");
    expect(bankDetailLabel(null)).toBe("Unclassified");
  });

  it("knows that cash on hand has no bank statement", () => {
    expect(holdsBankStatement("checking")).toBe(true);
    expect(holdsBankStatement("savings")).toBe(true);
    expect(holdsBankStatement(null)).toBe(true);
    expect(holdsBankStatement("cash_on_hand")).toBe(false);
  });

  it("does not offer cash on hand as a kind of bank account to set up", () => {
    expect(BANK_SETUP_DETAIL_TYPES).not.toContain("cash_on_hand");
    expect(BANK_SETUP_DETAIL_TYPES).toEqual([
      "checking",
      "savings",
      "money_market",
      "other_bank",
    ]);
  });
});

describe("selectableBankLedgerAccounts", () => {
  it("never offers the cash tin — the defect that started this", () => {
    const usable = selectableBankLedgerAccounts([CASH, CHECKING, SAVINGS]);
    expect(usable.map((a) => a.account_code)).toEqual(["1010", "1020"]);
  });

  it("keeps an unclassified account available, so an older chart still works", () => {
    const usable = selectableBankLedgerAccounts([CASH, UNCLASSIFIED]);
    expect(usable.map((a) => a.account_code)).toEqual(["1030"]);
  });

  it("narrows to the chosen kind, plus anything unclassified", () => {
    const usable = selectableBankLedgerAccounts([CHECKING, SAVINGS, UNCLASSIFIED], {
      detail: "savings",
    });
    expect(usable.map((a) => a.account_code)).toEqual(["1020", "1030"]);
  });

  it("leaves out an inactive or non-posting account", () => {
    const closed = account({ id: "x", account_code: "1040", detail_type: "checking", status: "inactive" });
    const header = account({ id: "y", account_code: "1050", detail_type: "checking", is_posting_account: false });
    expect(selectableBankLedgerAccounts([closed, header, CHECKING])).toHaveLength(1);
  });

  it("leaves out an account that is not Bank-type at all", () => {
    const receivable = account({ id: "ar", account_code: "1100", account_type: "accounts_receivable" });
    expect(selectableBankLedgerAccounts([receivable])).toEqual([]);
  });
});

describe("suggestBankLedgerAccount", () => {
  it("offers the one account that matches the kind chosen", () => {
    expect(suggestBankLedgerAccount([CASH, CHECKING, SAVINGS], "savings")?.id).toBe("sav");
  });

  it("suggests nothing when two accounts could be meant", () => {
    const second = account({ id: "chk2", account_code: "1011", detail_type: "checking" });
    expect(suggestBankLedgerAccount([CHECKING, second], "checking")).toBeNull();
  });

  it("suggests nothing when the chart has no such account yet", () => {
    expect(suggestBankLedgerAccount([CASH, CHECKING], "money_market")).toBeNull();
  });

  it("never suggests cash on hand, even when asked for it", () => {
    expect(suggestBankLedgerAccount([CASH], "cash_on_hand")).toBeNull();
  });
});

describe("suggestNewLedgerAccount", () => {
  it("takes the first free code in the cash block and names it after the bank", () => {
    expect(suggestNewLedgerAccount([CASH, CHECKING], "savings", "First National Bank")).toEqual({
      account_code: "1020",
      name: "First National Bank savings account",
      account_type: "bank",
      detail_type: "savings",
    });
  });

  it("falls back to the plain name when no bank is given", () => {
    expect(suggestNewLedgerAccount([CASH, CHECKING, SAVINGS], "money_market", "  ")).toEqual({
      account_code: "1030",
      name: "Money market account",
      account_type: "bank",
      detail_type: "money_market",
    });
  });
});

/** 2.45: a credit card's statement is imported and reconciled under Banking too. */
describe("a credit card as a kind of bank account", () => {
  const CARD = account({ id: "card", account_code: "2010", name: "Example Credit Card", account_type: "credit_card" });
  const CARD_2 = account({ id: "card2", account_code: "2020", name: "Second Card", account_type: "credit_card" });

  it("is offered after the bank kinds, by its own name", () => {
    expect(BANK_SETUP_KINDS).toEqual([...BANK_SETUP_DETAIL_TYPES, "credit_card"]);
    expect(bankKindLabel("credit_card")).toBe("Credit card");
    expect(bankKindLabel("checking")).toBe("Checking account");
  });

  it("lists credit card accounts for a card, and only bank accounts for a bank kind", () => {
    const all = [CASH, CHECKING, UNCLASSIFIED, CARD];
    expect(selectableBankLedgerAccounts(all, { detail: "credit_card" }).map((a) => a.id)).toEqual(["card"]);
    expect(selectableBankLedgerAccounts(all, { detail: "checking" }).map((a) => a.id)).toEqual(["chk", "old"]);
    expect(selectableBankLedgerAccounts(all).map((a) => a.id)).toEqual(["chk", "old", "card"]);
  });

  it("leaves out an inactive or non-posting card", () => {
    const closed = account({ id: "c3", account_code: "2030", account_type: "credit_card", status: "inactive" });
    const header = account({ id: "c4", account_code: "2040", account_type: "credit_card", is_posting_account: false });
    expect(selectableBankLedgerAccounts([closed, header], { detail: "credit_card" })).toEqual([]);
  });

  it("suggests the only card, and nothing when there are two; a bank kind never suggests a card", () => {
    expect(suggestBankLedgerAccount([CHECKING, CARD], "credit_card")?.id).toBe("card");
    expect(suggestBankLedgerAccount([CARD, CARD_2], "credit_card")).toBeNull();
    expect(suggestBankLedgerAccount([CARD], "checking")).toBeNull();
  });

  it("proposes a new card account in the 2000 block, with no bank detail", () => {
    expect(suggestNewLedgerAccount([CHECKING, CARD], "credit_card", "Chase")).toEqual({
      account_code: "2020",
      name: "Chase credit card",
      account_type: "credit_card",
      detail_type: null,
    });
    expect(suggestNewLedgerAccount([], "credit_card", null)).toMatchObject({ account_code: "2010", name: "Credit card" });
  });
});
