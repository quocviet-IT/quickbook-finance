import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/**
 * Stock Count: a periodic count sheet. You type or paste the stock on hand, line
 * by line; OneBook compares the counted value (quantity x cost) with the
 * inventory accounts' balance on a date and posts one adjusting entry.
 *
 * Pure. Money is integer minor units in the base currency. The rules here mirror
 * the database functions in migration 0139 (acc_save_stock_count and
 * acc_post_stock_count), so the screen refuses what the database would refuse
 * before a request is sent.
 */

export const MAX_COUNT_LINES = 2000;
export const MAX_NAME_LENGTH = 200;
export const MAX_SKU_LENGTH = 100;
export const MAX_MEMO_LENGTH = 500;
/** The quantity column is numeric(20,4). */
export const QUANTITY_DECIMALS = 4;

export type StockCountStatus = "draft" | "pending_approval" | "posted";

const STATUS_LABEL: Record<StockCountStatus, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  posted: "Posted",
};

export function stockCountStatusLabel(status: string): string {
  return STATUS_LABEL[status as StockCountStatus] ?? status;
}

/** One line of a count sheet, as the screen edits it and the save call sends it. */
export interface StockCountLineInput {
  name: string;
  sku: string | null;
  quantity: number;
  unitCostMinor: number;
  /** For convenience only; it never reaches the accounts. */
  sellsForMinor: number | null;
}

// ---------------------------------------------------------------------------
// Values and totals
// ---------------------------------------------------------------------------

/**
 * The value of one line: round(quantity x unit cost), halves rounded up, which
 * is what `round(l.quantity * l.unit_cost_minor)` does in the database for the
 * non-negative numbers a count holds. Worked in integers (the quantity scaled to
 * its four decimals) so that binary floating point cannot move a half.
 */
export function lineValueMinor(quantity: number, unitCostMinor: number): number {
  const scale = 10 ** QUANTITY_DECIMALS;
  const scaledQuantity = BigInt(Math.round(quantity * scale));
  const numerator = scaledQuantity * BigInt(unitCostMinor);
  const denominator = BigInt(scale);
  const two = BigInt(2);
  return Number((numerator * two + denominator) / (denominator * two));
}

/** The counted total at cost: the sum of the line values. */
export function countedTotalMinor(lines: readonly Pick<StockCountLineInput, "quantity" | "unitCostMinor">[]): number {
  let total = 0;
  for (const l of lines) total += lineValueMinor(l.quantity, l.unitCostMinor);
  return total;
}

/** What posting would move the inventory accounts by: counted minus the books. */
export function countDifferenceMinor(countedMinor: number, bookMinor: number): number {
  return countedMinor - bookMinor;
}

// ---------------------------------------------------------------------------
// The paste reader
// ---------------------------------------------------------------------------

export interface PasteProblem {
  /** 1-based, counting blank lines, so it matches the line in the text box. */
  lineNumber: number;
  text: string;
  reason: string;
}

export interface PasteResult {
  lines: StockCountLineInput[];
  problems: PasteProblem[];
}

/** A plain amount, or one with unambiguous thousands groups (1,234,567.89). */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
/** Used only to decide where the name ends; it is deliberately loose. */
const NUMBER_SHAPED = /^[-+]?(\d[\d.,]*|\.\d+)$/;

/**
 * Split one line into fields. A tab-separated line (a paste from a spreadsheet)
 * splits on tabs only, so a comma can sit inside a name or a thousands group. A
 * comma-separated line splits on commas outside double quotes.
 */
