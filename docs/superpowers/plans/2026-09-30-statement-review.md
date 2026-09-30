# Statement Upload That Categorises Itself — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bank statement uploaded as CSV, OFX, QFX, QBO or QIF lands on a Review import screen where every line already carries a proposal — a ledger match, an invoice or bill it pays, a rule or history — and the ticked lines post in one click.

**Architecture:** Pure readers in `lib/domain/statement-files.ts` and `statement-import.ts` turn a file into statement lines in the browser; the existing import RPC inserts them as waiting lines and returns the batch; `lib/domain/statement-review.ts` decides one proposal per line from facts a new service reads; posting walks the ticked lines through the existing match, settle and categorise RPCs, fifty at a time.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, Zod 4, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-statement-upload-review-design.md`. Branch `feat/statement-review` from `main` at 1.70. Release **1.71**.

## Global Constraints

- Nothing is posted without a person's click. Lines with nothing proposed or chosen are imported and left waiting — never posted to a holding account.
- One proposal per line, first that applies: handled (pending or not `unmatched`) → ledger match → exactly one open invoice/bill of the same currency whose balance due equals the amount → rule → history → needs coding. Two or more such documents: no proposal, and rules and history are not consulted.
- Posting: at most **50** items per server call; each item through `acc_decide_bank_match` (approved), `acc_settle_from_bank_transaction` (one allocation of the whole amount, method null) or `acc_categorise_bank_transaction`; a refusal is reported verbatim and the rest continue.
- The OFX duplicate key is `statementRowHash([bankAccountId, "fitid", FITID])`; lines without an external id keep `statementRowHash([bankAccountId, txn_date, amount_minor, description, reference])` so earlier imports still de-duplicate.
- No migration. US English UI. No hex colour in source. New tables use `DataTable`. List reads page with `readAllPages` and a total order. `page.tsx` never reads an Ant Design sub-component.
- Test fixtures are invented; no real client names or data in the repo.
- Commits: stage by name; one-line subject written with `printf` to `$SCRATCH/msg.txt` and `git commit -F`; **no Co-Authored-By trailer**. Write files containing backslashes with the Write/Edit tool.
- Run commands from `ctyhp-accounting/`.

---

### Task 1: CSV columns, date order and flipped signs

**Files:**
- Modify: `ctyhp-accounting/lib/domain/statement-import.ts`
- Test: `ctyhp-accounting/tests/unit/statement-columns-map.test.ts`

**Interfaces:**
- Produces: `StatementLine.external_id?: string | null`; `interface StatementColumnMap { date; description; amount; moneyOut; moneyIn; reference; balance }` (each `string | null`, lower-cased header names); `type DateOrder = "mdy" | "dmy"`; `detectStatementColumns(headers: readonly string[]): { columns: StatementColumnMap; complete: boolean }`; `statementColumnsComplete(columns): boolean`; `detectDateOrder(values: readonly string[]): DateOrder`; `parseStatementRows(records, { decimals?, dateOrder?, columns?, flipSigns? })`.

- [ ] **Step 1: Write the failing test** — `tests/unit/statement-columns-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
} from "@/lib/domain/statement-import";

describe("detectStatementColumns", () => {
  it("recognises the headings banks use, and says when it has enough", () => {
    const found = detectStatementColumns(["posting date", "details", "paid out", "paid in", "balance"]);
    expect(found.columns).toEqual({
      date: "posting date",
      description: "details",
      amount: null,
      moneyOut: "paid out",
      moneyIn: "paid in",
      reference: null,
      balance: "balance",
    });
    expect(found.complete).toBe(true);
  });
  it("says so when it cannot find a date or an amount", () => {
    expect(detectStatementColumns(["when", "what", "how much"]).complete).toBe(false);
    expect(statementColumnsComplete({ date: "when", description: null, amount: null, moneyOut: null, moneyIn: null, reference: null, balance: null })).toBe(false);
  });
});

describe("parseStatementRows with chosen columns", () => {
  const records = [
    { when: "03/04/2026", what: "Harbor Power & Light", "how much": "-312.40", ref: "A1" },
    { when: "13/04/2026", what: "Customer deposit", "how much": "1,250.00", ref: "" },
  ];
  const columns = { date: "when", description: "what", amount: "how much", moneyOut: null, moneyIn: null, reference: "ref", balance: null };

  it("reads the columns it was told to, in the date order it was told", () => {
    const result = parseStatementRows(records, { columns, dateOrder: "dmy" });
    expect(result.skipped).toBe(0);
    expect(result.rows.map((r) => [r.txn_date, r.description, r.amount_minor, r.reference])).toEqual([
      ["2026-04-03", "Harbor Power & Light", -31240, "A1"],
      ["2026-04-13", "Customer deposit", 125000, null],
    ]);
  });
  it("flips signs for a file that writes payments as positive", () => {
    const result = parseStatementRows(records, { columns, dateOrder: "dmy", flipSigns: true });
    expect(result.rows.map((r) => r.amount_minor)).toEqual([31240, -125000]);
  });
  it("reads money out and money in columns when chosen", () => {
    const split = [{ d: "2026-09-01", n: "Rent", o: "2,400.00", i: "" }, { d: "2026-09-02", n: "Refund", o: "", i: "15.00" }];
    const result = parseStatementRows(split, {
      columns: { date: "d", description: "n", amount: null, moneyOut: "o", moneyIn: "i", reference: null, balance: null },
    });
    expect(result.rows.map((r) => r.amount_minor)).toEqual([-240000, 1500]);
  });
  it("still guesses the columns when none are chosen", () => {
    const result = parseStatementRows([{ date: "2026-09-01", description: "Rent", amount: "-10.00" }]);
    expect(result.rows[0].amount_minor).toBe(-1000);
  });
});

