/**
 * Reading a list out of QuickBooks or Wave.
 *
 * Pure. Two problems live here, and the second is the one that costs money:
 *
 *   1. **Which column is which.** No two exports agree. QuickBooks Online calls
 *      a customer's name `Customer`, Wave calls it `Customer name`, and a
 *      client's own file will have a column neither product ever produced. So
 *      nothing is hard-coded to a column name: the headers are read, a mapping
 *      is *proposed*, and a person confirms it. A new format then becomes a
 *      mapping somebody picks, not a change to this file.
 *
 *   2. **What an account actually is.** QuickBooks has dozens of account detail
 *      types; One Book has thirteen account types. There is no 1:1, and getting
 *      it wrong does not fail — it silently files a liability as an asset. Every
 *      translation is written down below, and anything unrecognised is reported
 *      for a person to decide rather than guessed at.
 */

import { parseStatementAmount } from "./statement-import";
import { ACCOUNT_TYPES, type AccountType } from "./accounts";

export type ImportTarget = "chart_of_accounts" | "customers" | "vendors" | "items" | "invoices";

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  /** How other products spell it. Matched case- and punctuation-insensitively. */
  aliases: readonly string[];
  kind: "text" | "money" | "boolean" | "account_type" | "number" | "date";
  hint?: string;
}

const CHART_FIELDS: readonly FieldSpec[] = [
  {
    key: "account_code",
    label: "Account code",
    required: true,
    kind: "text",
    aliases: ["account number", "number", "acct #", "acct no", "code", "account no"],
  },
  {
    key: "name",
    label: "Account name",
    required: true,
    kind: "text",
    // QuickBooks writes a subaccount as "Parent: Child" in this one cell.
    aliases: ["account name", "account", "full name", "name"],
  },
  {
    key: "account_type",
    label: "Type",
    required: true,
    kind: "account_type",
    aliases: ["type", "account type", "detail type", "category", "account category"],
  },
  {
    key: "description",
    label: "Description",
    required: false,
    kind: "text",
    aliases: ["description", "memo", "notes"],
  },
  {
    key: "opening_balance_minor",
    label: "Opening balance",
    required: false,
    kind: "money",
    aliases: ["balance", "opening balance", "current balance", "balance total"],
    hint: "Posted against Opening Balance Equity when the balances are brought across.",
  },
];

const CONTACT_FIELDS = (noun: string): readonly FieldSpec[] => [
  {
    key: "name",
    label: `${noun} name`,
    required: true,
    kind: "text",
    aliases: [
      noun.toLowerCase(),
      `${noun.toLowerCase()} name`,
      "company name",
      "display name as",
      "display name",
      "full name",
      "name",
    ],
  },
  {
    key: "email",
    label: "Email",
    required: false,
    kind: "text",
    aliases: ["email", "e-mail", "email address", "main email"],
  },
  {
    key: "contact_name",
    label: "Contact",
    required: false,
    kind: "text",
    aliases: ["contact", "contact name", "first name", "primary contact"],
  },
  {
    key: "phone",
    label: "Phone",
    required: false,
    kind: "text",
    aliases: ["phone", "phone number", "main phone", "telephone", "mobile"],
  },
  {
    key: "city",
    label: "City",
    required: false,
    kind: "text",
    aliases: ["city", "billing city", "bill city"],
  },
  {
    key: "region",
    label: "State",
    required: false,
    kind: "text",
    aliases: ["state", "province", "billing state", "bill state", "region"],
  },
  {
    key: "postal_code",
    label: "Postal code",
    required: false,
    kind: "text",
    aliases: ["zip", "zip code", "postal code", "billing zip", "bill zip"],
  },
  {
    key: "country",
    label: "Country",
    required: false,
    kind: "text",
    aliases: ["country", "billing country"],
  },
  {
    key: "opening_balance_minor",
    label: "Opening balance",
    required: false,
    kind: "money",
    aliases: ["balance", "open balance", "opening balance", "outstanding balance"],
    hint: "Brought across as a single opening document, so the ageing and the control account still agree.",
  },
];

