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
import type { BalanceAssertion } from "@/lib/domain/beancount-balance";
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
  long_term_liability: "Liabilities:LongTerm",
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

/** Minor units with thousands separators, for comments a person reads. */
function formatGrouped(minor: number, decimals: number): string {
  const plain = formatAmount(minor, decimals);
  const negative = plain.startsWith("-");
  const [whole, fraction] = (negative ? plain.slice(1) : plain).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
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
  /** One per completed bank reconciliation, from `balanceAssertions`. */
  assertions: readonly BalanceAssertion[];
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
 * One line of the file, with what a reader can open from it.
 *
 * The file is text, but a screen showing it wants more than text: an account
 * name that opens its ledger, an entry that opens its detail. So the builder
 * produces lines that say what they are and where their parts sit, and
 * `buildBeancountFile` is simply those lines joined. There is one builder, so
 * the file on screen and the file handed over cannot differ.
 */
export type BeancountTextLine =
  | { kind: "comment" | "blank" | "option" | "price"; text: string }
  | {
      kind: "open";
      text: string;
      accountId: string;
      /** Where the account name begins; it runs to the end of the line. */
      accountStart: number;
    }
  | { kind: "txn" | "meta"; text: string; entryId: string }
  | { kind: "reconciliation"; text: string; reconciliationId: string }
  | {
      kind: "balance";
      text: string;
      reconciliationId: string;
      accountId: string;
      /** The account name is `text.slice(accountStart, accountEnd)`. */
      accountStart: number;
      accountEnd: number;
    }
  | {
      kind: "posting";
      text: string;
      entryId: string;
      accountId: string;
      /** The account name is `text.slice(2, accountEnd)`. */
      accountEnd: number;
      /** The amount, without its padding, is `text.slice(amountStart, amountEnd)`. */
      amountStart: number;
      amountEnd: number;
      /** A credit posting — a negative amount in Beancount's signed form. */
      credit: boolean;
    };

/** What writing one entry needs besides the entry itself. */
export interface BeancountEntryContext {
  names: ReadonlyMap<string, string>;
  /** The width account names are padded to, so amounts line up down the file. */
  nameWidth: number;
  /** Decimal places of the entry's own currency. */
  decimals: number;
  party?: string;
  document?: BeancountDocument;
}

/** Account names are padded to the longest, plus two spaces. */
export function beancountNameWidth(names: ReadonlyMap<string, string>): number {
  return Math.max(0, ...[...names.values()].map((n) => n.length)) + 2;
}

/**
 * One entry: its header, its metadata, its postings.
 *
 * Postings carry the entry's own currency: OneBook guarantees an entry balances
 * in that currency, while its base-currency figures are rounded line by line and
 * can be out by a minor unit — which `bean-check` would reject.
 */
export function beancountEntryLines(e: BeancountEntry, ctx: BeancountEntryContext): BeancountTextLine[] {
  const out: BeancountTextLine[] = [];
  let header = `${e.entryDate} *`;
  if (ctx.party) header += ` ${quote(ctx.party)}`;
  header += ` ${quote(e.description ?? "")} #${tagSafe(e.sourceType)}`;
  for (const link of ctx.document?.links ?? []) header += ` ^${tagSafe(link)}`;
  out.push({ kind: "txn", text: header, entryId: e.id });
  out.push({ kind: "meta", text: `  entry: ${quote(e.entryNumber)}`, entryId: e.id });
  if (ctx.document?.reference) out.push({ kind: "meta", text: `  num: ${quote(ctx.document.reference)}`, entryId: e.id });
  if (ctx.document?.dueDate) out.push({ kind: "meta", text: `  due: ${ctx.document.dueDate}`, entryId: e.id });

  for (const l of e.lines) {
    const account = ctx.names.get(l.accountId);
    if (!account) throw new BeancountError(`Entry ${e.entryNumber} posts to an account that is not in the chart`);
    const signed = l.debitMinor - l.creditMinor;
    const amount = formatAmount(signed, ctx.decimals);
    const amountEnd = 2 + ctx.nameWidth + Math.max(16, amount.length);
    out.push({
      kind: "posting",
      text: `  ${account.padEnd(ctx.nameWidth)}${amount.padStart(16)} ${e.currencyCode}`,
      entryId: e.id,
      accountId: l.accountId,
      accountEnd: 2 + account.length,
      amountStart: amountEnd - amount.length,
      amountEnd,
      credit: signed < 0,
    });
  }
  return out;
}

/** One entry as Beancount text, exactly as it appears in the file. */
export function beancountEntryText(e: BeancountEntry, ctx: BeancountEntryContext): string {
  return beancountEntryLines(e, ctx)
    .map((l) => l.text)
    .join("\n");
}

/** The whole ledger as Beancount v3 lines. See `buildBeancountFile`. */
export function buildBeancountLines(input: BeancountInput): BeancountTextLine[] {
  const base = input.currencies.find((c) => c.isBase);
  if (!base) throw new BeancountError("No base currency is set");
  const decimalsOf = new Map(input.currencies.map((c) => [c.code, c.decimalPlaces]));

  const names = accountNames(input.accounts);
  const idByName = new Map([...names].map(([id, name]) => [name, id]));
  const nameWidth = beancountNameWidth(names);

  const entries = [...input.entries].sort(
    (x, y) => x.entryDate.localeCompare(y.entryDate) || x.entryNumber.localeCompare(y.entryNumber),
  );
  // Every account opens on the book's first date, which is on or before any
  // posting to it by construction — or on an earlier assertion's date, since a
  // balance may not be checked on an account before it opens.
  const openDate =
    [entries[0]?.entryDate, ...input.assertions.map((a) => a.date)]
      .filter((d): d is string => d !== undefined)
      .sort()[0] ?? input.generatedAt.slice(0, 10);

  const out: BeancountTextLine[] = [];
  const comment = (text: string) => out.push({ kind: "comment", text });
  const blank = () => out.push({ kind: "blank", text: "" });
  const rule = `;; ${"=".repeat(58)}`;

  comment(rule);
  comment(`;; ${oneLine(input.company.legalName)} - Beancount ledger`);
  comment(`;; Generated ${input.generatedAt.slice(0, 10)} | Beancount v3 format`);
  comment(rule);
  blank();
  out.push({ kind: "option", text: `option "title" ${quote(input.company.legalName)}` });
  out.push({ kind: "option", text: `option "operating_currency" ${quote(base.code)}` });
  comment(
    `;; Fiscal year starts: ${MONTHS[input.company.fiscalYearStartMonth - 1] ?? String(input.company.fiscalYearStartMonth)}`,
  );
  comment(`;; Basis: ${input.company.accountingBasis}`);
  blank();
  comment(";; --- Chart of accounts ---");
  blank();

  for (const root of ROOTS) {
    const inRoot = [...names.values()].filter((n) => n.startsWith(`${root}:`)).sort();
    if (inRoot.length === 0) continue;
    comment(`;; ${root}`);
    for (const n of inRoot) {
      const prefix = `${openDate} open `;
      out.push({ kind: "open", text: `${prefix}${n}`, accountId: idByName.get(n) as string, accountStart: prefix.length });
    }
    blank();
  }

  const used = new Set(entries.map((e) => e.currencyCode));
  const prices = input.prices
    .filter((p) => p.currencyCode !== base.code && used.has(p.currencyCode))
    .sort((x, y) => x.rateDate.localeCompare(y.rateDate) || x.currencyCode.localeCompare(y.currencyCode));
  if (prices.length > 0) {
    comment(";; --- Prices ---");
    blank();
    for (const p of prices) {
      out.push({ kind: "price", text: `${p.rateDate} price ${p.currencyCode} ${trimRate(p.rateToBase)} ${base.code}` });
    }
    blank();
  }

  comment(";; --- Transactions ---");
  blank();
  if (entries.length === 0) {
    comment("; No posted entries.");
    blank();
  }

  let month = "";
  for (const e of entries) {
    const m = e.entryDate.slice(0, 7);
    if (m !== month) {
      month = m;
      comment(`;; ${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);
      blank();
    }

    const decimals = decimalsOf.get(e.currencyCode);
    if (decimals === undefined) {
      throw new BeancountError(`Entry ${e.entryNumber} is in ${e.currencyCode}, which has no currency record`);
    }
    out.push(
      ...beancountEntryLines(e, {
        names,
        nameWidth,
        decimals,
        party: input.partyByEntryId.get(e.id),
        document: input.documentByEntryId.get(e.id),
      }),
    );
    blank();
  }

  if (input.assertions.length > 0) {
    const nameOf = (accountId: string) => {
      const name = names.get(accountId);
      if (!name) throw new BeancountError("A reconciled bank account is missing from the chart");
      return name;
    };
    comment(";; --- Balance assertions ---");
    comment(";; One per completed bank reconciliation: the book balance on the statement");
    comment(";; date as it stood when the reconciliation was completed. Beancount checks a");
    comment(";; balance at the start of its day, so each is dated the day after the statement.");
    blank();

    const ordered = [...input.assertions].sort(
      (x, y) => x.date.localeCompare(y.date) || nameOf(x.accountId).localeCompare(nameOf(y.accountId)),
    );
    for (const a of ordered) {
      const name = nameOf(a.accountId);
      if (a.kind === "skipped") {
        const why =
          a.reason === "currency"
            ? `it is reconciled in ${base.code}, and ${name} holds ${a.currencyCode}.`
            : `an entry on ${name} was voided at an unrecorded time, so its balance at completion cannot be rebuilt.`;
        out.push({
          kind: "reconciliation",
          text: `; Statement of ${a.statementDate} not asserted: ${why}`,
          reconciliationId: a.reconciliationId,
        });
      } else {
        const decimals = decimalsOf.get(a.currencyCode);
        if (decimals === undefined) {
          throw new BeancountError(`A reconciliation is in ${a.currencyCode}, which has no currency record`);
        }
        const diff = a.amountMinor - a.statementMinor;
        const uncleared = `${a.unclearedCount} line${a.unclearedCount === 1 ? "" : "s"} not yet cleared`;
        const agreement =
          diff === 0
            ? `Books agree with the statement.${a.unclearedCount > 0 ? ` ${uncleared} net to zero.` : ""}`
            : `Books differ by ${formatGrouped(diff, decimals)} ${a.currencyCode}${a.unclearedCount > 0 ? `: ${uncleared}.` : "."}`;
        out.push({
          kind: "reconciliation",
          text: `; Statement of ${a.statementDate}: ${formatGrouped(a.statementMinor, decimals)} ${a.currencyCode}. ${agreement}`,
          reconciliationId: a.reconciliationId,
        });
        const prefix = `${a.date} balance `;
        out.push({
          kind: "balance",
          text: `${prefix}${name.padEnd(nameWidth)}${formatAmount(a.amountMinor, decimals).padStart(16)} ${a.currencyCode}`,
          reconciliationId: a.reconciliationId,
          accountId: a.accountId,
          accountStart: prefix.length,
          accountEnd: prefix.length + name.length,
        });
      }
      blank();
    }
  }

  comment(";; --- End of file ---");
  return out;
}

/** The whole ledger as Beancount v3 text: `buildBeancountLines`, joined. */
export function buildBeancountFile(input: BeancountInput): string {
  return `${buildBeancountLines(input)
    .map((l) => l.text)
    .join("\n")}\n`;
}

/** `<company-slug>.beancount`, or `ledger.beancount` when the name yields no slug. */
export function beancountFileName(legalName: string): string {
  const slug = companySlugFromName(legalName).replace(/_/g, "-");
  return `${slug || "ledger"}.beancount`;
}
