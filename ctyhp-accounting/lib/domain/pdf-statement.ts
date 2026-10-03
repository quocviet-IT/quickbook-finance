/**
 * Reading a bank statement out of a PDF — a port of the client's prototype,
 * Accounting System 2.28 (`src/p44.html`: pdfRowsFrom, readPeriod,
 * headerShape, readStatementRows, splitByAccount and the PDF branch of
 * readStatementFile), in integer cents.
 *
 * Pure: the browser turns the file into glyphs (lib/client/pdf-text.ts) and
 * this turns the glyphs into statements. It departs from the prototype in
 * three places, each marked "OneBook:" where it happens:
 *   1. a figure with two decimals is never a date (the prototype reads 75.00 as
 *      month 75, day 00, and loses a cheque in a grid);
 *   2. "Statement date: November 30, 2026" is read with its whole month name;
 *   3. a line dated a day that does not exist is skipped and counted.
 */
import type { StatementLine } from "./statement-import";

export interface PdfGlyph {
  page: number;
  x: number;
  y: number;
  text: string;
}
export interface PdfCell {
  x: number;
  text: string;
}
export interface PdfRow {
  cells: PdfCell[];
  text: string;
}
export interface PdfStatementLine {
  /** ISO date. */
  date: string;
  /** The words of the row, at most 90 characters. */
  description: string;
  checkNumber: string | null;
  /** Positive is money in. */
  amountMinor: number;
  balanceMinor: number | null;
  /** The row as printed. */
  raw: string;
}
export interface PdfStatement {
  /** Digits only, when the PDF names an account number. */
  accountNumber: string | null;
  from: string | null;
  to: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: PdfStatementLine[];
  /** Dated rows whose date does not exist. */
  skipped: number;
}

/* ---------- money ---------- */
/* A figure has two decimal places. A cheque number does not, which is how the
   two are told apart without being told which column is which. */
const STMT_MONEY = /\(?-?\$?\d{1,3}(?:,\d{3})+\.\d\d\)?-?|\(?-?\$?\d+\.\d\d\)?-?/g;
const MONEY_CELL = /^\(?-?\$?[\d,]*\d\.\d\d\)?-?$/;

/** A printed figure in cents: `(1.00)`, `-1.00` and `1.00-` are negative. Null when it is not a figure. */
export function moneyMinor(text: string): number | null {
  let s = String(text).replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  const m = /^(\d+)\.(\d\d)$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(m[2]);
  return negative && cents !== 0 ? -cents : cents;
}

function moneyIn(text: string): number[] {
  const out: number[] = [];
  for (const match of String(text).match(STMT_MONEY) ?? []) {
    const value = moneyMinor(match);
    if (value !== null) out.push(value);
  }
  return out;
}

function isMoneyCell(text: string): boolean {
  const t = String(text).trim();
  return MONEY_CELL.test(t) && moneyMinor(t) !== null;
}

/* ---------- dates ---------- */
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const pad2 = (n: number) => String(n).padStart(2, "0");

function monthNo(word: string): number {
  return MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1;
}