const ITEM_FIELDS: readonly FieldSpec[] = [
  {
    key: "item_code",
    label: "Item code",
    required: false,
    kind: "text",
    aliases: ["sku", "item code", "product code", "code", "product/service"],
  },
  {
    key: "name",
    label: "Item name",
    required: true,
    kind: "text",
    aliases: ["name", "product name", "item name", "product/service name", "description"],
  },
  {
    key: "description",
    label: "Description",
    required: false,
    kind: "text",
    aliases: ["description", "sales description", "purchase description"],
  },
  {
    key: "sales_price_minor",
    label: "Sales price",
    required: false,
    kind: "money",
    aliases: ["price", "sales price", "rate", "unit price", "sales price / rate"],
  },
  {
    key: "purchase_cost_minor",
    label: "Cost",
    required: false,
    kind: "money",
    aliases: ["cost", "purchase cost", "unit cost", "purchase price"],
  },
  {
    key: "is_inventory",
    label: "Tracks inventory",
    required: false,
    kind: "boolean",
    aliases: ["inventory", "track inventory", "is inventory", "type"],
  },
];


/**
 * Invoices are the one target where several rows make one record. The number is
 * what groups them; `groupInvoiceRows` does the grouping after this mapping runs.
 */
const INVOICE_FIELDS: readonly FieldSpec[] = [
  {
    key: "invoice_number",
    label: "Invoice number",
    required: true,
    kind: "text",
    aliases: ["invoice number", "invoice no", "invoice #", "invoice", "number", "doc number", "reference"],
    hint: "Rows sharing this become one invoice. Kept as a reference — issuing assigns our own number.",
  },
  {
    key: "customer",
    label: "Customer",
    required: true,
    kind: "text",
    aliases: ["customer", "customer name", "client", "client name", "bill to", "account name"],
    hint: "Must already exist. An unknown name is reported, never created.",
  },
  {
    key: "issue_date",
    label: "Issue date",
    required: true,
    kind: "date",
    aliases: ["issue date", "invoice date", "date", "created", "transaction date"],
  },
  {
    key: "due_date",
    label: "Due date",
    required: false,
    kind: "date",
    aliases: ["due date", "due", "payment due", "terms date"],
  },
  {
    key: "description",
    label: "Line description",
    required: false,
    kind: "text",
    aliases: ["description", "item", "product", "service", "line description", "details", "memo line"],
  },
  {
    key: "quantity",
    label: "Quantity",
    required: true,
    kind: "number",
    aliases: ["quantity", "qty", "units", "hours"],
  },
  {
    key: "unit_price_minor",
    label: "Unit price",
    required: true,
    kind: "money",
    aliases: ["unit price", "price", "rate", "unit cost", "amount per unit"],
  },
  {
    key: "income_account",
    label: "Income account",
    required: true,
    kind: "text",
    aliases: ["income account", "revenue account", "account", "account code", "sales account", "category"],
    hint: "Code or name of an active operating income account.",
  },
  {
    key: "tax_code",
    label: "Sales tax code",
    required: false,
    kind: "text",
    aliases: ["tax code", "sales tax", "tax", "tax rate", "vat code"],
  },
  {
    key: "memo",
    label: "Invoice memo",
    required: false,
    kind: "text",
    aliases: ["invoice memo", "note", "notes", "comment", "message"],
  },
];

export function fieldsFor(target: ImportTarget): readonly FieldSpec[] {
  switch (target) {
    case "chart_of_accounts":
      return CHART_FIELDS;
    case "customers":
      return CONTACT_FIELDS("Customer");
    case "vendors":
      return CONTACT_FIELDS("Vendor");
    case "items":
      return ITEM_FIELDS;
    case "invoices":
      return INVOICE_FIELDS;
  }
}

export const TARGET_LABEL: Record<ImportTarget, string> = {
  chart_of_accounts: "Chart of accounts",
  customers: "Customers",
  vendors: "Vendors",
  items: "Products and services",
  invoices: "Invoices (drafts)",
};

// --- Proposing a mapping ----------------------------------------------------

/** Compare headers the way a person would: ignoring case, spacing and punctuation. */
function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(header: string): string[] {
  return normalise(header).split(" ").filter(Boolean);
}

/** How well a header matches a field: exact alias, then containment, then overlap. */
function score(header: string, field: FieldSpec): number {
  const h = normalise(header);
  if (h === "") return 0;
  const aliases = field.aliases.map(normalise);
  if (aliases.includes(h)) return 100;
  if (aliases.some((a) => h === `${a} 1` || h === `${a}s`)) return 90;
  if (aliases.some((a) => a !== "" && (h.includes(a) || a.includes(h)))) return 70;

  const headerTokens = new Set(tokens(header));
  let best = 0;
  for (const alias of field.aliases) {
    const aliasTokens = tokens(alias);
    if (aliasTokens.length === 0) continue;
    const shared = aliasTokens.filter((t) => headerTokens.has(t)).length;
    best = Math.max(best, (shared / aliasTokens.length) * 60);
  }
  return best;
}