function splitFields(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((f) => unquote(f.trim()));
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function unquote(field: string): string {
  return field.length >= 2 && field.startsWith('"') && field.endsWith('"')
    ? field.slice(1, -1).replaceAll('""', '"')
    : field;
}

type Parsed = { ok: true; whole: string; fraction: string } | { ok: false; reason: string };

/**
 * One amount as digits. Thousands commas are accepted only in the exact grouped
 * form (1,234 or 12,345.50). A bare comma-separated paste cannot carry them, as
 * the comma is the column break, so they arrive via quotes or a spreadsheet's
 * tabs.
 */
function parseAmount(raw: string, label: string): Parsed {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: `${label} is missing` };
  if (/^-/.test(text)) return { ok: false, reason: `${label} cannot be negative` };
  let digits = text;
  if (GROUPED_NUMBER.test(text)) digits = text.replaceAll(",", "");
  else if (!PLAIN_NUMBER.test(text)) {
    return {
      ok: false,
      reason: text.includes(",")
        ? `${label} “${text}” has a comma that could be a thousands separator or a column break; write it without commas`
        : `${label} “${text}” is not a number`,
    };
  }
  // 000, 050: the tail of a thousands group that the comma split off.
  if (/^0\d/.test(digits)) {
    return {
      ok: false,
      reason: `${label} “${text}” looks like part of a number split at a thousands comma; write it without commas`,
    };
  }
  const [whole, fraction = ""] = digits.split(".");
  return { ok: true, whole, fraction };
}

function toQuantity(raw: string, label: string): { value: number } | { reason: string } {
  const p = parseAmount(raw, label);
  if (!p.ok) return { reason: p.reason };
  const fraction = p.fraction.replace(/0+$/, "");
  if (fraction.length > QUANTITY_DECIMALS) {
    return { reason: `${label} can have at most ${QUANTITY_DECIMALS} decimal places` };
  }
  const value = Number(fraction ? `${p.whole}.${fraction}` : p.whole);
  if (!Number.isFinite(value) || value > 1e15) return { reason: `${label} is too large` };
  return { value };
}

