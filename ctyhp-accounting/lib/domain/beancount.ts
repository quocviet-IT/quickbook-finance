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
import { companySlugFromName } from "@/lib/domain/company-slug";

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

export interface BeancountLine {
  accountId: string;
  debitMinor: number;
  creditMinor: number;
}

export interface BeancountEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  /** The entry's own currency — the one it is required to balance in. */
  currencyCode: string;
  lines: BeancountLine[];
}

export interface BeancountCurrency {
  code: string;
  decimalPlaces: number;
  isBase: boolean;
}

export interface BeancountPrice {
  currencyCode: string;
  rateDate: string;
  /** Units of base currency per one unit of this currency, as the database stored it. */
  rateToBase: string;
}

export interface BeancountCompany {
  legalName: string;
  fiscalYearStartMonth: number;
  accountingBasis: "accrual" | "cash";
}

export interface BeancountInput {
  company: BeancountCompany;
  /** The export's single clock reading, ISO. */
  generatedAt: string;
  accounts: readonly BeancountAccount[];
  /** Posted entries only. Voided entries are not in the books, so not in the file. */
  entries: readonly BeancountEntry[];
  partyByEntryId: ReadonlyMap<string, string>;
  documentByEntryId: ReadonlyMap<string, BeancountDocument>;
  currencies: readonly BeancountCurrency[];
  prices: readonly BeancountPrice[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"] as const;

/** Comment text on one line. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/** A rate as the database stored it, without trailing zeros. */
function trimRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/**
 * The whole ledger as Beancount v3 text.
 *
 * Postings carry each entry's own currency: OneBook guarantees an entry balances
 * in that currency, while its base-currency figures are rounded line by line and
 * can be out by a minor unit — which `bean-check` would reject.
 */
export function buildBeancountFile(input: BeancountInput): string {
  const base = input.currencies.find((c) => c.isBase);
  if (!base) throw new BeancountError("No base currency is set");
  const decimalsOf = new Map(input.currencies.map((c) => [c.code, c.decimalPlaces]));

  const names = accountNames(input.accounts);
  const nameWidth = Math.max(0, ...[...names.values()].map((n) => n.length)) + 2;

  const entries = [...input.entries].sort(
    (x, y) => x.entryDate.localeCompare(y.entryDate) || x.entryNumber.localeCompare(y.entryNumber),
  );
  // Every account opens on the book's first date, which is on or before any
  // posting to it by construction.
  const openDate = entries[0]?.entryDate ?? input.generatedAt.slice(0, 10);

  const out: string[] = [];
  const rule = `;; ${"=".repeat(58)}`;
  out.push(
    rule,
    `;; ${oneLine(input.company.legalName)} - Beancount ledger`,
    `;; Generated ${input.generatedAt.slice(0, 10)} | Beancount v3 format`,
    rule,
    "",
    `option "title" ${quote(input.company.legalName)}`,
    `option "operating_currency" ${quote(base.code)}`,
    `;; Fiscal year starts: ${MONTHS[input.company.fiscalYearStartMonth - 1] ?? String(input.company.fiscalYearStartMonth)}`,
    `;; Basis: ${input.company.accountingBasis}`,
    "",
    ";; --- Chart of accounts ---",
    "",
  );

  for (const root of ROOTS) {
    const inRoot = [...names.values()].filter((n) => n.startsWith(`${root}:`)).sort();
    if (inRoot.length === 0) continue;
    out.push(`;; ${root}`);
    for (const n of inRoot) out.push(`${openDate} open ${n}`);
    out.push("");
  }

  const used = new Set(entries.map((e) => e.currencyCode));
  const prices = input.prices
    .filter((p) => p.currencyCode !== base.code && used.has(p.currencyCode))
    .sort((x, y) => x.rateDate.localeCompare(y.rateDate) || x.currencyCode.localeCompare(y.currencyCode));
  if (prices.length > 0) {
    out.push(";; --- Prices ---", "");
    for (const p of prices) out.push(`${p.rateDate} price ${p.currencyCode} ${trimRate(p.rateToBase)} ${base.code}`);
    out.push("");
  }

  out.push(";; --- Transactions ---", "");
  if (entries.length === 0) out.push("; No posted entries.", "");

  let month = "";
  for (const e of entries) {
    const m = e.entryDate.slice(0, 7);
    if (m !== month) {
      month = m;
      out.push(`;; ${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`, "");
    }

    const decimals = decimalsOf.get(e.currencyCode);
    if (decimals === undefined) {
      throw new BeancountError(`Entry ${e.entryNumber} is in ${e.currencyCode}, which has no currency record`);
    }

    const party = input.partyByEntryId.get(e.id);
    const doc = input.documentByEntryId.get(e.id);
    let header = `${e.entryDate} *`;
    if (party) header += ` ${quote(party)}`;
    header += ` ${quote(e.description ?? "")} #${tagSafe(e.sourceType)}`;
    for (const link of doc?.links ?? []) header += ` ^${tagSafe(link)}`;
    out.push(header, `  entry: ${quote(e.entryNumber)}`);
    if (doc?.reference) out.push(`  num: ${quote(doc.reference)}`);
    if (doc?.dueDate) out.push(`  due: ${doc.dueDate}`);

    for (const l of e.lines) {
      const account = names.get(l.accountId);
      if (!account) throw new BeancountError(`Entry ${e.entryNumber} posts to an account that is not in the chart`);
      const amount = formatAmount(l.debitMinor - l.creditMinor, decimals);
      out.push(`  ${account.padEnd(nameWidth)}${amount.padStart(16)} ${e.currencyCode}`);
    }
    out.push("");
  }

  out.push(";; --- End of file ---");
  return `${out.join("\n")}\n`;
}

/** `<company-slug>.beancount`, or `ledger.beancount` when the name yields no slug. */
export function beancountFileName(legalName: string): string {
  const slug = companySlugFromName(legalName).replace(/_/g, "-");
  return `${slug || "ledger"}.beancount`;
}
