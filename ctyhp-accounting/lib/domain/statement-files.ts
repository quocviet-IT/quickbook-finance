/**
 * Reading the files banks hand out, other than CSV (statement-import.ts).
 *
 * OFX, QFX and QBO are one format under three names — SGML in version 1, XML in
 * version 2 — and QIF is Quicken's older line format. Pure: the browser reads
 * the file and these turn its text into statement lines. A record without a
 * readable date or amount is skipped and counted, never guessed at.
 */
import { normalizeStatementDate, parseStatementAmount, type DateOrder, type StatementLine } from "./statement-import";

export type StatementFormat = "csv" | "ofx" | "qif" | "pdf";

export const UNSUPPORTED_STATEMENT = "Save the statement as CSV from your bank, or download it as OFX or QFX.";

/** A PDF is read by its layout (pdf-statement.ts); a spreadsheet is not read at all. */
export function detectStatementFormat(fileName: string, text: string): { format: StatementFormat } | { unsupported: string } {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (["ofx", "qfx", "qbo"].includes(extension)) return { format: "ofx" };
  if (extension === "qif") return { format: "qif" };
  if (extension === "pdf") return { format: "pdf" };
  if (["xls", "xlsx", "xlsm", "numbers"].includes(extension)) return { unsupported: UNSUPPORTED_STATEMENT };
  if (text.startsWith("%PDF")) return { format: "pdf" };
  const head = text.slice(0, 2000);
  if (/OFXHEADER|<OFX>/i.test(head)) return { format: "ofx" };
  if (/^\s*!Type:/i.test(head)) return { format: "qif" };
  return { format: "csv" };
}

export interface StatementFileResult {
  rows: StatementLine[];
  skipped: number;
  /** The account number the file names, when it names one (OFX). */
  accountId: string | null;
  /**
   * OFX: the ledger balance the bank prints (LEDGERBAL's BALAMT) and the day it
   * is as of (DTASOF, as a date). Null when the file has none, or more than one
   * — a file of several statements cannot say which is which.
   */
  ledger?: { minor: number; asOf: string | null } | null;
  /** OFX: the first and last day the transaction list covers (BANKTRANLIST's DTSTART and DTEND), as dates. */
  periodStart?: string | null;
  periodEnd?: string | null;
  /** QIF: the amount of its "Opening Balance" record, which is the opening and not a line; null when it has none. */
  openingMinor?: number | null;
}