function toMinorAmount(raw: string, label: string, decimals: number): { value: number } | { reason: string } {
  const p = parseAmount(raw, label);
  if (!p.ok) return { reason: p.reason };
  const fraction = p.fraction.replace(/0+$/, "");
  if (fraction.length > decimals) {
    return {
      reason: decimals === 0
        ? `${label} must be a whole number`
        : `${label} can have at most ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
    };
  }
  const value = Number(p.whole + fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(value)) return { reason: `${label} is too large` };
  return { value };
}

/**
 * Read a pasted count sheet: "name, quantity, cost" and, if you like, "sells
 * for". Each line is read from the right. The last two or three fields are the
 * numbers and everything before them is the name, so a name may contain commas.
 * A line is read as three numbers when the field in front of the last two is
 * itself shaped like a number and a name is left; otherwise as two.
 *
 * Blank lines are skipped without comment. A line that cannot be read is
 * reported by its number and the reason, and the lines that can be read are
 * still returned.
 */
export function parseCountSheet(text: string, decimals = 2): PasteResult {
  const lines: StockCountLineInput[] = [];
  const problems: PasteProblem[] = [];
  const rows = text.split(/\r\n|\r|\n/);

  rows.forEach((row, index) => {
    if (row.trim() === "") return;
    const lineNumber = index + 1;
    const refuse = (reason: string) => problems.push({ lineNumber, text: row.trim(), reason });

    const fields = splitFields(row.trim());
    if (fields.length < 3) {
      refuse(
        fields.length === 2
          ? "Needs a cost: write the name, the quantity and the cost each"
          : "Needs a name, a quantity and a cost each",
      );
      return;
    }

    const threeNumbers = fields.length >= 4 && NUMBER_SHAPED.test(fields[fields.length - 3]);
    const count = threeNumbers ? 3 : 2;
    const name = fields.slice(0, fields.length - count).join(", ").trim();
    const [qtyText, costText, sellsText] = fields.slice(fields.length - count);

    if (name === "") {
      refuse("A name is required");
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      refuse(`The name is too long (${MAX_NAME_LENGTH} characters at most)`);
      return;
    }

    const qty = toQuantity(qtyText, "Quantity");
    if ("reason" in qty) return refuse(qty.reason);
    const cost = toMinorAmount(costText, "Cost each", decimals);
    if ("reason" in cost) return refuse(cost.reason);
    let sellsForMinor: number | null = null;
    if (sellsText !== undefined) {
      const sells = toMinorAmount(sellsText, "Sells for", decimals);
      if ("reason" in sells) return refuse(sells.reason);
      sellsForMinor = sells.value;
    }

    lines.push({ name, sku: null, quantity: qty.value, unitCostMinor: cost.value, sellsForMinor });
  });

  return { lines, problems };
}

// ---------------------------------------------------------------------------
// The unsaved-changes guard
// ---------------------------------------------------------------------------

/** What the draft screen edits and saves. */
export interface StockCountDraft {
  asOf: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
}

function normalisedText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * True when the screen's current content differs from what was last saved, so
 * leaving would lose work. A memo or SKU that is empty and one that is absent
 * are the same; a client-only row key is ignored.
 */
export function isDirty(saved: StockCountDraft, current: StockCountDraft): boolean {
  if (saved.asOf !== current.asOf) return true;
  if (normalisedText(saved.memo) !== normalisedText(current.memo)) return true;
  if (saved.lines.length !== current.lines.length) return true;
  return saved.lines.some((a, i) => {
    const b = current.lines[i];
    return (
      a.name.trim() !== b.name.trim() ||
      normalisedText(a.sku) !== normalisedText(b.sku) ||
      a.quantity !== b.quantity ||
      a.unitCostMinor !== b.unitCostMinor ||
      (a.sellsForMinor ?? null) !== (b.sellsForMinor ?? null)
    );
  });
}

// ---------------------------------------------------------------------------
// Validation before a save
// ---------------------------------------------------------------------------

export interface CountProblem {
  /** 1-based line the problem is on; null for a problem with the sheet as a whole. */
  lineNumber: number | null;
  reason: string;
}

/**
 * The rules acc_save_stock_count enforces, checked on the screen first: a name
 * on every line; quantity, cost and sells for not negative; whole minor units;
 * at most 2,000 lines.
 */
export function validateStockCount(draft: StockCountDraft): CountProblem[] {
  const problems: CountProblem[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.asOf)) problems.push({ lineNumber: null, reason: "Choose the as-of date" });
  if (normalisedText(draft.memo).length > MAX_MEMO_LENGTH) {
    problems.push({ lineNumber: null, reason: `The memo is too long (${MAX_MEMO_LENGTH} characters at most)` });
  }
  if (draft.lines.length > MAX_COUNT_LINES) {
    problems.push({
      lineNumber: null,
      reason: `A count can hold at most ${MAX_COUNT_LINES.toLocaleString("en-US")} lines (this one has ${draft.lines.length.toLocaleString("en-US")})`,
    });
  }
  draft.lines.forEach((l, index) => {
    const lineNumber = index + 1;
    const add = (reason: string) => problems.push({ lineNumber, reason });
    const name = l.name.trim();
    if (name === "") add("A name is required");
    else if (name.length > MAX_NAME_LENGTH) add(`The name is too long (${MAX_NAME_LENGTH} characters at most)`);
    if (normalisedText(l.sku).length > MAX_SKU_LENGTH) add(`The SKU is too long (${MAX_SKU_LENGTH} characters at most)`);
    if (!Number.isFinite(l.quantity)) add("Enter a quantity");
    else if (l.quantity < 0) add("The quantity cannot be negative");
    if (!Number.isInteger(l.unitCostMinor)) add("Enter the cost each");
    else if (l.unitCostMinor < 0) add("The cost each cannot be negative");
    if (l.sellsForMinor !== null && l.sellsForMinor !== undefined) {
      if (!Number.isInteger(l.sellsForMinor)) add("Sells for must be an amount or empty");
      else if (l.sellsForMinor < 0) add("Sells for cannot be negative");
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Print, CSV and Excel
// ---------------------------------------------------------------------------

export interface StockCountSheetInput {
  companyName: string;
  currencyCode: string;
  /** Decimal places of the base currency. */
  decimals: number;
  countNumber: string;
  asOf: string;
  status: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
  /** The figures frozen at posting, or the live ones for a draft; null when not known. */
  bookMinor: number | null;
}

/** One count as a report sheet: every line, then the counted total and, when known, the books and the difference. */
export function stockCountSheet(input: StockCountSheetInput): ReportExportSheet {
  const money = (minor: number) => fromMinor(minor, input.decimals);
  const rows: ReportExportSheet["rows"] = input.lines.map((l) => ({
    name: l.name,
    sku: l.sku ?? "",
    quantity: l.quantity,
    cost: money(l.unitCostMinor),
    value: money(lineValueMinor(l.quantity, l.unitCostMinor)),
    sellsFor: l.sellsForMinor === null ? null : money(l.sellsForMinor),
  }));
  const counted = countedTotalMinor(input.lines);
  const total = (label: string, minor: number) => ({
    name: label,
    sku: "",
    quantity: null,
    cost: null,
    value: money(minor),
    sellsFor: null,
  });
  rows.push(total("Counted at cost", counted));
  if (input.bookMinor !== null) {
    rows.push(total("On the books", input.bookMinor));
    rows.push(total("Difference", countDifferenceMinor(counted, input.bookMinor)));
  }

  const subtitle = [
    `${input.countNumber}`,
    `As of ${input.asOf}`,
    stockCountStatusLabel(input.status),
    normalisedText(input.memo),
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return {
    fileName: sanitizeExportFileName(`stock-count-${input.countNumber}`),
    companyName: input.companyName,
    title: "Stock Count",
    subtitle,
    currencyCode: input.currencyCode,
    columns: [
      { key: "name", header: "Name", kind: "text", width: 40 },
      { key: "sku", header: "SKU", kind: "text", width: 16 },
      { key: "quantity", header: "Counted", kind: "number", width: 12 },
      { key: "cost", header: "Cost each", kind: "money", width: 14 },
      { key: "value", header: "Value", kind: "money", width: 16 },
      { key: "sellsFor", header: "Sells for", kind: "money", width: 14 },
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// The database's messages, in plain words
// ---------------------------------------------------------------------------

export const CLOSED_PERIOD_MESSAGE =
  "That date falls in a closed accounting period. Choose a later date, or reopen the period.";
export const TRACKS_ITEMS_MESSAGE =
  "This company keeps stock item by item. Adjust items on the Products & Services page instead.";
export const AGREES_MESSAGE = "The count agrees with the books.";

/**
 * Turn what the database raised into a sentence for the screen. Messages that
 * already read as plain sentences pass through unchanged.
 */
export function stockCountErrorMessage(raw: string): string {
  if (/accounting period for .* is closed/i.test(raw)) return CLOSED_PERIOD_MESSAGE;
  if (/tracks stock item by item/i.test(raw)) return TRACKS_ITEMS_MESSAGE;
  if (/already agrees with the books/i.test(raw)) return AGREES_MESSAGE;
  if (/not authorized to/i.test(raw)) return "You do not have permission to change stock counts";
  if (/do not have permission to adjust inventory/i.test(raw)) return "You do not have permission to adjust inventory";
  return raw;
}

// ---------------------------------------------------------------------------
// The screens: pasting, the Adjust button and the entry it will post
// ---------------------------------------------------------------------------

export const PASTE_HINT =
  "One line each: name, quantity, cost — and sells for, if you like. Pasting from a spreadsheet keeps the columns apart; in typed text leave out thousands separators.";

export const FOOTNOTE =
  "Periodic, on purpose: purchases go to cost of sales as they are made and the count corrects the balance sheet. This is a count sheet, not perpetual stock, so it does not track units in and out.";

export const SAVE_FIRST_MESSAGE = "Save the count first";

/** One problem found while reading a pasted sheet, as the screen lists it. */
export function pasteProblemText(problem: PasteProblem): string {
  return `Line ${problem.lineNumber}: ${problem.reason}`;
}

/** What "Read it" tells the reader: how many lines went in and how many did not. */
export function pasteSummary(result: PasteResult): string {
  const added = result.lines.length;
  const skipped = result.problems.length;
  const lines = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"}`;
  if (added === 0 && skipped === 0) return "Nothing to read. Paste one line for each item.";
  if (skipped === 0) return `Added ${lines(added)}.`;
  return `Added ${lines(added)}. ${lines(skipped)} could not be read and ${skipped === 1 ? "was" : "were"} left out.`;
}

/** The good lines of a paste go on the end of the sheet; nothing already there moves. */
export function appendCountLines<T extends StockCountLineInput>(current: readonly T[], added: readonly T[]): T[] {
  return [...current, ...added];
}

/** After a save, rows still exactly as they were sent take the trimmed name and SKU; every other row is left as the user has it. */
export function settleSavedRows<T extends { key: string; name: string; sku: string | null }>(
  current: readonly T[],
  sent: readonly T[],
  saved: readonly { name: string; sku: string | null }[],
): T[] {
  const settled = new Map<string, { sent: T; saved: { name: string; sku: string | null } }>();
  sent.forEach((row, i) => {
    const values = saved[i];
    if (values) settled.set(row.key, { sent: row, saved: values });
  });
  return current.map((row) => {
    const hit = settled.get(row.key);
    if (!hit || row.name !== hit.sent.name || row.sku !== hit.sent.sku) return row;
    return { ...row, name: hit.saved.name, sku: hit.saved.sku };
  });
}

export interface AdjustButtonInput {
  /** Holds inventory.adjust in this company. */
  canAdjust: boolean;
  /** The company keeps stock item by item. */
  tracksItems: boolean;
  /** The screen holds changes that are not saved. */
  dirty: boolean;
  /** Counted at cost less the books, with the lines as they are saved. */
  differenceMinor: number;
}

export interface AdjustButtonState {
  /** False for a person without inventory.adjust: the button is not drawn at all. */
  visible: boolean;
  disabled: boolean;
  /** Why it is disabled, in plain words; null when it can be pressed. */
  reason: string | null;
}

/**
 * Whether the "Adjust inventory by ..." button can be pressed. The checks run
 * in the order the database raises them: item tracking first (a company that
 * keeps stock by item cannot post a count at all), then unsaved changes (the
 * database posts the saved lines, not the screen's), then a zero difference.
 */
export function adjustButtonState(input: AdjustButtonInput): AdjustButtonState {
  if (!input.canAdjust) return { visible: false, disabled: true, reason: null };
  if (input.tracksItems) return { visible: true, disabled: true, reason: TRACKS_ITEMS_MESSAGE };
  if (input.dirty) return { visible: true, disabled: true, reason: SAVE_FIRST_MESSAGE };
  if (input.differenceMinor === 0) return { visible: true, disabled: true, reason: AGREES_MESSAGE };
  return { visible: true, disabled: false, reason: null };
}

/** "+$12.00" or "-$12.00"; a zero has no sign. `format` renders an absolute amount. */
export function signedAmountText(minor: number, format: (absoluteMinor: number) => string): string {
  if (minor === 0) return format(0);
  return `${minor > 0 ? "+" : "-"}${format(Math.abs(minor))}`;
}

/** The button's words: "Adjust inventory by +$12.00 at 2026-06-30". */
export function adjustButtonLabel(differenceMinor: number, asOf: string, format: (absoluteMinor: number) => string): string {
  return `Adjust inventory by ${signedAmountText(differenceMinor, format)} at ${asOf}`;
}

export interface PreviewAccount {
  code: string;
  name: string;
}

export interface EntryPreviewLine {
  side: "Dr" | "Cr";
  accountLabel: string;
  amountMinor: number;
}

/**
 * The entry a post would write, as acc_post_stock_count builds it: a positive
 * difference debits inventory and credits the offset account; a negative one
 * does the reverse. Null when there is nothing to post or an account is not chosen.
 */
export function entryPreview(
  differenceMinor: number,
  inventory: PreviewAccount | null,
  offset: PreviewAccount | null,
): EntryPreviewLine[] | null {
  if (differenceMinor === 0 || !inventory || !offset) return null;
  const amountMinor = Math.abs(differenceMinor);
  const up = differenceMinor > 0;
  const label = (a: PreviewAccount) => `${a.code} ${a.name}`;
  return [
    { side: up ? "Dr" : "Cr", accountLabel: label(inventory), amountMinor },
    { side: up ? "Cr" : "Dr", accountLabel: label(offset), amountMinor },
  ];
}

/**
 * How a difference (or an adjustment) is coloured, one rule for every screen:
 * a shortage is "shortage" (red), a surplus and zero are "neutral" (the normal
 * text colour). A surplus is good news for the books and is never red.
 */
export function differenceTone(minor: number): "shortage" | "neutral" {
  return minor < 0 ? "shortage" : "neutral";
}

/** Statuses whose lines can no longer be edited. */
export function isLocked(status: string): boolean {
  return status !== "draft";
}