describe("detectDateOrder", () => {
  it("reads a first number over 12 as a day, and a second one as a month's day", () => {
    expect(detectDateOrder(["03/04/2026", "13/04/2026"])).toBe("dmy");
    expect(detectDateOrder(["03/04/2026", "04/15/2026"])).toBe("mdy");
  });
  it("falls back to month first when nothing tells", () => {
    expect(detectDateOrder(["03/04/2026", "2026-04-03", ""])).toBe("mdy");
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/unit/statement-columns-map.test.ts` → FAIL (`detectStatementColumns` is not exported).

- [ ] **Step 3: Implement** in `lib/domain/statement-import.ts`:

  - add to `StatementLine` after `raw_line`:

```ts
  /** The bank's own id for the transaction (OFX FITID), when the file carries one. */
  external_id?: string | null;
```

  - after the `*_KEYS` constants and `pick`, add:

```ts
export type DateOrder = "mdy" | "dmy";

/** Which heading holds what. Headings are lower-cased, as `parseCsv` gives them. */
export interface StatementColumnMap {
  date: string | null;
  description: string | null;
  amount: string | null;
  moneyOut: string | null;
  moneyIn: string | null;
  reference: string | null;
  balance: string | null;
}

/** Enough to read a line: a date, and an amount in one column or two. */
export function statementColumnsComplete(columns: StatementColumnMap): boolean {
  return Boolean(columns.date && (columns.amount || columns.moneyOut || columns.moneyIn));
}

/** The headings this file uses for each fact, as far as the usual names go. */
export function detectStatementColumns(headers: readonly string[]): { columns: StatementColumnMap; complete: boolean } {
  const find = (keys: readonly string[]) => keys.find((key) => headers.includes(key)) ?? null;
  const columns: StatementColumnMap = {
    date: find(DATE_KEYS),
    description: find(DESCRIPTION_KEYS),
    amount: find(AMOUNT_KEYS),
    moneyOut: find(DEBIT_KEYS),
    moneyIn: find(CREDIT_KEYS),
    reference: find(REFERENCE_KEYS),
    balance: find(BALANCE_KEYS),
  };
  return { columns, complete: statementColumnsComplete(columns) };
}

/**
 * Which way round a file writes its dates. A first number over 12 can only be
 * a day; a second one over 12 can only be a day too, so month comes first.
 * With nothing to tell, month first — the US form, and the prototype's.
 */
export function detectDateOrder(values: readonly string[]): DateOrder {
  for (const value of values) {
    const parts = (value ?? "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/);
    if (!parts) continue;
    if (Number(parts[1]) > 12) return "dmy";
    if (Number(parts[2]) > 12) return "mdy";
  }
  return "mdy";
}
```

  - replace `parseStatementRows` with:

```ts
export function parseStatementRows(
  records: readonly Record<string, string>[],
  options: { decimals?: number; dateOrder?: DateOrder; columns?: StatementColumnMap; flipSigns?: boolean } = {},
): StatementParseResult {
  const decimals = options.decimals ?? 2;
  const chosen = options.columns;
  // Chosen columns are read as chosen; otherwise every usual heading is tried.
  const keys = (column: string | null | undefined, usual: readonly string[]) =>
    chosen ? (column ? [column] : []) : usual;
  const rows: StatementLine[] = [];
  let skipped = 0;

  for (const record of records) {
    const date = normalizeStatementDate(pick(record, keys(chosen?.date, DATE_KEYS)), options.dateOrder ?? "mdy");

    let amount = parseStatementAmount(pick(record, keys(chosen?.amount, AMOUNT_KEYS)), decimals);
    if (amount === null) {
      const debit = parseStatementAmount(pick(record, keys(chosen?.moneyOut, DEBIT_KEYS)), decimals);
      const credit = parseStatementAmount(pick(record, keys(chosen?.moneyIn, CREDIT_KEYS)), decimals);
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }

    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    if (options.flipSigns) amount = -amount;

    rows.push({
      txn_date: date,
      description: pick(record, keys(chosen?.description, DESCRIPTION_KEYS)),
      reference: pick(record, keys(chosen?.reference, REFERENCE_KEYS)) || null,
      amount_minor: amount,
      running_balance_minor: parseStatementAmount(pick(record, keys(chosen?.balance, BALANCE_KEYS)), decimals),
      raw_line: Object.values(record).join(","),
    });
  }

  return { rows, skipped };
}
```

  (`DATE_KEYS` and the other key lists must be declared above `parseStatementRows`; move them up if they sit below it.)

- [ ] **Step 4: Run** `npx vitest run tests/unit/statement-columns-map.test.ts tests/unit/statement-import.test.ts` → PASS (the existing statement-import tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/statement-import.ts tests/unit/statement-columns-map.test.ts
printf '%s\n' "feat(statements): choose a CSV's columns, its date order and its signs" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 2: OFX, QFX, QBO and QIF

**Files:**
- Create: `ctyhp-accounting/lib/domain/statement-files.ts`
- Modify: `ctyhp-accounting/lib/domain/banking-import.ts` (add `statementLineHash`)
- Test: `ctyhp-accounting/tests/unit/statement-files.test.ts`

**Interfaces:**
- Consumes: `normalizeStatementDate`, `parseStatementAmount`, `StatementLine`, `DateOrder` (Task 1).
- Produces: `type StatementFormat = "csv" | "ofx" | "qif"`; `detectStatementFormat(fileName, text): { format: StatementFormat } | { unsupported: string }`; `UNSUPPORTED_STATEMENT`; `interface StatementFileResult { rows: StatementLine[]; skipped: number; accountId: string | null }`; `parseOfx(text, decimals?)`; `parseQif(text, { decimals?, dateOrder? })`; `joinDescription(name, memo)`; `accountNumberDiffers(fileAccountId, maskedNumber)`; in banking-import: `statementLineHash(bankAccountId, line: { txn_date; amount_minor; description; reference; external_id? }): string`.

- [ ] **Step 1: Write the failing test** — `tests/unit/statement-files.test.ts` (Write tool):

```ts
import { describe, expect, it } from "vitest";
import { statementLineHash, statementRowHash } from "@/lib/domain/banking-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  joinDescription,
  parseOfx,
  parseQif,
  UNSUPPORTED_STATEMENT,
} from "@/lib/domain/statement-files";

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>000000000<ACCTID>99004821<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260915120000[-5:EST]
<TRNAMT>-6850.00
<FITID>2026091501
<NAME>PAYFLOW PAYROLL
<MEMO>PAYROLL 0915
</STMTTRN>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20260918
<TRNAMT>-312.40
<FITID>2026091802
<CHECKNUM>1042
<NAME>HARBOR POWER &amp; LIGHT
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>not-a-date
<TRNAMT>-1.00
<FITID>bad
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111000011112222</ACCTID></CCACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260920</DTPOSTED><TRNAMT>1250.00</TRNAMT>
<FITID>X-77</FITID><NAME>CUSTOMER DEPOSIT</NAME><REFNUM>R-9</REFNUM></STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe("detectStatementFormat", () => {
  it("goes by the extension first", () => {
    expect(detectStatementFormat("sept.QFX", "")).toEqual({ format: "ofx" });
    expect(detectStatementFormat("sept.qbo", "")).toEqual({ format: "ofx" });
    expect(detectStatementFormat("sept.qif", "")).toEqual({ format: "qif" });
    expect(detectStatementFormat("sept.csv", "")).toEqual({ format: "csv" });
    expect(detectStatementFormat("sept.pdf", "")).toEqual({ unsupported: UNSUPPORTED_STATEMENT });
    expect(detectStatementFormat("sept.xlsx", "")).toEqual({ unsupported: UNSUPPORTED_STATEMENT });
  });
  it("looks inside a file whose name says nothing", () => {
    expect(detectStatementFormat("download", SGML)).toEqual({ format: "ofx" });
    expect(detectStatementFormat("download", "!Type:Bank\nD9/30'26\n^")).toEqual({ format: "qif" });
    expect(detectStatementFormat("download", "%PDF-1.7")).toEqual({ unsupported: UNSUPPORTED_STATEMENT });
    expect(detectStatementFormat("download.txt", "date,amount")).toEqual({ format: "csv" });
  });
});

describe("parseOfx", () => {
  it("reads SGML: dates, signed amounts, names, memos, cheque numbers and the bank's own id", () => {
    const result = parseOfx(SGML);
    expect(result.accountId).toBe("99004821");
    expect(result.skipped).toBe(1);
    expect(result.rows.map((r) => [r.txn_date, r.amount_minor, r.description, r.reference, r.external_id])).toEqual([
      ["2026-09-15", -685000, "PAYFLOW PAYROLL", null, "2026091501"],
      ["2026-09-18", -31240, "HARBOR POWER & LIGHT", "1042", "2026091802"],
    ]);
  });
  it("reads XML, and a card statement's account", () => {
    const result = parseOfx(XML);
    expect(result.accountId).toBe("4111000011112222");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ txn_date: "2026-09-20", amount_minor: 125000, description: "CUSTOMER DEPOSIT", reference: "R-9", external_id: "X-77" });
  });
  it("finds nothing in a file with no transactions", () => {
    expect(parseOfx("<OFX></OFX>")).toEqual({ rows: [], skipped: 0, accountId: null });
  });
});

describe("parseQif", () => {
  const QIF = [
    "!Account",
    "NOperating",
    "TBank",
    "^",
    "!Type:Bank",
    "D9/30'26",
    "T-15.00",
    "PMONTHLY SERVICE FEE",
    "^",
    "D09/22/2026",
    "U-1,250.00",
    "PNORTHWIND SUPPLY CO",
    "MWIRE",
    "N2231",
    "^",
    "D9/5' 6",
    "T100.00",
    "POLD DEPOSIT",
    "^",
    "Dgarbage",
    "T1.00",
    "^",
    "!Type:Invst",
    "D9/30'26",
    "T5.00",
    "^",
  ].join("\n");

  it("reads bank records in both year forms, T or U, payee, memo and number", () => {
    const result = parseQif(QIF);
    expect(result.rows.map((r) => [r.txn_date, r.amount_minor, r.description, r.reference])).toEqual([
      ["2026-09-30", -1500, "MONTHLY SERVICE FEE", null],
      ["2026-09-22", -125000, "NORTHWIND SUPPLY CO WIRE", "2231"],
      ["2006-09-05", 10000, "OLD DEPOSIT", null],
    ]);
  });
  it("skips and counts unreadable records and sections that are not bank, cash or card", () => {
    expect(parseQif(QIF).skipped).toBe(2);
  });
});

describe("joinDescription", () => {
  it("adds the memo only when it says something the name does not", () => {
    expect(joinDescription("PAYFLOW PAYROLL", "PAYROLL")).toBe("PAYFLOW PAYROLL");
    expect(joinDescription("NORTHWIND", "WIRE")).toBe("NORTHWIND WIRE");
    expect(joinDescription(null, "WIRE")).toBe("WIRE");
  });
});

describe("accountNumberDiffers", () => {
  it("compares the last four digits when both sides have them", () => {
    expect(accountNumberDiffers("99004821", "••4821")).toBe(false);
    expect(accountNumberDiffers("99004822", "••4821")).toBe(true);
    expect(accountNumberDiffers("99004822", null)).toBe(false);
    expect(accountNumberDiffers(null, "••4821")).toBe(false);
  });
});

describe("statementLineHash", () => {
  const base = { txn_date: "2026-09-15", amount_minor: -685000, description: "PAYFLOW PAYROLL", reference: null };
  it("keys a line with a bank id on that id, so a reworded re-download is the same line", () => {
    expect(statementLineHash("acct", { ...base, external_id: "F1" })).toBe(
      statementLineHash("acct", { ...base, description: "PAYFLOW PAYROLL 0915", external_id: "F1" }),
    );
  });
  it("keys a line without one exactly as imports always have", () => {
    expect(statementLineHash("acct", base)).toBe(statementRowHash(["acct", "2026-09-15", -685000, "PAYFLOW PAYROLL", null]));
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/unit/statement-files.test.ts` → FAIL (module not found).

- [ ] **Step 3: Add the hash** to `lib/domain/banking-import.ts`, after `statementRowHash`:

```ts
/**
 * The duplicate key of one statement line. A line that carries the bank's own
 * id (OFX FITID) is keyed on it, so a re-downloaded file is recognised even when
 * the bank rewords a description; any other line is keyed as imports always
 * have been, so it still meets the lines imported before.
 */
export function statementLineHash(
  bankAccountId: string,
  line: { txn_date: string; amount_minor: number; description: string; reference: string | null; external_id?: string | null },
): string {
  return line.external_id
    ? statementRowHash([bankAccountId, "fitid", line.external_id])
    : statementRowHash([bankAccountId, line.txn_date, line.amount_minor, line.description, line.reference]);
}
```

- [ ] **Step 4: Write** `lib/domain/statement-files.ts` (Write tool):

```ts
/**
 * Reading the files banks hand out, other than CSV (statement-import.ts).
 *
 * OFX, QFX and QBO are one format under three names — SGML in version 1, XML in
 * version 2 — and QIF is Quicken's older line format. Pure: the browser reads
 * the file and these turn its text into statement lines. A record without a
 * readable date or amount is skipped and counted, never guessed at.
 */
import { normalizeStatementDate, parseStatementAmount, type DateOrder, type StatementLine } from "./statement-import";

export type StatementFormat = "csv" | "ofx" | "qif";

export const UNSUPPORTED_STATEMENT = "Save the statement as CSV from your bank, or download it as OFX or QFX.";

export function detectStatementFormat(fileName: string, text: string): { format: StatementFormat } | { unsupported: string } {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (["ofx", "qfx", "qbo"].includes(extension)) return { format: "ofx" };
  if (extension === "qif") return { format: "qif" };
  if (["pdf", "xls", "xlsx", "xlsm", "numbers"].includes(extension)) return { unsupported: UNSUPPORTED_STATEMENT };
  if (text.startsWith("%PDF")) return { unsupported: UNSUPPORTED_STATEMENT };
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
  return { rows, skipped, accountId: account ? decode(account[1]) || null : null };
}

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
  return { rows, skipped, accountId: null };
}

/** Does the file name a different account from the one chosen? Only when both give at least four digits. */
export function accountNumberDiffers(fileAccountId: string | null, maskedNumber: string | null): boolean {
  const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
  const inFile = digits(fileAccountId);
  const chosen = digits(maskedNumber);
  if (inFile.length < 4 || chosen.length < 4) return false;
  return inFile.slice(-4) !== chosen.slice(-4);
}
```

- [ ] **Step 5: Run** `npx vitest run tests/unit/statement-files.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -- lib/domain/statement-files.ts lib/domain/banking-import.ts tests/unit/statement-files.test.ts
printf '%s\n' "feat(statements): read OFX, QFX, QBO and QIF, keyed on the bank's own id" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 3: One proposal per line

**Files:**
- Create: `ctyhp-accounting/lib/domain/statement-review.ts`
- Test: `ctyhp-accounting/tests/unit/statement-review.test.ts`

**Interfaces:**
- Consumes: `CodingSuggestionView` (lib/domain/coding.ts, 1.70).
- Produces: `REVIEW_POST_CHUNK = 50`; `ReviewLineFacts { id; status; pending; amountMinor; currencyCode }`; `ReviewMatch { reconciliationId; entryNumber }`; `ReviewDocument { documentId; documentNumber; partyName; balanceDueMinor; currencyCode; direction: "receivable" | "payable" }`; `ReviewProposal` union (`handled` | `match` | `document` | `account` | `none`, each with `why`, and `label` on the three postable kinds); `reviewProposal(input)`; `ReviewPostItem` union; `proposalValue(p): string | null`; `itemFromValue(transactionId, value): ReviewPostItem | null`; `chunked<T>(items, size?): T[][]`.

- [ ] **Step 1: Write the failing test** — `tests/unit/statement-review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import {
  chunked,
  itemFromValue,
  proposalValue,
  REVIEW_POST_CHUNK,
  reviewProposal,
  type ReviewDocument,
} from "@/lib/domain/statement-review";

const line = (amountMinor: number, over: Partial<{ status: string; pending: boolean }> = {}) => ({
  id: "t1",
  status: "unmatched",
  pending: false,
  amountMinor,
  currencyCode: "USD",
  ...over,
});
const doc = (id: string, balanceDueMinor: number, direction: "receivable" | "payable" = "receivable"): ReviewDocument => ({
  documentId: id,
  documentNumber: `INV-${id}`,
  partyName: "Acme Retail",
  balanceDueMinor,
  currencyCode: "USD",
  direction,
});
const coding: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-rent",
  accountLabel: "6100 — Rent Expense",
  source: "history",
  short: "2 of 2",
  why: 'Coded to 6100 Rent Expense 2 of the last 2 times for "metro realty"',
};

describe("reviewProposal", () => {
  it("leaves alone a line already handled or still pending", () => {
    expect(reviewProposal({ line: line(-100, { status: "matched" }), match: null, documents: [], coding }).kind).toBe("handled");
    expect(reviewProposal({ line: line(-100, { pending: true }), match: null, documents: [], coding }).kind).toBe("handled");
  });
  it("puts a ledger match first", () => {
    const p = reviewProposal({ line: line(125000), match: { reconciliationId: "r1", entryNumber: "JE-000123" }, documents: [doc("1", 125000)], coding });
    expect(p).toMatchObject({ kind: "match", reconciliationId: "r1", label: "Already in the books · JE-000123" });
  });
  it("offers the one open document of exactly this amount, on the right side", () => {
    expect(reviewProposal({ line: line(125000), match: null, documents: [doc("1", 125000), doc("2", 125000, "payable")], coding })).toMatchObject({
      kind: "document",
      documentId: "1",
      label: "Pays INV-1 · Acme Retail",
    });
  });
  it("offers no document, and no account, when two documents have this amount", () => {
    const p = reviewProposal({ line: line(125000), match: null, documents: [doc("1", 125000), doc("2", 125000)], coding });
    expect(p).toEqual({ kind: "none", why: "2 open invoices of this amount — use Settle on Bank Transactions" });
  });
  it("ignores documents of another currency or amount, then takes a rule or history", () => {
    const other = { ...doc("3", 125000), currencyCode: "EUR" };
    expect(reviewProposal({ line: line(125000), match: null, documents: [other, doc("4", 99)], coding })).toMatchObject({
      kind: "account",
      accountId: "acct-rent",
      label: "6100 — Rent Expense",
      why: coding.why,
    });
  });
  it("says a line needs coding when nothing applies", () => {
    expect(reviewProposal({ line: line(-100), match: null, documents: [], coding: null }).kind).toBe("none");
  });
});

describe("the Post as value", () => {
  it("round-trips each postable proposal, and an account a person picked", () => {
    expect(itemFromValue("t1", proposalValue({ kind: "match", reconciliationId: "r1", label: "", why: "" }))).toEqual({ transactionId: "t1", kind: "match", reconciliationId: "r1" });
    expect(itemFromValue("t1", proposalValue({ kind: "document", documentId: "d1", label: "", why: "" }))).toEqual({ transactionId: "t1", kind: "document", documentId: "d1" });
    expect(itemFromValue("t1", "account:a1")).toEqual({ transactionId: "t1", kind: "account", accountId: "a1" });
  });
  it("has no value for a line with nothing to post", () => {
    expect(proposalValue({ kind: "none", why: "" })).toBeNull();
    expect(itemFromValue("t1", null)).toBeNull();
    expect(itemFromValue("t1", "bogus:x")).toBeNull();
  });
});

describe("chunked", () => {
  it("posts fifty at a time", () => {
    expect(REVIEW_POST_CHUNK).toBe(50);
    expect(chunked(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)).toEqual([50, 50, 20]);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — FAIL, module not found.

- [ ] **Step 3: Write** `lib/domain/statement-review.ts`:

```ts
/**
 * The one proposal each line of an imported statement gets on Review import.
 *
 * First that applies: a line already handled or still pending is left alone;
 * then a match to an entry already in the books; then the one open invoice or
 * bill whose balance is exactly this amount; then a rule or history (1.70).
 * Two open documents of the same amount give no proposal at all — money that
 * probably pays a document must not be coded to income or expense.
 */
import type { CodingSuggestionView } from "./coding";

export const REVIEW_POST_CHUNK = 50;

export interface ReviewLineFacts {
  id: string;
  status: string;
  pending: boolean;
  amountMinor: number;
  currencyCode: string;
}

export interface ReviewMatch {
  reconciliationId: string;
  entryNumber: string | null;
}

export interface ReviewDocument {
  documentId: string;
  documentNumber: string | null;
  partyName: string;
  balanceDueMinor: number;
  currencyCode: string;
  direction: "receivable" | "payable";
}

export type ReviewProposal =
  | { kind: "handled"; why: string }
  | { kind: "match"; reconciliationId: string; label: string; why: string }
  | { kind: "document"; documentId: string; label: string; why: string }
  | { kind: "account"; accountId: string; label: string; why: string }
  | { kind: "none"; why: string };

export function reviewProposal(input: {
  line: ReviewLineFacts;
  match: ReviewMatch | null;
  documents: readonly ReviewDocument[];
  coding: CodingSuggestionView | null;
}): ReviewProposal {
  const { line, match, documents, coding } = input;
  if (line.pending) return { kind: "handled", why: "Pending at the bank — it can be posted once it clears" };
  if (line.status !== "unmatched") return { kind: "handled", why: "Already handled on Bank Transactions" };
  if (match) {
    return {
      kind: "match",
      reconciliationId: match.reconciliationId,
      label: `Already in the books · ${match.entryNumber ?? "entry"}`,
      why: "This amount is already posted to the bank account; posting approves the match and adds no entry",
    };
  }
  const direction = line.amountMinor > 0 ? "receivable" : line.amountMinor < 0 ? "payable" : null;
  const noun = direction === "payable" ? "bill" : "invoice";
  const exact = direction
    ? documents.filter(
        (d) => d.direction === direction && d.currencyCode === line.currencyCode && d.balanceDueMinor === Math.abs(line.amountMinor),
      )
    : [];
  if (exact.length === 1) {
    const [only] = exact;
    return {
      kind: "document",
      documentId: only.documentId,
      label: `Pays ${only.documentNumber ?? noun} · ${only.partyName}`,
      why: `The only open ${noun} for exactly this amount`,
    };
  }
  if (exact.length > 1) {
    return { kind: "none", why: `${exact.length} open ${noun}s of this amount — use Settle on Bank Transactions` };
  }
  if (coding) return { kind: "account", accountId: coding.accountId, label: coding.accountLabel, why: coding.why };
  return { kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" };
}

export type ReviewPostItem =
  | { transactionId: string; kind: "match"; reconciliationId: string }
  | { transactionId: string; kind: "document"; documentId: string }
  | { transactionId: string; kind: "account"; accountId: string };

/** The Post as picker holds one string per line: the proposal's own, or an account a person picked. */
export function proposalValue(proposal: ReviewProposal): string | null {
  if (proposal.kind === "match") return `match:${proposal.reconciliationId}`;
  if (proposal.kind === "document") return `document:${proposal.documentId}`;
  if (proposal.kind === "account") return `account:${proposal.accountId}`;
  return null;
}

export function itemFromValue(transactionId: string, value: string | null): ReviewPostItem | null {
  if (!value) return null;
  const colon = value.indexOf(":");
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (colon < 1 || !id) return null;
  if (kind === "match") return { transactionId, kind, reconciliationId: id };
  if (kind === "document") return { transactionId, kind, documentId: id };
  if (kind === "account") return { transactionId, kind, accountId: id };
  return null;
}

export function chunked<T>(items: readonly T[], size = REVIEW_POST_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/statement-review.ts tests/unit/statement-review.test.ts
printf '%s\n' "feat(statements): one proposal per imported line — a match, a document, a rule or history" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 4: Services — the import's batch, the review, and posting

**Files:**
- Modify: `ctyhp-accounting/lib/services/banking.ts` (`ImportRow`, `importStatement`)
- Create: `ctyhp-accounting/lib/services/statement-review.ts`
- Test: `ctyhp-accounting/tests/unit/statement-review-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `listBankAccounts`, `listSuggestions`, `approveReconciliation`, `settleFromBankTransaction`, `categoriseBankTransaction` (banking.ts); `listBankRules`, `loadHistory`, `suggestionsFrom` (coding.ts); `listAccounts`; `readAllPages`.
- Produces: `importStatement(...)` → `{ inserted; skipped; batchId: string | null }`; `StatementReviewError`; `ReviewBatch`, `ReviewLineView`, `ImportReview`; `loadImportReview(sb, batchId): Promise<ImportReview | null>`; `ReviewOutcome { id; ok; detail?; error? }`; `ReviewPostDeps`; `postReviewItems(sb, items, deps?)`.

- [ ] **Step 1: Write the failing test** — `tests/unit/statement-review-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { postReviewItems, type ReviewPostDeps } from "@/lib/services/statement-review";

const sb = {} as SupabaseClient;
const deps = (over: Partial<ReviewPostDeps> = {}): ReviewPostDeps => ({
  lineState: vi.fn(async () => ({ status: "unmatched", pending: false, amountMinor: -125000 })),
  matchOf: vi.fn(async (_sb: SupabaseClient, id: string) => ({ bankTransactionId: "t1", status: id === "r1" ? "suggested" : "approved" })),
  approve: vi.fn(async () => undefined),
  settle: vi.fn(async () => "pay-1"),
  categorise: vi.fn(async () => ({ entry_number: "JE-000010" })),
  ...over,
});

describe("postReviewItems", () => {
  it("posts each kind through its own call", async () => {
    const d = deps();
    const outcomes = await postReviewItems(
      sb,
      [
        { transactionId: "t1", kind: "match", reconciliationId: "r1" },
        { transactionId: "t1", kind: "document", documentId: "bill-1" },
        { transactionId: "t1", kind: "account", accountId: "acct-1" },
      ],
      d,
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: true, detail: "Matched" },
      { id: "t1", ok: true, detail: "Settled" },
      { id: "t1", ok: true, detail: "JE-000010" },
    ]);
    expect(d.approve).toHaveBeenCalledWith(sb, "r1");
    expect(d.settle).toHaveBeenCalledWith(sb, {
      bankTransactionId: "t1",
      allocations: [{ document_id: "bill-1", amount_minor: 125000 }],
      method: null,
      memo: null,
    });
    expect(d.categorise).toHaveBeenCalledWith(sb, "t1", "acct-1");
  });

  it("posts nothing for a line that is gone or already handled", async () => {
    const gone = deps({ lineState: vi.fn(async () => null) });
    expect((await postReviewItems(sb, [{ transactionId: "t1", kind: "account", accountId: "a" }], gone))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/no longer/) });
    const handled = deps({ lineState: vi.fn(async () => ({ status: "matched", pending: false, amountMinor: 1 })) });
    expect((await postReviewItems(sb, [{ transactionId: "t1", kind: "account", accountId: "a" }], handled))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/already handled/) });
    expect(handled.categorise).not.toHaveBeenCalled();
  });

  it("refuses a match that is not this line's, or no longer on offer", async () => {
    const d = deps();
    const [outcome] = await postReviewItems(sb, [{ transactionId: "t1", kind: "match", reconciliationId: "r2" }], d);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/no longer on offer/) });
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("reports a refusal word for word and carries on", async () => {
    const d = deps({ categorise: vi.fn().mockRejectedValueOnce(new Error("The period is closed")).mockResolvedValueOnce({ entry_number: "JE-2" }) });
    const outcomes = await postReviewItems(
      sb,
      [
        { transactionId: "t1", kind: "account", accountId: "a" },
        { transactionId: "t2", kind: "account", accountId: "a" },
      ],
      d,
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: false, error: "The period is closed" },
      { id: "t2", ok: true, detail: "JE-2" },
    ]);
  });

  it("refuses more than fifty lines in one call", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ transactionId: `t${i}`, kind: "account" as const, accountId: "a" }));
    await expect(postReviewItems(sb, items, deps())).rejects.toThrow(/50/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — FAIL, module not found.

- [ ] **Step 3: The import returns its batch** — in `lib/services/banking.ts`:
  - import `statementLineHash` beside `statementRowHash` from `@/lib/domain/banking-import`;
  - add to `ImportRow`: `  /** The bank's own id (OFX FITID); the duplicate key when present. */\n  external_id?: string | null;`
  - in `importStatement`, change the return type to `Promise<{ inserted: number; skipped: number; batchId: string | null }>`, the early return to `return { inserted: 0, skipped: 0, batchId: null };`, the hash line to `raw_hash: statementLineHash(bankAccountId, r),`, the result cast to `{ inserted?: number; skipped?: number; batch_id?: string } | null`, and the return to:

```ts
  return {
    inserted: Number(result?.inserted ?? 0),
    skipped: Number(result?.skipped ?? rows.length),
    batchId: result?.batch_id ?? null,
  };
```

- [ ] **Step 4: Write** `lib/services/statement-review.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import {
  REVIEW_POST_CHUNK,
  reviewProposal,
  type ReviewDocument,
  type ReviewPostItem,
  type ReviewProposal,
} from "@/lib/domain/statement-review";
import { listAccounts } from "./accounts";
import {
  approveReconciliation,
  categoriseBankTransaction,
  listBankAccounts,
  listSuggestions,
  settleFromBankTransaction,
} from "./banking";
import { listBankRules, loadHistory, suggestionsFrom } from "./coding";
import { readAllPages } from "./paging";

/**
 * Review import: every line one statement import brought in, with the one
 * thing OneBook proposes for it, and the posting of what a person ticked.
 *
 * Nothing here decides a ledger rule. Posting walks each ticked line through
 * the call the same action takes by hand — approving a match, settling a
 * document, categorising — and each of those RPCs keeps its own guards.
 */
export class StatementReviewError extends Error {}
const fail = (message: string) => new StatementReviewError(message);

export interface ReviewBatch {
  id: string;
  filename: string;
  rowCount: number;
  importedAt: string;
  status: string;
  bankAccountId: string;
  bankLabel: string;
  currencyCode: string;
}

export interface ReviewLineView {
  id: string;
  txnDate: string;
  description: string;
  reference: string | null;
  amountMinor: number;
  proposal: ReviewProposal;
}

export interface ImportReview {
  batch: ReviewBatch;
  lines: ReviewLineView[];
  /** Accounts a line may be coded to, for the picker. */
  accounts: { id: string; label: string }[];
  /** The same accounts as chart rows, for the rule form. */
  ruleAccounts: AccountRow[];
}

async function openDocuments(sb: SupabaseClient): Promise<ReviewDocument[]> {
  const [invoices, bills] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_invoice")
          .select("id,invoice_number,balance_due_minor,currency_code,acc_customer(name)")
          .in("status", ["issued", "partial"])
          .gt("balance_due_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_bill")
          .select("id,bill_number,balance_due_minor,currency_code,acc_vendor(name)")
          .in("status", ["open", "partial"])
          .gt("balance_due_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    ),
  ]);
  return [
    ...invoices.map((row) => ({
      documentId: row.id as string,
      documentNumber: (row.invoice_number as string) ?? null,
      partyName: (row.acc_customer as { name?: string } | null)?.name ?? "—",
      balanceDueMinor: Number(row.balance_due_minor),
      currencyCode: row.currency_code as string,
      direction: "receivable" as const,
    })),
    ...bills.map((row) => ({
      documentId: row.id as string,
      documentNumber: (row.bill_number as string) ?? null,
      partyName: (row.acc_vendor as { name?: string } | null)?.name ?? "—",
      balanceDueMinor: Number(row.balance_due_minor),
      currencyCode: row.currency_code as string,
      direction: "payable" as const,
    })),
  ];
}

export async function loadImportReview(sb: SupabaseClient, batchId: string): Promise<ImportReview | null> {
  const { data: batchRow, error } = await sb
    .from("acc_bank_import_batch")
    .select("id,bank_account_id,filename,row_count,imported_at,status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!batchRow) return null;
  const batch = batchRow as {
    id: string;
    bank_account_id: string;
    filename: string | null;
    row_count: number;
    imported_at: string;
    status: string;
  };

  const [banks, lines, matches, documents, rules, history, accountRows] = await Promise.all([
    listBankAccounts(sb),
    readAllPages<BankTransactionRow>(
      (from, to) =>
        sb
          .from("acc_bank_transaction")
          .select("*")
          .eq("import_batch_id", batchId)
          .is("provider_removed_at", null)
          .order("txn_date")
          .order("id")
          .range(from, to),
      fail,
    ),
    listSuggestions(sb, batch.bank_account_id),
    openDocuments(sb),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
  ]);
  const bank = banks.find((b) => b.id === batch.bank_account_id);
  const currencyCode = bank?.currency_code ?? "USD";
  const codable = accountRows.filter((row) => codableAccount(codingAccountOf(row)));

  // Most confident first, so the first seen for a line is its best.
  const bestMatch = new Map<string, { reconciliationId: string; entryNumber: string | null }>();
  for (const match of matches) {
    if (!bestMatch.has(match.bank_transaction_id)) {
      bestMatch.set(match.bank_transaction_id, { reconciliationId: match.id, entryNumber: match.target_number });
    }
  }
  const coding = new Map(
    suggestionsFrom({ lines, rules, history, accounts: accountRows, matchedLineIds: new Set(bestMatch.keys()) }).map((s) => [
      s.transactionId,
      s,
    ]),
  );

  return {
    batch: {
      id: batch.id,
      filename: batch.filename ?? "Statement",
      rowCount: Number(batch.row_count),
      importedAt: batch.imported_at,
      status: batch.status,
      bankAccountId: batch.bank_account_id,
      bankLabel: bank ? `${bank.bank_name || bank.account_name} · ${bank.account_code}` : "Bank account",
      currencyCode,
    },
    lines: lines.map((row) => ({
      id: row.id,
      txnDate: row.txn_date,
      description: row.description ?? "",
      reference: row.reference,
      amountMinor: Number(row.amount_minor),
      proposal: reviewProposal({
        line: { id: row.id, status: row.status, pending: row.pending, amountMinor: Number(row.amount_minor), currencyCode },
        match: bestMatch.get(row.id) ?? null,
        documents,
        coding: coding.get(row.id) ?? null,
      }),
    })),
    accounts: codable.map((row) => ({ id: row.id, label: `${row.account_code} — ${row.name}` })),
    ruleAccounts: codable,
  };
}

export interface ReviewOutcome {
  id: string;
  ok: boolean;
  /** What was done: "Matched", "Settled", or the entry number. */
  detail?: string;
  error?: string;
}

export interface ReviewPostDeps {
  lineState: (sb: SupabaseClient, id: string) => Promise<{ status: string; pending: boolean; amountMinor: number } | null>;
  matchOf: (sb: SupabaseClient, reconciliationId: string) => Promise<{ bankTransactionId: string; status: string } | null>;
  approve: (sb: SupabaseClient, reconciliationId: string) => Promise<void>;
  settle: typeof settleFromBankTransaction;
  categorise: (sb: SupabaseClient, transactionId: string, accountId: string) => Promise<{ entry_number: string | null }>;
}

const defaultDeps: ReviewPostDeps = {
  lineState: async (sb, id) => {
    const { data, error } = await sb.from("acc_bank_transaction").select("status,pending,amount_minor").eq("id", id).maybeSingle();
    if (error) throw fail(error.message);
    if (!data) return null;
    const row = data as { status: string; pending: boolean; amount_minor: number };
    return { status: row.status, pending: row.pending, amountMinor: Number(row.amount_minor) };
  },
  matchOf: async (sb, reconciliationId) => {
    const { data, error } = await sb.from("acc_reconciliation").select("bank_transaction_id,status").eq("id", reconciliationId).maybeSingle();
    if (error) throw fail(error.message);
    if (!data) return null;
    const row = data as { bank_transaction_id: string; status: string };
    return { bankTransactionId: row.bank_transaction_id, status: row.status };
  },
  approve: approveReconciliation,
  settle: settleFromBankTransaction,
  categorise: categoriseBankTransaction,
};

/** Post what a person ticked, one line after another; a refusal stops only its own line. */
export async function postReviewItems(
  sb: SupabaseClient,
  items: readonly ReviewPostItem[],
  deps: ReviewPostDeps = defaultDeps,
): Promise<ReviewOutcome[]> {
  if (items.length > REVIEW_POST_CHUNK) throw fail(`Post at most ${REVIEW_POST_CHUNK} lines at a time`);
  const outcomes: ReviewOutcome[] = [];
  for (const item of items) {
    const id = item.transactionId;
    try {
      const state = await deps.lineState(sb, id);
      if (!state) {
        outcomes.push({ id, ok: false, error: "This line is no longer on the statement, so nothing was posted" });
        continue;
      }
      if (state.status !== "unmatched" || state.pending) {
        outcomes.push({ id, ok: false, error: "This line was already handled, so nothing was posted" });
        continue;
      }
      if (item.kind === "match") {
        const match = await deps.matchOf(sb, item.reconciliationId);
        if (!match || match.bankTransactionId !== id || match.status !== "suggested") {
          outcomes.push({ id, ok: false, error: "That ledger match is no longer on offer, so nothing was posted" });
          continue;
        }
        await deps.approve(sb, item.reconciliationId);
        outcomes.push({ id, ok: true, detail: "Matched" });
      } else if (item.kind === "document") {
        await deps.settle(sb, {
          bankTransactionId: id,
          allocations: [{ document_id: item.documentId, amount_minor: Math.abs(state.amountMinor) }],
          method: null,
          memo: null,
        });
        outcomes.push({ id, ok: true, detail: "Settled" });
      } else {
        const posted = await deps.categorise(sb, id, item.accountId);
        outcomes.push({ id, ok: true, detail: posted.entry_number ?? "Posted" });
      }
    } catch (err) {
      outcomes.push({ id, ok: false, error: err instanceof Error ? err.message : "Could not post this line" });
    }
  }
  return outcomes;
}
```

- [ ] **Step 5: Run** `npx vitest run tests/unit/statement-review-service.test.ts tests/unit/banking-paged-reads.test.ts`, then `npm run typecheck` → PASS / exit 0. (If `importStatementAction` or another caller no longer typechecks because of the new `batchId`, Task 5 changes it; adjust only the return type here if needed and note it.)

- [ ] **Step 6: Commit**

```bash
git add -- lib/services/banking.ts lib/services/statement-review.ts tests/unit/statement-review-service.test.ts
printf '%s\n' "feat(statements): read an import for review, and post what was ticked" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 5: Actions

**Files:**
- Modify: `ctyhp-accounting/app/(app)/banking/actions.ts` (`importStatementAction`)
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Create: `ctyhp-accounting/app/(app)/banking/imports/actions.ts`
- Test: `ctyhp-accounting/tests/unit/statement-review-schema.test.ts`

**Interfaces:**
- Produces: `importStatementAction(...)` → `ActionResult<{ inserted; skipped; batchId: string | null }>`, which also runs `generateSuggestions` for the account after a non-empty import; `reviewPostItemsSchema`; `postReviewItemsAction(batchId: string, raw: unknown): Promise<ActionResult<{ outcomes: ReviewOutcome[] }>>`.

- [ ] **Step 1: Write the failing test** — `tests/unit/statement-review-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reviewPostItemsSchema } from "@/lib/domain/schemas";