/** A name and a memo, the memo kept only when it says something the name does not. */
export function joinDescription(name: string | null, memo: string | null): string {
  const n = (name ?? "").trim();
  const m = (memo ?? "").trim();
  if (!n) return m;
  if (!m || n.toLowerCase().includes(m.toLowerCase())) return n;
  return `${n} ${m}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]).trim();

/** A leaf element's value: up to the next tag, or the end of an SGML line. */
function tag(block: string, name: string): string | null {
  const found = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  if (!found) return null;
  const value = decode(found[1]);
  return value === "" ? null : value;
}

function ofxDate(value: string | null): string | null {
  const parts = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!parts) return null;
  const [, year, month, day] = parts;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

export function parseOfx(text: string, decimals = 2): StatementFileResult {
  const rows: StatementLine[] = [];
  let skipped = 0;
  for (const block of text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? []) {
    const date = ofxDate(tag(block, "DTPOSTED"));
    const amount = parseStatementAmount(tag(block, "TRNAMT") ?? "", decimals);
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      txn_date: date,
      description: joinDescription(tag(block, "NAME"), tag(block, "MEMO")),
      reference: tag(block, "CHECKNUM") ?? tag(block, "REFNUM"),
      amount_minor: amount,
      running_balance_minor: null,
      raw_line: block.replace(/\s+/g, " ").trim().slice(0, 1000),
      external_id: tag(block, "FITID"),
    });
  }
  const account = text.match(/<(?:BANKACCTFROM|CCACCTFROM)>[\s\S]*?<ACCTID>([^<\r\n]*)/i);
  return { rows, skipped, accountId: account ? decode(account[1]) || null : null, ...ofxBalances(text, decimals) };
}

/**
 * What an OFX file says about its own period and balance. Dates only: a bank
 * writes 20260930120000.000[-5:EST] or 20261001, and the day is what counts —
 * a timestamp compared with a timestamp would put a balance struck at noon
 * after a list that ends at midnight. Read only when the file holds exactly one
 * statement, so a figure is never taken from the wrong one. AVAILBAL is not the
 * ledger balance and is never read.
 */
function ofxBalances(text: string, decimals: number): Pick<StatementFileResult, "ledger" | "periodStart" | "periodEnd"> {
  const ledgers = text.match(/<LEDGERBAL>[\s\S]*?<\/LEDGERBAL>/gi) ?? [];
  let ledger: StatementFileResult["ledger"] = null;
  if (ledgers.length === 1) {
    const amount = parseStatementAmount(tag(ledgers[0], "BALAMT") ?? "", decimals);
    if (amount !== null) ledger = { minor: amount, asOf: ofxDate(tag(ledgers[0], "DTASOF")) };
  }
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if ((text.match(/<BANKTRANLIST>/gi) ?? []).length === 1) {
    // The list's own dates come before its first transaction.
    const head = text.match(/<BANKTRANLIST>([\s\S]*?)(?:<STMTTRN>|<\/BANKTRANLIST>|$)/i)?.[1] ?? "";
    periodStart = ofxDate(tag(head, "DTSTART"));
    periodEnd = ofxDate(tag(head, "DTEND"));
  }
  return { ledger, periodStart, periodEnd };
}

/** An "Opening Balance" record: the account's opening, written by Quicken as if it were a payment. */
const isOpeningBalance = (payee: string | null) => (payee ?? "").trim().toLowerCase() === "opening balance";

const QIF_SECTIONS = new Set(["bank", "cash", "ccard"]);

/** `9/30'26` and `9/5' 6` (Quicken, from 2000), `09/22/2026`, `9/22/26`, and ISO. */
function qifDate(raw: string, order: DateOrder): string | null {
  const value = raw.replace(/\s+/g, "");
  const parts = value.match(/^(\d{1,2})[/.-](\d{1,2})(?:'(\d{1,2})|[/.-](\d{2}|\d{4}))$/);
  if (!parts) return normalizeStatementDate(value, order);
  const [, first, second, apostropheYear, year] = parts;
  let fullYear: number;
  if (apostropheYear !== undefined) fullYear = 2000 + Number(apostropheYear);
  else if (year.length === 4) fullYear = Number(year);
  else fullYear = Number(year) < 70 ? 2000 + Number(year) : 1900 + Number(year);
  return normalizeStatementDate(`${first}/${second}/${fullYear}`, order);
}

export function parseQif(text: string, options: { decimals?: number; dateOrder?: DateOrder } = {}): StatementFileResult {
  const decimals = options.decimals ?? 2;
  const order = options.dateOrder ?? "mdy";
  const rows: StatementLine[] = [];
  let skipped = 0;
  let section: string | null = null;
  let fields: string[] = [];
  const openings: number[] = [];

  const flush = () => {
    if (fields.length === 0) return;
    const record = fields;
    fields = [];
    // An account list describes accounts, not money; it is neither read nor counted.
    if (section === "account") return;
    if (!section || !QIF_SECTIONS.has(section)) {
      skipped += 1;
      return;
    }
    const field = (code: string) => {
      const line = record.find((l) => l[0] === code);
      return line === undefined ? null : line.slice(1).trim();
    };
    const rawDate = field("D");
    const date = rawDate === null ? null : qifDate(rawDate, order);
    const amount = parseStatementAmount(field("T") ?? field("U") ?? "", decimals);
    if (!date || amount === null) {
      skipped += 1;
      return;
    }
    // The opening, not a line (2.04). Imported as a line, it would be money
    // that never moved.
    if (isOpeningBalance(field("P"))) {
      openings.push(amount);
      return;
    }
    rows.push({
      txn_date: date,
      description: joinDescription(field("P"), field("M")),
      reference: field("N") || null,
      amount_minor: amount,
      running_balance_minor: null,
      raw_line: record.join("|").slice(0, 1000),
      external_id: null,
    });
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") continue;
    if (line.startsWith("!")) {
      flush();
      const type = line.match(/^!Type:(\w+)/i);
      if (type) section = type[1].toLowerCase();
      else if (/^!Account/i.test(line)) section = "account";
      continue;
    }
    if (line === "^") {
      flush();
      continue;
    }
    fields.push(line);
  }
  flush();
  // Two such records (a file of several accounts) cannot say which opens this
  // statement, so neither is taken: the person types the opening instead.
  return { rows, skipped, accountId: null, openingMinor: openings.length === 1 ? openings[0] : null };
}

/** Does the file name a different account from the one chosen? Only when both give at least four digits. */
export function accountNumberDiffers(fileAccountId: string | null, maskedNumber: string | null): boolean {
  const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
  const inFile = digits(fileAccountId);
  const chosen = digits(maskedNumber);
  if (inFile.length < 4 || chosen.length < 4) return false;
  return inFile.slice(-4) !== chosen.slice(-4);
}
