/**
 * Posting defaults (3.01): the accounts a new document starts on unless
 * somebody chooses another, kept once per company (acc_posting_default, 0187).
 *
 * They only fill a form. A document keeps whatever it was posted to, so
 * changing a default never rewrites a figure, and every form still shows the
 * account before anything is saved.
 *
 * Pure. The rules below are the ones each form already used to offer its
 * accounts, and the ones acc_save_posting_defaults checks; a default the form
 * would not offer is never filled in.
 */
import type { AccountRow } from "@/lib/db/types";

export interface PostingDefaults {
  /** Where money in lands: Receive payment, Sales receipt. */
  depositAccountId: string | null;
  /** Where money out comes from: Pay Bills, Expenses. */
  payFromAccountId: string | null;
  /** An invoice, estimate or sales receipt line with no item. */
  incomeAccountId: string | null;
  /** A bill or expense line, when the vendor has none of its own. */
  expenseAccountId: string | null;
}

export const NO_POSTING_DEFAULTS: PostingDefaults = {
  depositAccountId: null,
  payFromAccountId: null,
  incomeAccountId: null,
  expenseAccountId: null,
};

export type PostingDefaultKey = keyof PostingDefaults;

type ChoosableAccount = Pick<AccountRow, "account_type" | "account_code" | "detail_type" | "is_posting_account" | "status">;

const usable = (a: ChoosableAccount) => a.is_posting_account && a.status === "active";

/** Which accounts each default may be, as its forms offer them. */
export const POSTING_DEFAULT_RULES: Record<PostingDefaultKey, (account: ChoosableAccount) => boolean> = {
  depositAccountId: (a) =>
    usable(a) && (a.account_type === "bank" || a.detail_type === "undeposited_funds" || a.account_code === "1210"),
  payFromAccountId: (a) => usable(a) && (a.account_type === "bank" || a.account_type === "credit_card"),
  incomeAccountId: (a) => usable(a) && a.account_type === "income",
  expenseAccountId: (a) =>
    usable(a) &&
    (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense"),
};

/** What Settings › Company calls each default. */
export const POSTING_DEFAULT_LABELS: Record<PostingDefaultKey, { label: string; usedBy: string }> = {
  depositAccountId: { label: "Money in lands here", usedBy: "Receive payment and sales receipts" },
  payFromAccountId: { label: "Money out comes from", usedBy: "Pay Bills and expenses" },
  incomeAccountId: { label: "Default income account", usedBy: "Invoice, estimate and sales receipt lines with no item" },
  expenseAccountId: { label: "Default expense account", usedBy: "Bill and expense lines, when the vendor has none" },
};

/**
 * The default, while it is still one of the accounts the form offers. An
 * account made inactive since it was chosen is simply not filled in: the form
 * starts empty, as it did before there were defaults, rather than on an
 * account it would refuse.
 */
export function defaultIn(id: string | null | undefined, choices: readonly { id: string }[]): string | undefined {
  return id && choices.some((c) => c.id === id) ? id : undefined;
}

/** A bill or expense line's account: the vendor's own default expense account first, then the company's. */
export function lineExpenseDefault(
  vendorDefault: string | null | undefined,
  companyDefault: string | null | undefined,
  choices: readonly { id: string }[],
): string | undefined {
  return defaultIn(vendorDefault, choices) ?? defaultIn(companyDefault, choices);
}

/**
 * The lines with `field` moved to `next` wherever the form put the account
 * there itself: an empty line, or one still holding an account the form
 * filled in (`filled`, the defaults it has used). An account somebody chose,
 * or one an item or a purchase order brought, is left alone. With nothing to
 * move to, the lines come back as they were.
 */
export function refillLineAccounts<T extends object>(
  lines: readonly T[],
  field: keyof T,
  filled: readonly (string | null | undefined)[],
  next: string | undefined,
): T[] {
  if (!next) return [...lines];
  const replaceable = new Set(filled.filter((id): id is string => Boolean(id)));
  return lines.map((line) => {
    const current = line[field] as unknown as string | null | undefined;
    return !current || replaceable.has(current) ? { ...line, [field]: next } : line;
  });
}