const id = "5a802489-7f77-4f20-9cbd-e0fb9a7d1542";

describe("reviewPostItemsSchema", () => {
  it("takes the three kinds of item", () => {
    const parsed = reviewPostItemsSchema.parse([
      { transactionId: id, kind: "match", reconciliationId: id },
      { transactionId: id, kind: "document", documentId: id },
      { transactionId: id, kind: "account", accountId: id },
    ]);
    expect(parsed).toHaveLength(3);
  });
  it("refuses nothing, more than fifty, and a kind it does not know", () => {
    expect(reviewPostItemsSchema.safeParse([]).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse(Array.from({ length: 51 }, () => ({ transactionId: id, kind: "account", accountId: id }))).success).toBe(false);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "void", accountId: id }]).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — FAIL (`reviewPostItemsSchema` not exported).

- [ ] **Step 3: The schema** — append to `lib/domain/schemas.ts`:

```ts
/** What Review import posts: fifty lines at most, each one kind of post. */
export const reviewPostItemsSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({ transactionId: z.uuid(), kind: z.literal("match"), reconciliationId: z.uuid() }),
      z.object({ transactionId: z.uuid(), kind: z.literal("document"), documentId: z.uuid() }),
      z.object({ transactionId: z.uuid(), kind: z.literal("account"), accountId: z.uuid() }),
    ]),
  )
  .min(1, "Nothing to post")
  .max(50, "Post at most 50 lines at a time");
```

- [ ] **Step 4: The import action** — in `app/(app)/banking/actions.ts` replace `importStatementAction` with:

```ts
export async function importStatementAction(
  bankAccountId: string,
  filename: string,
  rows: ImportRow[],
): Promise<ActionResult<{ inserted: number; skipped: number; batchId: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!rows.length) return { ok: false, error: "No rows to import" };
  try {
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    // Review import opens next, and its first proposal is a match to what is
    // already in the books — so those are looked for now. A failure here costs
    // the match proposals, not the import.
    if (res.inserted > 0) {
      await generateSuggestions(sb, bankAccountId).catch((err) =>
        console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
      );
    }
    revalidatePath("/banking");
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

  (`generateSuggestions` is already imported in this file for `generateSuggestionsAction`; if not, add it to the `@/lib/services/banking` import.)

- [ ] **Step 5: The review action** — `app/(app)/banking/imports/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { reviewPostItemsSchema } from "@/lib/domain/schemas";
import { postReviewItems, type ReviewOutcome } from "@/lib/services/statement-review";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Post up to fifty ticked lines of one import; each is reported on its own. */
export async function postReviewItemsAction(batchId: string, raw: unknown): Promise<ActionResult<{ outcomes: ReviewOutcome[] }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: "You do not have permission to post bank lines" };
  const parsed = reviewPostItemsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid lines" };
  try {
    const sb = await createSupabaseServerClient();
    const outcomes = await postReviewItems(sb, parsed.data);
    revalidatePath("/banking");
    revalidatePath(`/banking/imports/${batchId}`);
    revalidatePath("/reports");
    return { ok: true, data: { outcomes } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not post these lines" };
  }
}
```

- [ ] **Step 6: Run** the schema test, `npm run typecheck`, `npx eslint "app/(app)/banking/actions.ts" "app/(app)/banking/imports/actions.ts" lib/domain/schemas.ts` → PASS / 0 / 0.

- [ ] **Step 7: Commit**

```bash
git add -- "app/(app)/banking/actions.ts" "app/(app)/banking/imports/actions.ts" lib/domain/schemas.ts tests/unit/statement-review-schema.test.ts
printf '%s\n' "feat(statements): an import finds its ledger matches, and review lines post fifty at a time" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 6: The import dialog reads every format, and hands over to Review

