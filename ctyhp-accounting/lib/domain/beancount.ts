/**
 * The ledger as a Beancount v3 file.
 *
 * Pure: it receives data already read and returns text. It imports nothing
 * from `@/lib/db` or `@/lib/services`, and a test in `tests/unit/beancount.test.ts`
 * fails if that changes — the export must be incapable of writing to the books.
 *
 * Money arrives as integer minor units in each entry's own currency and is only
 * turned into decimal text here, by that currency's `decimal_places`.
 */

import type { AccountType } from "@/lib/domain/accounts";

export class BeancountError extends Error {}

export interface BeancountAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

/**
 * Where each account type sits in Beancount's five roots. Beancount only knows
 * Assets, Liabilities, Equity, Income and Expenses; the middle segment keeps
 * OneBook's finer types visible in Fava's tree.
 */
const ACCOUNT_PREFIX: Record<AccountType, string> = {
  bank: "Assets:Bank",
  accounts_receivable: "Assets:Receivable",
  current_asset: "Assets:Current",
  fixed_asset: "Assets:Fixed",
  accounts_payable: "Liabilities:Payable",
  credit_card: "Liabilities:CreditCard",
  current_liability: "Liabilities:Current",
  equity: "Equity",
  income: "Income",
  other_income: "Income:Other",
  cost_of_goods_sold: "Expenses:COGS",
  expense: "Expenses",
  other_expense: "Expenses:Other",
};

/**
 * One component of an account name, as Beancount accepts it: an upper-case
 * letter or a digit first, then letters, digits and hyphens.
 *
 * Accents are decomposed and dropped rather than deleted with their letter, so
 * a Vietnamese name keeps its words; `đ` has no decomposition and is mapped by
 * hand.
 */
export function sanitizeComponent(raw: string): string {
  const ascii = raw
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  let cleaned = ascii.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "") return "Account";
  if (/^[a-z]/.test(cleaned)) cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  return cleaned;
}

/**
 * A Beancount name for every account, keyed by account id.
 *
 * The code leads because OneBook's names are not unique and its codes are. Two
 * codes can still clean up to the same text — `1010` and `1010.` — and merging
 * those would silently add two accounts' balances together, so every member of
 * a colliding group gets the first six characters of its id appended.
 */
export function accountNames(accounts: readonly BeancountAccount[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const a of accounts) {
    base.set(a.id, `${ACCOUNT_PREFIX[a.type]}:${sanitizeComponent(`${a.code}-${a.name}`)}`);
  }
  const holders = new Map<string, string[]>();
  for (const [id, name] of base) holders.set(name, [...(holders.get(name) ?? []), id]);

  const names = new Map<string, string>();
  for (const [name, ids] of holders) {
    for (const id of ids) {
      // Not through sanitizeComponent: that would upper-case a leading hex letter.
      const suffix = id.replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
      names.set(id, ids.length === 1 ? name : `${name}-${suffix}`);
    }
  }
  if (new Set(names.values()).size !== names.size) {
    throw new BeancountError("Two accounts would share one Beancount name");
  }
  return names;
}

/** A Beancount string literal: backslash and quote escaped, line breaks and tabs as spaces. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, " ");
  return `"${escaped}"`;
}

/** Text safe inside a `#tag` or `^link`: letters, digits, `-`, `_`, `/`, `.`. */
export function tagSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9_./-]/g, "-");
}

/** Integer minor units as decimal text, by the currency's own number of decimals. */
export function formatAmount(minor: number, decimals: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new BeancountError(`Amount ${minor} is not a whole number of minor units`);
  }
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(-decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** What an entry carries from the document behind it. */
export interface BeancountDocument {
  /** Document numbers for `^link`, sorted, without duplicates. */
  links: string[];
  /** A payment's check number or wire reference, for `num:`. */
  reference: string | null;
  /** An invoice's or bill's due date, for `due:`. */
  dueDate: string | null;
}

interface NumberedDocument {
  id: string;
  number: string | null;
  dueDate: string | null;
  journalEntryId: string;
}

interface PaymentDocument {
  id: string;
  reference: string | null;
  journalEntryId: string;
}

interface Allocation {
  paymentId: string;
  documentId: string;
}

export interface BeancountDocumentRows {
  invoices: readonly NumberedDocument[];
  bills: readonly NumberedDocument[];
  payments: readonly PaymentDocument[];
  billPayments: readonly PaymentDocument[];
  paymentAllocations: readonly Allocation[];
  billPaymentAllocations: readonly Allocation[];
}

/**
 * The document behind each journal entry, keyed by entry id.
 *
 * Joined on `journal_entry_id`, which each document records. Not on document
 * numbers: a payment's number and its entry's number come from separate
 * sequences and are never equal.
 *
 * A document gets `^` its own number; a payment gets the numbers of the
 * documents it settled, so Fava groups an invoice with the payments against it.
 */
export function documentsByEntry(rows: BeancountDocumentRows): Map<string, BeancountDocument> {
  const out = new Map<string, BeancountDocument>();

  const addDocuments = (docs: readonly NumberedDocument[]) => {
    for (const d of docs) {
      out.set(d.journalEntryId, { links: d.number ? [d.number] : [], reference: null, dueDate: d.dueDate });
    }
  };

  const addPayments = (
    payments: readonly PaymentDocument[],
    allocations: readonly Allocation[],
    documents: readonly NumberedDocument[],
  ) => {
    const numberOf = new Map(documents.map((d) => [d.id, d.number]));
    for (const p of payments) {
      const links = new Set<string>();
      for (const a of allocations) {
        if (a.paymentId !== p.id) continue;
        const n = numberOf.get(a.documentId);
        if (n) links.add(n);
      }
      const reference = p.reference?.trim() ? p.reference.trim() : null;
      out.set(p.journalEntryId, { links: [...links].sort(), reference, dueDate: null });
    }
  };

  addDocuments(rows.invoices);
  addDocuments(rows.bills);
  addPayments(rows.payments, rows.paymentAllocations, rows.invoices);
  addPayments(rows.billPayments, rows.billPaymentAllocations, rows.bills);
  return out;
}