export interface ProposedMapping {
  /** Field key → column index in the file, or null when nothing matched. */
  columns: Record<string, number | null>;
  /** Headers the mapping did not use. Reported, never silently ignored. */
  unmapped: string[];
  /** Required fields with no column. The import cannot run until these are set. */
  missingRequired: string[];
}

/**
 * Work out which column is which.
 *
 * A proposal, not a decision — the screen shows it and a person can change any
 * of it before anything is read. Ties are broken by the better score, and one
 * column is never used for two fields.
 */
export function proposeMapping(
  headers: readonly string[],
  target: ImportTarget,
): ProposedMapping {
  const fields = fieldsFor(target);
  const columns: Record<string, number | null> = {};
  const taken = new Set<number>();

  const candidates: { field: string; index: number; score: number }[] = [];
  for (const field of fields) {
    headers.forEach((header, index) => {
      const value = score(header, field);
      if (value >= 40) candidates.push({ field: field.key, index, score: value });
    });
    columns[field.key] = null;
  }

  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (columns[candidate.field] !== null) continue;
    if (taken.has(candidate.index)) continue;
    columns[candidate.field] = candidate.index;
    taken.add(candidate.index);
  }

  return {
    columns,
    unmapped: headers.filter((_, index) => !taken.has(index)),
    missingRequired: fields.filter((f) => f.required && columns[f.key] === null).map((f) => f.key),
  };
}

// --- Translating an account type -------------------------------------------

/**
 * What another product's account type means here.
 *
 * QuickBooks and Wave both carry far more detail types than One Book's thirteen
 * account types, and the mapping is a judgement in a few places — a credit card
 * is a liability, "Other Current Asset" is a current asset, "Cost of Goods
 * Sold" is its own type here. Every rule is written down so it can be argued
 * with, and anything unrecognised is refused rather than defaulted.
 */
const ACCOUNT_TYPE_RULES: readonly { pattern: RegExp; type: AccountType }[] = [
  { pattern: /accounts? receivable|^a\/?r$|debtors/i, type: "accounts_receivable" },
  { pattern: /accounts? payable|^a\/?p$|creditors/i, type: "accounts_payable" },
  { pattern: /credit card/i, type: "credit_card" },
  { pattern: /^bank|checking|savings|cash and cash equivalents|money market/i, type: "bank" },
  { pattern: /fixed asset|property, plant|non-?current asset|plant and equipment/i, type: "fixed_asset" },
  { pattern: /other current asset|current asset|prepaid|inventory|stock/i, type: "current_asset" },
  { pattern: /long ?term liabilit|non-?current liabilit|loan payable|notes payable/i, type: "current_liability" },
  { pattern: /other current liabilit|current liabilit|liabilit/i, type: "current_liability" },
  { pattern: /equity|retained earnings|owner|capital/i, type: "equity" },
  { pattern: /cost of goods sold|^cogs$|cost of sales/i, type: "cost_of_goods_sold" },
  { pattern: /other income|interest income|gain on/i, type: "other_income" },
  { pattern: /^income|revenue|sales|turnover/i, type: "income" },
  { pattern: /other expense|interest expense|loss on|depreciation expense/i, type: "other_expense" },
  { pattern: /expense|overhead|cost/i, type: "expense" },
  { pattern: /^asset$/i, type: "current_asset" },
];

export function translateAccountType(raw: string): AccountType | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  // A value that is already one of ours passes straight through.
  const exact = text.toLowerCase().replace(/[\s-]+/g, "_");
  if ((ACCOUNT_TYPES as readonly string[]).includes(exact)) return exact as AccountType;
  for (const rule of ACCOUNT_TYPE_RULES) if (rule.pattern.test(text)) return rule.type;
  return null;
}

/**
 * Split `Parent: Child` into its parts.
 *
 * QuickBooks writes a subaccount's whole lineage into one cell. The parent has
 * to exist before the child, and the child's own name is the last part.
 */
export function splitAccountName(raw: string): { name: string; parents: string[] } {
  const parts = (raw ?? "")
    .split(":")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return { name: "", parents: [] };
  return { name: parts[parts.length - 1], parents: parts.slice(0, -1) };
}

// --- Reading the rows -------------------------------------------------------

export interface ImportProblem {
  /** 1-based, counting the header as row 1, so it matches what a spreadsheet shows. */
  row: number;
  field?: string;
  message: string;
}