**Files:**
- Modify (rewrite): `ctyhp-accounting/app/(app)/banking/ImportStatementModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankingClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankImportList.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 5.
- Produces: `ImportStatementModal` props `{ open; bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number }; importing: boolean; onConfirm: (fileName: string, rows: StatementLine[]) => void; onCancel: () => void }`.

- [ ] **Step 1: The dialog** — replace `ImportStatementModal.tsx` with:

```tsx
"use client";
import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Modal, Select, Space, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { parseCsv } from "@/lib/csv";
import {
  describeStatementParse,
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
  type DateOrder,
  type StatementColumnMap,
  type StatementLine,
  type StatementParseResult,
} from "@/lib/domain/statement-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  parseOfx,
  parseQif,
  type StatementFileResult,
} from "@/lib/domain/statement-files";

/**
 * The statement import dialog, in its own file so it is fetched when somebody
 * opens it rather than when they open /banking.
 *
 * It reads the file in the browser — CSV, OFX, QFX, QBO or QIF — and, for a CSV
 * whose headings it does not know, asks which column is which. The import
 * itself is a server action; Review import opens after it.
 */
export interface ImportStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number };
  importing: boolean;
  onConfirm: (fileName: string, rows: StatementLine[]) => void;
  onCancel: () => void;
}