function isDateCell(text: string): boolean {
  const t = String(text).trim();
  // OneBook: 75.00 is a figure, not month 75 day 00.
  return /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(t) && !/^\d{1,2}\.\d\d$/.test(t);
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The period a statement names; empty strings when it names none. */
export function readPeriod(joined: string): { from: string; to: string } {
  let m = joined.match(
    /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*(?:-|–|to|through)\s*([A-Za-z]{3,9})?\.?\s*(\d{1,2}),?\s+(\d{4})/,
  );
  if (m) {
    const y = Number(m[6]);
    const m2 = monthNo(m[4] || m[1]);
    const m1 = monthNo(m[1]);
    if (m2) {
      // A period running Dec 15 - Jan 14, 2026 opened in the year before.
      const y1 = m[3] ? Number(m[3]) : m1 && m1 > m2 ? y - 1 : y;
      return { from: `${y1}-${pad2(m1 || m2)}-${pad2(Number(m[2]))}`, to: `${y}-${pad2(m2)}-${pad2(Number(m[5]))}` };
    }
  }
  m = joined.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*(?:-|–|to|through)\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    return { from: `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`, to: `${m[6]}-${pad2(Number(m[4]))}-${pad2(Number(m[5]))}` };
  }
  const yr = joined.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  const ob = joined.match(/(?:beginning|opening)\s+balance\s+on\s+(\d{1,2})\/(\d{1,2})/i);
  const cb = joined.match(/ending\s+balance\s+on\s+(\d{1,2})\/(\d{1,2})/i);
  if (yr && cb) {
    const y = Number(yr[3]);
    const to = `${y}-${pad2(Number(cb[1]))}-${pad2(Number(cb[2]))}`;
    const from = ob ? `${Number(ob[1]) > Number(cb[1]) ? y - 1 : y}-${pad2(Number(ob[1]))}-${pad2(Number(ob[2]))}` : "";
    return { from, to };
  }
  // OneBook: the gap before the month is matched lazily, so "November" is read whole, not as "ber".
  m = joined.match(/(?:as of|statement date|closing date|ending)\D{0,12}?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && monthNo(m[1])) return { from: "", to: `${m[3]}-${pad2(monthNo(m[1]))}-${pad2(Number(m[2]))}` };
  m = joined.match(/(?:as of|statement date|closing date)\D{0,12}(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i);
  if (m) return { from: "", to: `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}` };
  return { from: "", to: "" };
}

/* ---------- rows ---------- */
/**
 * OneBook: pdf.js joins a date to the words printed just after it ("07/02/2026
 * EXAMPLE DEPOSIT") when the gap is narrow, and the prototype then misses the
 * whole line. Such a cell is read as the date and the words, as printed.
 */
function splitLeadingDate(cell: PdfCell): PdfCell[] {
  const m = /^(\S+)\s+(\S.*)$/.exec(cell.text);
  if (!m || !isDateCell(m[1])) return [cell];
  return [
    { x: cell.x, text: m[1] },
    { x: cell.x + 0.01, text: m[2] },
  ];
}

/** A PDF holds glyphs at coordinates, not rows: everything on one baseline is one row, read left to right. */
export function rowsFromGlyphs(glyphs: readonly PdfGlyph[]): PdfRow[] {
  const pages = [...new Set(glyphs.map((g) => g.page))].sort((a, b) => a - b);
  const rows: PdfRow[] = [];
  for (const page of pages) {
    const byLine = new Map<number, PdfCell[]>();
    for (const g of glyphs) {
      const text = String(g.text ?? "").trim();
      if (g.page !== page || !text) continue;
      const key = Math.round(g.y / 3);
      const line = byLine.get(key) ?? [];
      line.push({ x: g.x, text });
      byLine.set(key, line);
    }
    for (const key of [...byLine.keys()].sort((a, b) => b - a)) {
      const cells = byLine.get(key)!.sort((a, b) => a.x - b.x).flatMap(splitLeadingDate);
      rows.push({ cells, text: cells.map((c) => c.text).join(" ") });
    }
  }
  return rows;
}

/* ---------- the figures a statement is built around ---------- */
const CLOSE_LBL = /(ending|closing|new|final)\s+balance|balance\s+(at\s+)?(close|end)\b|closing\s+(ledger|book)/i;
const OPEN_LBL = /(beginning|opening|previous|starting|prior)\s+balance|balance\s+(brought\s+)?forward|opening\s+ledger/i;

/** The figure against a label: on its row, or the first one on the next two rows when the bank wrapped it. */
function labelledFigure(rows: readonly PdfRow[], i: number, label: RegExp): number | null {
  const here = moneyIn(rows[i].text.replace(label, ""));
  if (here.length) return here[here.length - 1];
  for (let j = i + 1; j < Math.min(i + 3, rows.length); j++) {
    const next = moneyIn(rows[j].text);
    if (next.length) return next[0];
  }
  return null;
}

/* ---------- sections and their headings ---------- */
const SKIP_HEADING =
  /daily\s+(\w+\s+)?balances?\b|ending\s+balance\s*$|check\s+images?|balance\s+summary|interest\s+summary|account\s+summary|card\s+summary|how to (balance|reconcile)/i;
const DEBIT_HEADING = /withdraw|debit|^checks?\b|fees?\b|charges?\b|payments? (made|out)/i;
const CREDIT_HEADING = /deposit|credit|additions?|payments? (in|received)/i;

interface Heading {
  dates: number;
  dateX: number | null;
  debit?: number;
  credit?: number;
  amount?: number;
  balance?: number;
  balanceOnly: boolean;
  check: boolean;
}
type MoneyColumn = "debit" | "credit" | "amount" | "balance";

/** A heading split over lines ("Deposits/" over "Credits") is read down each column, not across the page. */
function foldHeading(cells: readonly PdfCell[], above: readonly PdfRow[]): PdfCell[] {
  const cols = cells.map((c) => ({ x: c.x, parts: [c.text] }));
  const near = (c: PdfCell) => {
    let best: (typeof cols)[number] | null = null;
    let bd = 34;
    for (const k of cols) {
      const d = Math.abs(k.x - c.x);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  for (const r of above) {
    // Only a line of several cells that each sit over a column is the top of a wrapped heading.
    if (r.cells.length < 2) continue;
    if (!r.cells.every((c) => near(c) !== null)) continue;
    for (const c of r.cells) near(c)!.parts.unshift(c.text);
  }
  return cols.map((k) => ({ x: k.x, text: k.parts.join(" ") }));
}

function headerShape(cells: readonly PdfCell[], prev: PdfRow | null, prev2: PdfRow | null): Heading | null {
  // A heading names columns; it never holds a figure or a date.
  if (!cells.length) return null;
  if (cells.some((c) => isMoneyCell(c.text) || isDateCell(c.text))) return null;
  const h: Heading = { dates: 0, dateX: null, balanceOnly: false, check: false };
  const above = [prev, prev2].filter(
    (r): r is PdfRow =>
      r !== null && r.cells.length > 0 && r.cells.every((c) => !isMoneyCell(c.text) && !isDateCell(c.text) && c.text.length < 26),
  );
  const merged = foldHeading(cells, above);
  for (const c of merged) {
    const s = c.text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (s === "date" || s === "dates") {
      h.dates++;
      if (h.dateX === null) h.dateX = c.x;
      continue;
    }
    if (/^(debits?|withdrawals?|payments?|money out|paid out|charges?|checks and debits|withdrawals debits?)$/.test(s)) h.debit = c.x;
    else if (/^(credits?|deposits?|money in|paid in|additions?|deposits and credits|deposits credits?)$/.test(s)) h.credit = c.x;
    else if (/^amount( usd| \$)?$/.test(s)) h.amount = c.x;
    else if (/^((ending )?(daily )?balance|running balance|ledger balance|closing balance|balance usd)$/.test(s)) h.balance = c.x;
  }
  if (!h.dates && prev) {
    // "DATE" above "PAID": a line of nothing but Date names the date column of the heading under it.
    const only = prev.cells.filter((c) => /^dates?$/i.test(c.text.replace(/[^A-Za-z]/g, "")));
    if (only.length && only.length === prev.cells.length) {
      h.dates = only.length;
      h.dateX = only[0].x;
    }
  }
  if (!h.dates) return null;
  if (h.debit === undefined && h.credit === undefined && h.amount === undefined && h.balance === undefined) return null;
  h.balanceOnly = h.debit === undefined && h.credit === undefined && h.amount === undefined;
  h.check = /che?c?k/i.test(merged.map((c) => c.text).join(" "));
  return h;
}

function nearestCol(x: number, h: Heading): MoneyColumn | null {
  let best: MoneyColumn | null = null;
  let bd = 70;
  for (const k of ["debit", "credit", "amount", "balance"] as const) {
    const at = h[k];
    if (at === undefined) continue;
    const d = Math.abs(x - at);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

const PRINTED_SIGN = /^[-(]|-$|\)$/;

/* ---------- the lines ---------- */
interface ReadLine extends PdfStatementLine {
  section: number;
}

/**
 * One statement's rows. Whether a figure is money in or out is answered by the
 * running balance where there is one, by the sign the bank printed, by the
 * column it sits under, and failing all three by the heading above the table.
 */
function readStatementRows(rows: readonly PdfRow[]) {
  const per = readPeriod(rows.map((r) => r.text).join("\n"));

  let opening: number | null = null;
  let closing: number | null = null;
  rows.forEach((r, i) => {
    if (closing === null && CLOSE_LBL.test(r.text)) closing = labelledFigure(rows, i, CLOSE_LBL);
    if (opening === null && OPEN_LBL.test(r.text)) opening = labelledFigure(rows, i, OPEN_LBL);
  });

  const lines: ReadLine[] = [];
  let skipped = 0;
  let sec: Heading | null = null;
  let secSign = 0;
  let prev: number | null = opening;
  let sawBal = false;
  let skipping = false;
  let prevRow: PdfRow | null = null;
  let prevRow2: PdfRow | null = null;
  let secNo = 0;

  const push = (dateCell: string, cells: readonly PdfCell[], amount: number, bal: number | null, wantCheck: boolean, raw: string) => {
    const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(dateCell);
    if (!dm) return;
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : per.to ? Number(per.to.slice(0, 4)) : 0;
    const mo = Number(dm[1]);
    const da = Number(dm[2]);
    if (!dm[3] && per.to) {
      // A line dated 12/28 on a January statement belongs to the December before.
      const pm = Number(per.to.slice(5, 7));
      if (mo > pm + 1 || (mo === 12 && pm === 1)) y -= 1;
    }
    if (!y || !mo || !da) return;
    const date = `${y}-${pad2(mo)}-${pad2(da)}`;
    // OneBook: a day that does not exist is not turned into one that does.
    if (!isRealDate(date)) {
      skipped += 1;
      return;
    }
    const words = cells.filter((c) => !isMoneyCell(c.text) && !isDateCell(c.text)).map((c) => c.text);
    const text = words.join(" ");
    let check = "";
    const named = text.match(/che?c?k\s*(?:no\.?|number|#)?\s*:?\s*(\d{2,7})/i);
    if (named) check = named[1];
    else if (wantCheck) check = words.find((w) => /^\d{2,7}$/.test(w)) ?? "";
    lines.push({
      section: secNo,
      date,
      amountMinor: amount,
      description: text.replace(/\s{2,}/g, " ").trim().slice(0, 90),
      checkNumber: check || null,
      balanceMinor: bal,
      raw,
    });
  };

  for (const r of rows) {
    const t = r.text.trim();
    const h = headerShape(r.cells, prevRow, prevRow2);
    if (h) {
      prevRow2 = prevRow;
      prevRow = r;
      secNo++;
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
      sec = skipping || (h.balanceOnly && h.dates > 1) ? null : h;
      continue;
    }
    const current: Heading | null = sec;
    const atDate =
      current && current.dateX !== null
        ? (r.cells.find((c) => isDateCell(c.text) && Math.abs(c.x - (current.dateX as number)) < 70) ?? null)
        : null;
    const first = r.cells.length ? r.cells[0].text : "";
    const dated = isDateCell(first) || atDate !== null;

    if (!dated) {
      if (SKIP_HEADING.test(t)) {
        skipping = true;
        sec = null;
        prevRow2 = prevRow;
        prevRow = r;
        continue;
      }
      if (/^total\b/i.test(t)) {
        sec = null;
        prevRow2 = prevRow;
        prevRow = r;
        continue;
      }
      if (t.length && t.length < 60 && !moneyIn(t).length) {
        if (DEBIT_HEADING.test(t)) {
          secSign = -1;
          skipping = false;
        } else if (CREDIT_HEADING.test(t)) {
          secSign = 1;
          skipping = false;
        } else if (/^transactions?\s+(history|detail|activity)/i.test(t)) {
          // A summary we were told to ignore ends where the next table of activity announces itself.
          skipping = false;
        }
      }
      prevRow2 = prevRow;
      prevRow = r;
      continue;
    }
    prevRow2 = prevRow;
    prevRow = r;
    if (!current) continue;

    // A grid puts several entries on one row; a list puts one.
    if (current.dates > 1) {
      let seg: { date: string; cells: PdfCell[] } | null = null;
      const segs: { date: string; cells: PdfCell[] }[] = [];
      for (const c of r.cells) {
        if (isDateCell(c.text)) {
          seg = { date: c.text, cells: [] };
          segs.push(seg);
          continue;
        }
        if (seg) seg.cells.push(c);
      }
      for (const g of segs) {
        const money = g.cells.filter((c) => isMoneyCell(c.text));
        if (money.length !== 1) continue;
        let v = moneyMinor(money[0].text) as number;
        const signed = PRINTED_SIGN.test(money[0].text.replace(/[$\s]/g, ""));
        if (!signed && secSign) v = secSign * Math.abs(v);
        if (v === 0) continue;
        push(g.date, g.cells, v, null, current.check, [g.date, ...g.cells.map((c) => c.text)].join(" "));
      }
      continue;
    }

    const dateCell = isDateCell(first) ? first : (atDate as PdfCell).text;
    const nums = r.cells.filter((c) => isMoneyCell(c.text)).map((c) => ({ x: c.x, v: moneyMinor(c.text) as number, s: c.text }));
    if (!nums.length) continue;

    let bal: number | null = null;
    let rest = nums.slice();
    if (current.balance !== undefined) {
      // Nearest to the balance column is not enough: a withdrawals column can sit close to it.
      let at = -1;
      let bd = 70;
      nums.forEach((n, k) => {
        if (nearestCol(n.x, current) !== "balance") return;
        const d = Math.abs(n.x - (current.balance as number));
        if (d < bd) {
          bd = d;
          at = k;
        }
      });
      if (at >= 0) {
        bal = nums[at].v;
        rest = nums.filter((_, k) => k !== at);
      }
    }

    let amount: number | null = null;
    const cand = rest.length ? rest[rest.length - 1] : null;
    if (bal !== null && prev !== null) {
      const delta = bal - prev;
      if (cand && Math.abs(delta) === Math.abs(cand.v)) amount = delta;
      else if (!cand) amount = delta;
    }
    if (amount === null && cand) {
      if (PRINTED_SIGN.test(cand.s.replace(/[$\s]/g, ""))) amount = cand.v;
      else if (current.debit !== undefined && current.credit !== undefined) {
        const col = nearestCol(cand.x, current);
        if (col === "debit") amount = -Math.abs(cand.v);
        else if (col === "credit") amount = Math.abs(cand.v);
      }
      if (amount === null && secSign) amount = secSign * Math.abs(cand.v);
    }
    if (amount === null || amount === 0) continue;

    push(dateCell, r.cells, amount, bal, current.check, r.text);
    if (bal !== null) {
      prev = bal;
      sawBal = true;
    }
  }

  // A section that restates lines already read (a statement listing its cheques twice) goes.
  const seen = new Map<string, number>();
  const bySection = new Map<number, ReadLine[]>();
  for (const l of lines) bySection.set(l.section, [...(bySection.get(l.section) ?? []), l]);
  const dropped = new Set<number>();
  [...bySection.keys()]
    .sort((a, b) => a - b)
    .forEach((section, k) => {
      const group = bySection.get(section)!;
      const keyOf = (l: ReadLine) => `${l.date}|${Math.abs(l.amountMinor)}`;
      if (k && group.length >= 2) {
        let dup = 0;
        const used = new Map<string, number>();
        for (const l of group) {
          const key = keyOf(l);
          if ((seen.get(key) ?? 0) - (used.get(key) ?? 0) > 0) {
            dup++;
            used.set(key, (used.get(key) ?? 0) + 1);
          }
        }
        if (dup / group.length >= 0.8) {
          dropped.add(section);
          return;
        }
      }
      for (const l of group) seen.set(keyOf(l), (seen.get(keyOf(l)) ?? 0) + 1);
    });
  const kept = lines.filter((l) => !dropped.has(l.section));

  // With no printed total at either end, the bank's own running balance stands in. Never the books.
  if (closing === null && sawBal) closing = [...kept].reverse().find((l) => l.balanceMinor !== null)?.balanceMinor ?? null;
  if (opening === null && sawBal) {
    const firstWithBalance = kept.find((l) => l.balanceMinor !== null);
    if (firstWithBalance) opening = (firstWithBalance.balanceMinor as number) - firstWithBalance.amountMinor;
  }
  let to = per.to;
  if (!to && kept.length) to = kept.map((l) => l.date).sort()[kept.length - 1];
  return { from: per.from, to, opening: opening as number | null, closing: closing as number | null, lines: kept, skipped };
}

/** A combined statement is cut at each "Account number:" line; the same account named twice is one account. */
function splitByAccount(rows: readonly PdfRow[]): { account: string; rows: PdfRow[] }[] {
  const marks: { at: number; account: string }[] = [];
  rows.forEach((r, i) => {
    const m = r.text.match(/account\s*(?:number|no\.?|#)\s*:\s*([\dXx*-]{4,})/i);
    if (m) marks.push({ at: i, account: m[1].replace(/[^0-9]/g, "") });
  });
  if (marks.length < 2) return [{ account: marks.length ? marks[0].account : "", rows: [...rows] }];
  const cut: typeof marks = [];
  for (const m of marks) {
    if (cut.length && cut[cut.length - 1].account === m.account) continue;
    cut.push(m);
  }
  if (cut.length < 2) return [{ account: cut[0].account, rows: [...rows] }];
  return cut.map((m, k) => ({ account: m.account, rows: rows.slice(m.at, k + 1 < cut.length ? cut[k + 1].at : rows.length) }));
}

/** Every statement in a PDF's glyphs: one per account it names. */
export function readPdfStatements(glyphs: readonly PdfGlyph[]): PdfStatement[] {
  const rows = rowsFromGlyphs(glyphs);
  if (!rows.length) return [];
  const year = rows
    .map((r) => r.text)
    .join(" ")
    .match(/[A-Za-z]{3,9}\s+\d{1,2},\s*(\d{4})/);
  return splitByAccount(rows).map((part) => {
    const s = readStatementRows(part.rows);
    let { from, to } = s;
    if (!to && year && part.rows.length) {
      // A section that names no year of its own borrows the document's.
      const alt = readPeriod(`${part.rows.map((r) => r.text).join("\n")}\nJan 1, ${year[1]}`);
      if (alt.to) {
        to = alt.to;
        from = alt.from;
      }
    }
    return {
      accountNumber: part.account || null,
      from: from || null,
      to: to || null,
      openingMinor: s.opening,
      closingMinor: s.closing,
      lines: s.lines.map((l) => ({
        date: l.date,
        description: l.description,
        checkNumber: l.checkNumber,
        amountMinor: l.amountMinor,
        balanceMinor: l.balanceMinor,
        raw: l.raw,
      })),
      skipped: s.skipped,
    };
  });
}

/** Opening + the lines read, against the printed closing balance. The difference is null when a balance is missing. */
export function statementProof(s: PdfStatement): { linesMinor: number; differenceMinor: number | null } {
  const linesMinor = s.lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const differenceMinor = s.openingMinor !== null && s.closingMinor !== null ? s.closingMinor - (s.openingMinor + linesMinor) : null;
  return { linesMinor, differenceMinor };
}

/** The lines as Import statement takes them. */
export function toStatementLines(s: PdfStatement): StatementLine[] {
  return s.lines.map((l) => ({
    txn_date: l.date,
    description: l.description,
    reference: l.checkNumber,
    amount_minor: l.amountMinor,
    running_balance_minor: l.balanceMinor,
    raw_line: l.raw,
    external_id: null,
  }));
}