export interface ParsedImport {
  /** One record per usable row, keyed by field. */
  records: Record<string, string | number | boolean | null>[];
  /** Rows that could not be read, and why. Counted, never dropped in silence. */
  problems: ImportProblem[];
  /** Rows skipped because every mapped column was empty. */
  blankRows: number;
}

/**
 * Accepts what a spreadsheet exports: ISO, and the two slash orders. A
 * two-digit year is refused rather than guessed — 01/02/26 is three dates.
 */
function coerceDate(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (slash) {
    const [, a, b, year] = slash;
    // Month first when it cannot be a month the other way round; otherwise the
    // file is ambiguous and the mapping screen is where a person resolves it.
    const month = Number(a) > 12 ? b : a;
    const day = Number(a) > 12 ? a : b;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

function coerceBoolean(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  return ["yes", "y", "true", "1", "inventory", "inventory part", "stock"].includes(text);
}

/**
 * Turn rows into records using the confirmed mapping.
 *
 * A row that cannot be read is reported with its spreadsheet row number and
 * left out — never half-imported, and never guessed at.
 */
export function applyMapping(
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  target: ImportTarget,
): ParsedImport {
  const fields = fieldsFor(target);
  const records: Record<string, string | number | boolean | null>[] = [];
  const problems: ImportProblem[] = [];
  let blankRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for zero-based, +1 for the header row.
    const read = (key: string): string => {
      const column = mapping[key];
      if (column === null || column === undefined) return "";
      return (row[column] ?? "").trim();
    };

    if (fields.every((field) => read(field.key) === "")) {
      blankRows += 1;
      return;
    }

    const record: Record<string, string | number | boolean | null> = {};
    const rowProblems: ImportProblem[] = [];

    for (const field of fields) {
      const raw = read(field.key);

      if (field.required && raw === "") {
        rowProblems.push({ row: rowNumber, field: field.key, message: `${field.label} is required` });
        continue;
      }

      if (raw === "") {
        record[field.key] =
          field.kind === "money" || field.kind === "number"
            ? 0
            : field.kind === "boolean"
              ? false
              : null;
        continue;
      }

      switch (field.kind) {
        case "money": {
          const minor = parseStatementAmount(raw);
          if (minor === null) {
            rowProblems.push({
              row: rowNumber,
              field: field.key,
              message: `${field.label}: "${raw}" is not an amount`,
            });
          } else {
            record[field.key] = minor;
          }
          break;
        }
        case "number": {
          // Quantities are counts, not money: 2.5 hours is a quantity, and
          // parsing it as minor units would turn it into 250.
          const value = Number(raw.replace(/[\s,]/g, ""));
          if (!Number.isFinite(value)) {
            rowProblems.push({
              row: rowNumber,
              field: field.key,
              message: `${field.label}: "${raw}" is not a number`,
            });
          } else {
            record[field.key] = value;
          }
          break;
        }
        case "date": {
          // Normalised to YYYY-MM-DD here; whether it is a real calendar date is
          // checked where the document is assembled, with the rest of its group.
          const iso = coerceDate(raw);
          if (iso === null) {
            rowProblems.push({
              row: rowNumber,
              field: field.key,
              message: `${field.label}: "${raw}" is not a date`,
            });
          } else {
            record[field.key] = iso;
          }
          break;
        }
        case "boolean":
          record[field.key] = coerceBoolean(raw);
          break;
        case "account_type": {
          const type = translateAccountType(raw);
          if (type === null) {
            rowProblems.push({
              row: rowNumber,
              field: field.key,
              message: `Account type "${raw}" has no equivalent here — map it by hand`,
            });
          } else {
            record[field.key] = type;
          }
          break;
        }
        default:
          record[field.key] = raw;
      }
    }

    if (rowProblems.length > 0) {
      problems.push(...rowProblems);
      return;
    }
    records.push(record);
  });

  return { records, problems, blankRows };
}

/** One sentence describing what the file holds, before anything is imported. */
export function describeParsedImport(parsed: ParsedImport, target: ImportTarget): string {
  const parts = [`${parsed.records.length} ${TARGET_LABEL[target].toLowerCase()} ready`];
  if (parsed.problems.length > 0) parts.push(`${parsed.problems.length} row(s) need attention`);
  if (parsed.blankRows > 0) parts.push(`${parsed.blankRows} blank row(s) skipped`);
  return `${parts.join(", ")}.`;
}