interface CsvState {
  kind: "csv";
  headers: string[];
  records: Record<string, string>[];
}
type FileState =
  | { kind: "none" }
  | { kind: "unsupported"; message: string }
  | CsvState
  | { kind: "file"; format: "OFX" | "QIF"; result: StatementFileResult };

interface CsvChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;

function rememberedChoice(bankAccountId: string, headers: string[]): CsvChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

const COLUMN_FIELDS: { key: keyof StatementColumnMap; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount (one signed column)" },
  { key: "moneyOut", label: "Money out" },
  { key: "moneyIn", label: "Money in" },
  { key: "reference", label: "Reference" },
  { key: "balance", label: "Balance" },
];

export default function ImportStatementModal({ open, bankAccount, importing, onConfirm, onCancel }: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);

  function read(chosen: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setFileName(chosen.name);
      setShowColumns(false);
      const verdict = detectStatementFormat(chosen.name, text);
      if ("unsupported" in verdict) {
        setFile({ kind: "unsupported", message: verdict.unsupported });
        setChoice(null);
        return;
      }
      if (verdict.format === "ofx") {
        setFile({ kind: "file", format: "OFX", result: parseOfx(text, bankAccount.decimals) });
        setChoice(null);
        return;
      }
      if (verdict.format === "qif") {
        setFile({ kind: "file", format: "QIF", result: parseQif(text, { decimals: bankAccount.decimals }) });
        setChoice(null);
        return;
      }
      const records = parseCsv(text);
      const headers = records.length ? Object.keys(records[0]) : [];
      const detected = detectStatementColumns(headers);
      const remembered = rememberedChoice(bankAccount.id, headers);
      const next: CsvChoice = remembered ?? {
        columns: detected.columns,
        dateOrder: detectDateOrder(records.map((r) => (detected.columns.date ? r[detected.columns.date] ?? "" : ""))),
        flipSigns: false,
      };
      setFile({ kind: "csv", headers, records });
      setChoice(next);
      setShowColumns(!statementColumnsComplete(next.columns));
    };
    reader.readAsText(chosen);
    return false;
  }

  const parsed: (StatementParseResult & { accountId?: string | null }) | null = useMemo(() => {
    if (file.kind === "file") return file.result;
    if (file.kind === "csv" && choice && statementColumnsComplete(choice.columns)) {
      return parseStatementRows(file.records, {
        decimals: bankAccount.decimals,
        columns: choice.columns,
        dateOrder: choice.dateOrder,
        flipSigns: choice.flipSigns,
      });
    }
    return null;
  }, [file, choice, bankAccount.decimals]);

  const rows = parsed?.rows ?? [];
  const wrongAccount = file.kind === "file" && accountNumberDiffers(file.result.accountId, bankAccount.maskedNumber);

  function confirm() {
    if (!rows.length) return;
    if (file.kind === "csv" && choice) {
      try {
        localStorage.setItem(storageKey(bankAccount.id), JSON.stringify(choice));
      } catch {
        // Remembering the columns is a convenience; the import does not need it.
      }
    }
    onConfirm(fileName, rows);
  }

  const setColumn = (key: keyof StatementColumnMap, value: string | null) =>
    setChoice((current) => (current ? { ...current, columns: { ...current.columns, [key]: value } } : current));

  return (
    <Modal
      title={`Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
      okText={rows.length ? `Import ${rows.length} rows` : "Import"}
      okButtonProps={{ disabled: !rows.length, loading: importing }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Choose the file your bank gives you: CSV, or a Quicken or QuickBooks download (.ofx, .qfx, .qbo, .qif). After the
        import, Review import proposes an account, a match or a document for every line, and nothing is posted until you
        click Post.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".csv,.txt,.ofx,.qfx,.qbo,.qif"
        beforeUpload={read}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a statement file here</p>
      </Upload.Dragger>

      {file.kind === "unsupported" ? (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={file.message} />
      ) : null}

      {file.kind === "csv" && choice ? (
        <div style={{ marginTop: 12 }}>
          {showColumns ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text strong>Choose columns</Typography.Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {COLUMN_FIELDS.map((field) => (
                  <label key={field.key}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {field.label}
                    </Typography.Text>
                    <Select
                      style={{ width: "100%" }}
                      allowClear={!field.required}
                      placeholder="None"
                      value={choice.columns[field.key] ?? undefined}
                      onChange={(value: string | undefined) => setColumn(field.key, value ?? null)}
                      options={file.headers.map((h) => ({ value: h, label: h }))}
                    />
                  </label>
                ))}
                <label>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Dates
                  </Typography.Text>
                  <Select
                    style={{ width: "100%" }}
                    value={choice.dateOrder}
                    onChange={(value: DateOrder) => setChoice({ ...choice, dateOrder: value })}
                    options={[
                      { value: "mdy", label: "Month/Day/Year" },
                      { value: "dmy", label: "Day/Month/Year" },
                    ]}
                  />
                </label>
              </div>
              <Checkbox checked={choice.flipSigns} onChange={(e) => setChoice({ ...choice, flipSigns: e.target.checked })}>
                Flip signs: my file shows payments as positive
              </Checkbox>
              {!statementColumnsComplete(choice.columns) ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  Choose the date column, and an amount column or money out and money in.
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Button type="link" style={{ padding: 0 }} onClick={() => setShowColumns(true)}>
              Choose columns
            </Button>
          )}
        </div>
      ) : null}

      {wrongAccount ? (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          title="This file names a different account"
          description={`The file is for an account ending ${(file.kind === "file" ? file.result.accountId ?? "" : "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`}
        />
      ) : null}

      {parsed ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>{fileName}</strong>
            {file.kind === "file" ? ` (${file.format})` : " (CSV)"}: {describeStatementParse(parsed)}
          </Typography.Paragraph>
          {rows.slice(0, 3).map((row, i) => (
            <Typography.Text key={i} type="secondary" style={{ display: "block", fontSize: 12 }}>
              {row.txn_date} · {row.description} · {(row.amount_minor / 10 ** bankAccount.decimals).toFixed(bankAccount.decimals)}
            </Typography.Text>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 2: Banking** — in `BankingClient.tsx`:
  - remove the `describeStatementParse`, `parseStatementRows` import block and `import { parseCsv } from "@/lib/csv";` (only if nothing else in the file uses them — check with Grep first);
  - add `import { useRouter } from "next/navigation";` and `import type { StatementLine } from "@/lib/domain/statement-import";`;
  - inside the component, beside the other hooks: `const router = useRouter();`;
  - delete the `parsed` / `fileName` state, the `ParsedRow` interface (if unused elsewhere) and `handleFile`;
  - replace `confirmImport` with:

```ts
  async function confirmImport(fileName: string, rows: StatementLine[]) {
    if (!selectedId || !rows.length) return;
    setBusy("import");
    const result = await importStatementAction(selectedId, fileName, rows);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Import failed");
      return;
    }
    message.success(
      `Imported ${result.data.inserted} line(s); ${result.data.skipped} duplicate(s) skipped`,
    );
    setImportOpen(false);
    setImportsKey((count) => count + 1);
    // Straight on to Review import, where every new line carries a proposal.
    if (result.data.batchId && result.data.inserted > 0) router.push(`/banking/imports/${result.data.batchId}`);
    else reload();
  }
```

  - replace the `<ImportStatementModal …/>` block with:

```tsx
      {importOpen && selected ? (
        <ImportStatementModal
          open={importOpen}
          bankAccount={{
            id: selected.id,
            label: `${selected.bank_name || selected.account_name} · ${selected.account_code}`,
            maskedNumber: selected.account_number_masked,
            decimals: decimalPlaces,
          }}
          importing={busy === "import"}
          onConfirm={(fileName, rows) => void confirmImport(fileName, rows)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
```

- [ ] **Step 3: Review from the imports list** — in `BankImportList.tsx`, the last column (`key: "undo"`): width `110` → `190`; render, for an active import that still has waiting lines, a Review button before Undo. Replace the final `return ( <Button size="small" danger onClick={() => setUndoing(row)}>Undo</Button> );` and the locked branch so both are wrapped:

```tsx
            render: (_, row) => {
              if (row.status === "voided") {
                return (
                  <Tooltip title={row.void_reason ?? undefined}>
                    <Tag>Undone</Tag>
                  </Tooltip>
                );
              }
              const review =
                row.lines_here > row.locked_lines ? (
                  <Button size="small" href={`/banking/imports/${row.id}`}>
                    Review
                  </Button>
                ) : null;
              if (!canWrite) return review;
              if (row.locked_lines > 0) {
                return (
                  <Space size={6}>
                    {review}
                    <Tooltip
                      title={`${row.locked_lines} line(s) are matched to the ledger. Unmatch them first — removing a line an entry points at would leave the books short.`}
                    >
                      <Button size="small" danger disabled>
                        Undo
                      </Button>
                    </Tooltip>
                  </Space>
                );
              }
              return (
                <Space size={6}>
                  {review}
                  <Button size="small" danger onClick={() => setUndoing(row)}>
                    Undo
                  </Button>
                </Space>
              );
            },
```

  (add `Space` to the file's `antd` import.)

- [ ] **Step 4: Typecheck, lint, gates** — `npm run typecheck`; `npx eslint "app/(app)/banking"`; `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/rsc-antd.test.ts tests/unit/undo-bank-statement-migration.test.ts tests/unit/bank-categories-ui-contract.test.ts` → exit 0 / PASS.

- [ ] **Step 5: Commit**

```bash
git add -- "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/BankingClient.tsx" "app/(app)/banking/BankImportList.tsx"
printf '%s\n' "feat(statements): the import dialog reads every format, chooses columns, and hands over to review" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 7: Review import

**Files:**
- Create: `ctyhp-accounting/app/(app)/banking/imports/[id]/page.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/imports/[id]/ReviewImportClient.tsx`

**Interfaces:**
- Consumes: `loadImportReview`, `ImportReview`, `ReviewOutcome` (Task 4); `postReviewItemsAction` (Task 5); `proposalValue`, `itemFromValue`, `chunked` (Task 3); `RuleFormModal`, `EMPTY_RULE` (1.70); `ruleSeedText` (1.70); `summarizeBatchResults`, `describeBatchResult`, `batchResultSeverity`.

- [ ] **Step 1: The page** — `app/(app)/banking/imports/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { loadImportReview } from "@/lib/services/statement-review";
import PageHeader from "@/components/PageHeader";
import ReviewImportClient from "./ReviewImportClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  const [role, review] = await Promise.all([getUserRole(), loadImportReview(sb, id)]);
  if (!review) notFound();
  return (
    <div>
      <PageHeader
        title="Review import"
        description="Every line this statement brought in, with what OneBook proposes for it. Nothing is posted until you click Post; lines you leave stay waiting on Bank Transactions."
      />
      <ReviewImportClient review={review} canWrite={canWrite(role)} />
    </div>
  );
}
```

- [ ] **Step 2: The client** — `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Progress, Select, Space, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { ruleSeedText } from "@/lib/domain/bank-rules";
import { batchResultSeverity, describeBatchResult, summarizeBatchResults, type BatchActionSummary } from "@/lib/domain/bank-transaction-batch";
import { directionOf } from "@/lib/domain/coding-names";
import { chunked, itemFromValue, proposalValue, type ReviewPostItem } from "@/lib/domain/statement-review";
import { formatMoney } from "@/lib/format";
import type { ImportReview, ReviewLineView, ReviewOutcome } from "@/lib/services/statement-review";
import RuleFormModal, { EMPTY_RULE, type RuleFormValues } from "../../rules/RuleFormModal";
import { postReviewItemsAction } from "../actions";

/**
 * One import's lines, each with what OneBook proposes, and the one button that
 * posts what is ticked. A line left unticked, or with nothing chosen, stays
 * waiting on Bank Transactions exactly as an import has always left it.
 */
export default function ReviewImportClient({ review, canWrite }: { review: ImportReview; canWrite: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { batch, lines, accounts } = review;
  const money = (minor: number) => formatMoney(minor, batch.currencyCode, 2);

  const [choices, setChoices] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, proposalValue(line.proposal)])),
  );
  const [ticked, setTicked] = useState<string[]>(() =>
    lines.filter((line) => proposalValue(line.proposal) !== null).map((line) => line.id),
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<BatchActionSummary | null>(null);
  const [ruleSeed, setRuleSeed] = useState<RuleFormValues | null>(null);

  const accountOptions = useMemo(() => accounts.map((a) => ({ value: `account:${a.id}`, label: a.label })), [accounts]);
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const counts = useMemo(() => {
    const c = { match: 0, document: 0, account: 0, none: 0, handled: 0 };
    for (const line of lines) c[line.proposal.kind] += 1;
    return c;
  }, [lines]);
  const postable = ticked.filter((id) => choices[id]);
  const waiting = lines.filter((l) => l.proposal.kind !== "handled").length - postable.length;

  function choose(line: ReviewLineView, value: string | null) {
    setChoices((current) => ({ ...current, [line.id]: value }));
    setTicked((current) => (value ? Array.from(new Set([...current, line.id])) : current.filter((id) => id !== line.id)));
  }

  async function post() {
    const items = postable
      .map((id) => itemFromValue(id, choices[id] ?? null))
      .filter((item): item is ReviewPostItem => item !== null);
    if (!items.length) return;
    const outcomes: ReviewOutcome[] = [];
    setProgress({ done: 0, total: items.length });
    for (const chunk of chunked(items)) {
      const res = await postReviewItemsAction(batch.id, chunk);
      if (!res.ok || !res.data) {
        for (const item of chunk) outcomes.push({ id: item.transactionId, ok: false, error: res.error ?? "Could not post this line" });
      } else {
        outcomes.push(...res.data.outcomes);
      }
      setProgress({ done: outcomes.length, total: items.length });
    }
    setProgress(null);
    const result = summarizeBatchResults(outcomes, 0);
    setSummary(result);
    if (result.failureCount === 0) message.success(describeBatchResult(result));
    router.refresh();
  }

  const whyOf = (line: ReviewLineView) => {
    const own = proposalValue(line.proposal);
    const chosen = choices[line.id];
    if (chosen && chosen !== own) return "Chosen by you";
    return line.proposal.why;
  };

  const columns: TableColumnsType<ReviewLineView> = [
    { title: "Date", key: "date", dataIndex: "txnDate", width: COLUMN.DATE },
    {
      ...flexColumn<ReviewLineView>({
        title: "Description",
        key: "description",
        render: (_: unknown, line: ReviewLineView) => (
          <div style={{ minWidth: 0 }}>
            <Typography.Text ellipsis={{ tooltip: line.description }} style={{ display: "block" }}>
              {line.description}
            </Typography.Text>
            {line.reference ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {line.reference}
              </Typography.Text>
            ) : null}
          </div>
        ),
      }),
    },
    {
      title: "Amount",
      key: "amount",
      width: COLUMN.MONEY,
      align: "right",
      render: (_: unknown, line: ReviewLineView) => money(line.amountMinor),
    },
    {
      title: "Post as",
      key: "post",
      width: COLUMN.RICH_MIN + COLUMN.PICKER,
      render: (_: unknown, line: ReviewLineView) => {
        if (line.proposal.kind === "handled" || !canWrite) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {line.proposal.kind === "handled" ? line.proposal.why : (line.proposal as { label?: string }).label ?? line.proposal.why}
            </Typography.Text>
          );
        }
        const own =
          line.proposal.kind === "match" || line.proposal.kind === "document"
            ? [{ value: proposalValue(line.proposal) as string, label: line.proposal.label }]
            : [];
        return (
          <div style={{ minWidth: 0 }}>
            <Select
              showSearch
              allowClear
              style={{ width: "100%" }}
              placeholder="Choose an account"
              optionFilterProp="label"
              value={choices[line.id] ?? undefined}
              onChange={(value: string | undefined) => choose(line, value ?? null)}
              options={[...own, ...accountOptions]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }} ellipsis={{ tooltip: whyOf(line) }}>
              {whyOf(line)}
            </Typography.Text>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontSize: 12 }}
              onClick={() => {
                const chosen = choices[line.id];
                setRuleSeed({
                  ...EMPTY_RULE,
                  matchText: ruleSeedText(line.description),
                  direction: directionOf(line.amountMinor),
                  accountId: chosen?.startsWith("account:") ? chosen.slice("account:".length) : null,
                });
              }}
            >
              Create rule
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
        <Typography.Text strong>
          {batch.filename} · {batch.bankLabel} · imported {batch.importedAt.slice(0, 10)}
        </Typography.Text>
        <Typography.Text type="secondary">
          {batch.rowCount} row{batch.rowCount === 1 ? "" : "s"} in the file · {lines.length} line{lines.length === 1 ? "" : "s"} from this
          import · {counts.match} already in the books · {counts.document} pay a document · {counts.account} have an account ·{" "}
          {counts.none} need coding · {counts.handled} already handled
        </Typography.Text>
      </Space>

      {summary ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={batchResultSeverity(summary)}
          showIcon
          title={describeBatchResult(summary)}
          description={
            summary.failures.length ? (
              <div>
                {summary.failures.map((failure) => {
                  const line = byId.get(failure.id);
                  return (
                    <div key={failure.id}>
                      {line ? `${line.txnDate} · ${line.description} · ${money(line.amountMinor)}` : failure.id}:{" "}
                      <Typography.Text type="danger">{failure.error}</Typography.Text>
                    </div>
                  );
                })}
              </div>
            ) : undefined
          }
        />
      ) : null}

      <DataTable<ReviewLineView>
        rowKey="id"
        columns={columns}
        dataSource={lines}
        emptyTitle="Nothing from this import is waiting"
        emptyDescription="Every line has been posted, matched or undone."
        rowSelection={
          canWrite
            ? {
                selectedRowKeys: ticked,
                onChange: (keys) => setTicked(keys as string[]),
                getCheckboxProps: (line: ReviewLineView) => ({ disabled: line.proposal.kind === "handled" || !choices[line.id] }),
              }
            : undefined
        }
      />

      <Space style={{ marginTop: 12 }} wrap>
        {canWrite ? (
          <Button type="primary" disabled={!postable.length || progress !== null} loading={progress !== null} onClick={() => void post()}>
            Post {postable.length} line{postable.length === 1 ? "" : "s"}
          </Button>
        ) : null}
        <Typography.Text type="secondary">
          {Math.max(0, waiting)} line{waiting === 1 ? "" : "s"} will stay waiting on Bank Transactions
        </Typography.Text>
        <Link href="/banking">Back to Banking</Link>
      </Space>
      {progress ? <Progress style={{ maxWidth: 420 }} percent={Math.round((progress.done / progress.total) * 100)} /> : null}

      <RuleFormModal
        open={ruleSeed !== null}
        ruleId={null}
        initial={ruleSeed ?? EMPTY_RULE}
        accounts={review.ruleAccounts}
        onClose={() => setRuleSeed(null)}
        onSaved={() => {
          setRuleSeed(null);
          router.refresh();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint, gates** — `npm run typecheck`; `npx eslint "app/(app)/banking/imports" lib/services/statement-review.ts`; `npx vitest run tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/rsc-antd.test.ts tests/unit/data-table-contract.test.ts tests/unit/navigation.test.ts` → exit 0 / PASS.

- [ ] **Step 4: Commit**

```bash
git add -- "app/(app)/banking/imports/[id]/page.tsx" "app/(app)/banking/imports/[id]/ReviewImportClient.tsx" lib/services/statement-review.ts
printf '%s\n' "feat(statements): Review import — every line proposed, the ticked ones posted in one click" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 8: Changelog 1.71, and the four gates

**Files:** Modify `ctyhp-accounting/lib/domain/changelog.ts`.

- [ ] **Step 1:** add as the first element of `RELEASES`:

```ts
  {
    version: "1.71",
    date: "2026-09-30",
    headline: "Upload a bank statement and it arrives categorised — review it, then post it in one click.",
    changes: [
      {
        kind: "added",
        title: "Review import",
        detail:
          "After a statement is imported, every new line shows what OneBook proposes: a match to an entry already in the books, the one open invoice or bill it pays, or an account from your bank rules or from how the same name was coded before. Change any line, untick any line, then Post. Nothing is posted until you do, and lines you leave stay waiting on Bank Transactions. An import with lines still waiting can be reviewed again from Statement imports.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Statements in OFX, QFX, QBO and QIF",
        detail:
          "Import the Quicken or QuickBooks download your bank offers, as well as CSV. A file downloaded twice is recognised by the bank's own transaction id, even when the bank rewords a description, and a file for a different account number is flagged before import.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Choose a CSV's columns",
        detail:
          "When a CSV's headings are not ones OneBook knows, choose which column is the date, description, amount or money out and money in, reference and balance, whether dates are day-first, and whether the file writes payments as positive. The choice is remembered for that bank account on this browser.",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: The four gates**, each output read in full:

```bash
npm test > "$SCRATCH/gate-171-test.txt" 2>&1; echo "exit $?"
npm run typecheck > "$SCRATCH/gate-171-tsc.txt" 2>&1; echo "exit $?"
npm run lint > "$SCRATCH/gate-171-lint.txt" 2>&1; echo "exit $?"
npm run build > "$SCRATCH/gate-171-build.txt" 2>&1; echo "exit $?"
```

- [ ] **Step 3: Commit**

```bash
git add -- lib/domain/changelog.ts
printf '%s\n' "chore(changelog): 1.71, statements that arrive categorised" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 9: Live on the sample company, and screenshots (controller)

- [ ] Write a made-up OFX file in the scratchpad for PC-Test's sample bank account (`••4821`): one line equal to an open PC-Test invoice's balance, lines repeating the demo names (PAYFLOW PAYROLL, MONTHLY SERVICE FEE, METRO REALTY PARTNERS), one new name, and one line whose FITID repeats (to prove de-duplication on a second import).
- [ ] Start the build detached (PowerShell `Start-Process npm.cmd start`), run `scripts/smoke-pages.mjs`.
- [ ] Temporary Playwright script on PC-Test only (checks `is_sample`, blurs the header email): import the OFX through the dialog → Review import → screenshot (light/dark, 1440/1280, table fits, no console errors) → post two lines (one account, one document) → check the outcomes; import the same file again → all duplicates. Screenshot a CSV with unknown headings showing Choose columns.
- [ ] Undo what the test created on PC-Test: Change (void) the posted category entries, void the settlement payment if one was made, then Undo the import — so PC-Test's demo data is as before. Report exactly what remains (voided entries stay in the Journal as void).
- [ ] Show the user the screenshots; push only after approval.
