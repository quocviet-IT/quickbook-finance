import {
  fieldsFor,
  proposeMapping,
  TARGET_LABEL,
  type FieldSpec,
  type ImportTarget,
} from "./import-mapping";

/**
 * What kind of file is this, and does it belong in the tab that is open?
 *
 * Feedback 428ca4db was a person putting a general ledger detail export into the
 * Chart of accounts tab. They were five fields deep before anything told them
 * the file was the wrong kind — and it never did say so. Everything here exists
 * to answer that before the mapping table appears.
 *
 * Pure, and derived from `fieldsFor` so that guidance and behaviour cannot
 * disagree: the labels shown are the labels the mapper matches.
 */

const TARGETS: readonly ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
];

/** Compare headers the way a person would, as the mapper does. */
function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasColumn(headers: readonly string[], words: readonly string[]): boolean {
  return headers.some((header) => {
    const h = normalise(header);
    return words.some((word) => h === word || h.startsWith(`${word} `) || h.includes(` ${word}`));
  });
}

/** One believable value per kind, so a template can be opened and filled in. */
const EXAMPLE_BY_KIND: Record<FieldSpec["kind"], string> = {
  text: "Example",
  money: "0.00",
  boolean: "No",
  account_type: "Bank",
  number: "1",
  date: "2026-01-31",
};

/**
 * Values for the fields where a generic example would teach nothing. The chart
 * of accounts row is the PC49 account from the report, so the answer to "how do
 * I add this ledger" is a file the person can open.
 */
const EXAMPLE_BY_KEY: Record<string, string> = {
  account_code: "121",
  name: "PC49 BoA CK 3388",
  account_type: "Bank",
  description: "Operating checking account",
  opening_balance_minor: "968798.29",
  email: "billing@example.com",
  contact_name: "Alex Tran",
  phone: "408-555-0134",
  city: "San Jose",
  region: "CA",
  postal_code: "95112",
  country: "United States",
  item_code: "RING-001",
  sales_price_minor: "1250.00",
  purchase_cost_minor: "800.00",
  is_inventory: "Yes",
  invoice_number: "INV-1001",
  customer: "Aurora Fine Jewelry",
  issue_date: "2026-01-15",
  due_date: "2026-02-14",
  quantity: "1",
  unit_price_minor: "1250.00",
  income_account: "4000",
  tax_code: "CA-SJ",
  memo: "Thank you for your business",
};

/** A CSV with exactly the columns this tab reads, and one row showing the shape. */
export function templateCsvFor(target: ImportTarget): string {
  const fields = fieldsFor(target);
  const cell = (value: string) => (value.includes(",") ? `"${value}"` : value);
  const header = fields.map((field) => cell(field.label)).join(",");
  const example = fields
    .map((field) => cell(EXAMPLE_BY_KEY[field.key] ?? EXAMPLE_BY_KIND[field.kind]))
    .join(",");
  return `${header}\n${example}\n`;
}

export interface FileShapeDetection {
  /** Best matching import target, or null when nothing matches well. */
  target: ImportTarget | null;
  /** How many of that target's required fields the headers cover. */
  matchedRequired: number;
  requiredTotal: number;
  /** A date beside a debit or credit: one row per transaction, not per record. */
  looksLikeLedgerDetail: boolean;
  /**
   * Wave's "Account Transactions" report: ledger detail plus an account column
   * and a running balance. That file is grouped into per-account sections, so no
   * column mapping can read it at all — it earns its own sentence.
   */
  looksLikeWaveAccountTransactions: boolean;
}

/** How many of a target's required fields these headers cover. */
function requiredCoverage(headers: readonly string[], target: ImportTarget) {
  const required = fieldsFor(target).filter((field) => field.required);
  const proposal = proposeMapping(headers, target);
  const matched = required.filter((field) => proposal.columns[field.key] !== null).length;
  return { matched, total: required.length };
}

export function detectFileShape(headers: readonly string[]): FileShapeDetection {
  const empty: FileShapeDetection = {
    target: null,
    matchedRequired: 0,
    requiredTotal: 0,
    looksLikeLedgerDetail: false,
    looksLikeWaveAccountTransactions: false,
  };
  if (headers.length === 0) return empty;

  let best: { target: ImportTarget; matched: number; total: number } | null = null;
  for (const target of TARGETS) {
    const { matched, total } = requiredCoverage(headers, target);
    if (!best || matched > best.matched) best = { target, matched, total };
  }

  const hasDate = hasColumn(headers, ["date", "transaction date", "posting date"]);
  const hasDebitOrCredit = hasColumn(headers, ["debit", "credit"]);
  const hasAccount = hasColumn(headers, ["account", "account number", "account name"]);
  const hasRunningBalance = hasColumn(headers, ["balance"]);
  const looksLikeLedgerDetail = hasDate && hasDebitOrCredit;

  const looksLikeWaveAccountTransactions = looksLikeLedgerDetail && hasAccount && hasRunningBalance;
  const covered = best && best.matched === best.total && best.total > 0;
  return {
    // Claimed only when every required field is covered. A partial match is the
    // state that produced the report; naming a target there would repeat it.
    // The Wave ledger is the exception: it is recognised by its shape, because
    // no column mapping can read it and there is now a tab that can.
    target: looksLikeWaveAccountTransactions ? "general_ledger" : best && covered ? best.target : null,
    matchedRequired: looksLikeWaveAccountTransactions ? 0 : (best?.matched ?? 0),
    requiredTotal: looksLikeWaveAccountTransactions ? 0 : (best?.total ?? 0),
    looksLikeLedgerDetail,
    looksLikeWaveAccountTransactions,
  };
}

/** The sentence to show above the mapping table, or null when all is well. */
export function describeShapeMismatch(
  selected: ImportTarget,
  detection: FileShapeDetection,
): string | null {
  if (detection.target === selected) return null;

  if (detection.looksLikeWaveAccountTransactions) {
    return (
      "This file is a general ledger: one row per transaction, grouped into sections per " +
      "account, with a running balance. Every row is one side of a double entry, so no column " +
      `mapping can read it. Switch to ${TARGET_LABEL.general_ledger} — that tab reads this ` +
      "file whole, every account in one go."
    );
  }

  if (detection.target) {
    return `This file looks like ${TARGET_LABEL[detection.target]}, not ${TARGET_LABEL[selected]}.`;
  }

  if (detection.looksLikeLedgerDetail) {
    return (
      "This file has a date and debit or credit columns, so it holds transactions rather " +
      `than one row per ${TARGET_LABEL[selected].toLowerCase()} record. Check the tab before mapping.`
    );
  }

  return null;
}
