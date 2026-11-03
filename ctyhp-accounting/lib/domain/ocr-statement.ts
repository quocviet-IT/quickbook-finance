/**
 * A scanned statement, read by the company's own OCR server (3.02).
 *
 * The model answers each page with its words, its tables as HTML, and layout
 * tags (a label and a box) around each block. Here that answer becomes the
 * positioned text the PDF reader already understands: every table cell on a
 * column grid, one row per table row, every other line on its own row. The
 * statement is then read by readPdfStatements, by the same rules as a PDF
 * that has text, and proved the same way.
 *
 * Pure: no network, no React.
 */
import { z } from "zod";
import type { PdfGlyph, PdfStatementLine } from "./pdf-statement";

export const OCR_MAX_PAGES = 20;

export const ocrResultSchema = z.object({
  engine: z.string().min(1).max(100),
  pages: z
    // twenty pages at most stay well under Vercel's 4.5 MB request body
    .array(z.object({ page: z.number().int().min(1).max(OCR_MAX_PAGES), text: z.string().max(100_000) }))
    .min(1)
    .max(OCR_MAX_PAGES),
});
export type OcrResult = z.infer<typeof ocrResultSchema>;

/**
 * The reader puts a figure under the heading within 70 units of it, so columns
 * sit 150 apart: never within reach of the next. Rows sit 12 apart, and the
 * reader joins glyphs within 3 into one line.
 */
const COLUMN_GAP = 150;
const ROW_GAP = 12;
const PAGE_TOP = 100_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A numeric entity as its character; one that is not a code point stays as written. */
function fromCode(whole: string, code: number): string {
  return Number.isNaN(code) || code > 0x10ffff ? whole : String.fromCodePoint(code);
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => fromCode(whole, parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (whole, dec: string) => fromCode(whole, Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function clean(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** The model's layout tags: a block's label and its box. The words follow them. */
function withoutLayout(text: string): string {
  return text.replace(/<\|ref\|>[\s\S]*?<\|\/ref\|>/g, "").replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, "\n");
}

type Line = { x: number; text: string }[];

function tableLines(table: string): Line[] {
  const lines: Line[] = [];
  // Columns still held by a rowspan from the rows above, and for how many more rows.
  const held = new Map<number, number>();
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: Line = [];
    const heldNow = new Set(held.keys());
    const taken = new Map<number, number>();
    let column = 0;
    for (const cell of row[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (heldNow.has(column)) column++;
      const span = Math.max(1, Number(/colspan\s*=\s*"?(\d+)/i.exec(cell[1])?.[1] ?? 1));
      const down = Math.max(1, Number(/rowspan\s*=\s*"?(\d+)/i.exec(cell[1])?.[1] ?? 1));
      const text = clean(cell[2]);
      if (text) cells.push({ x: COLUMN_GAP * (column + 1), text });
      if (down > 1) for (let c = column; c < column + span; c++) taken.set(c, down - 1);
      column += span;
    }
    for (const [c, left] of held) {
      if (left <= 1) held.delete(c);
      else held.set(c, left - 1);
    }
    for (const [c, left] of taken) held.set(c, left);
    if (cells.length) lines.push(cells);
  }
  return lines;
}

function textLines(text: string): Line[] {
  return text
    .split(/\n/)
    .map((l) => clean(l))
    .filter(Boolean)
    .map((t) => [{ x: 0, text: t }]);
}

/** Every page's answer as positioned text, pages in order, top to bottom. */
export function glyphsFromOcrPages(pages: OcrResult["pages"]): PdfGlyph[] {
  const glyphs: PdfGlyph[] = [];
  for (const { page, text } of [...pages].sort((a, b) => a.page - b.page)) {
    const lines: Line[] = [];
    const body = withoutLayout(text);
    let at = 0;
    for (const table of body.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)) {
      const start = table.index ?? at;
      lines.push(...textLines(body.slice(at, start)));
      lines.push(...tableLines(table[0]));
      at = start + table[0].length;
    }
    lines.push(...textLines(body.slice(at)));
    lines.forEach((cells, i) => {
      for (const c of cells) glyphs.push({ page, x: c.x, y: PAGE_TOP - i * ROW_GAP, text: c.text });
    });
  }
  return glyphs;
}

/**
 * The lines whose printed balance does not follow from the one before (the
 * opening, for the first). A line that prints no balance (many statements
 * print one only on the last line of a day) carries the running balance on,
 * so the next printed balance is still checked. A misread digit shows here on
 * its own row, where the proof only says the total is out.
 */
export function balanceBreaks(lines: readonly PdfStatementLine[], openingMinor: number | null): number[] {
  const breaks: number[] = [];
  let previous = openingMinor;
  lines.forEach((l, i) => {
    if (l.balanceMinor === null) {
      previous = previous === null ? null : previous + l.amountMinor;
      return;
    }
    if (previous !== null && previous + l.amountMinor !== l.balanceMinor) breaks.push(i);
    previous = l.balanceMinor;
  });
  return breaks;
}

/** Where reading a scanned statement stands, as the dialog shows it. */
export type ScannedReading =
  | { phase: "offline" }
  | { phase: "ready" }
  | { phase: "sending" }
  | { phase: "waiting" }
  | { phase: "reading"; pagesDone: number; pagesTotal: number | null }
  | { phase: "failed"; message: string };

export const OCR_TEXT = {
  title: "This PDF is a scanned image",
  ready:
    "OneBook can read it with your company's own OCR server. The file is sent to that server, never to an outside service, and the lines come back here to be checked before anything is imported.",
  offline:
    "Your company's OCR server is not answering, so a scanned statement cannot be read now. Try again later, or download the statement from online banking as a PDF, or as CSV, OFX or QFX.",
  button: "Read with OCR",
  sending: "Sending the file to the OCR server…",
  waiting: "Waiting for the OCR server to start…",
  reading: (done: number, total: number | null) =>
    total ? `Reading page ${Math.min(done + 1, total)} of ${total}…` : "Reading…",
  banner: "Read by OCR from a scanned image. Check the lines against the statement before importing.",
  breaks: (rows: readonly number[]) =>
    rows.length > 5
      ? "The running balances do not follow from line to line in several places. Check the lines against the statement."
      : `The balance on line ${rows.map((r) => r + 1).join(", ")} does not follow from the line before. Check ${rows.length === 1 ? "it" : "them"} against the statement.`,
  timedOut: "The OCR server took too long. Try again, or download the statement from online banking.",
} as const;
