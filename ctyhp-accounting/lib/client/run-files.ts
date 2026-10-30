/**
 * One statement file read in the browser into the statements of a run: a PDF
 * by 1.78's reader, a CSV cut into months. The file never leaves the browser;
 * only the lines read are sent. A file that cannot prove a month — or cannot be
 * read at all — comes back as one statement saying why, so the person sees
 * every file they chose.
 */
import { rememberedColumns } from "@/lib/client/statement-columns";
import { detectStatementFormat } from "@/lib/domain/statement-files";
import { guessStatementColumns, readStatementCsv } from "@/lib/domain/statement-csv";
import {
  dateOrderReadings,
  readDateOrder,
  parseStatementRows,
  statementColumnsComplete,
} from "@/lib/domain/statement-import";
import {
  RUN_MESSAGES,
  cardRunStatement,
  monthsFromCsv,
  statementsFromPdf,
  type RunSource,
  type RunStatement,
} from "@/lib/domain/statement-run";
import type { BalanceSide } from "@/lib/domain/card-account";
import { readCardStatementSummary } from "@/lib/domain/card-statement-pdf";
import { rowsFromGlyphs } from "@/lib/domain/pdf-statement";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";

export interface RunBankAccount {
  id: string;
  maskedNumber: string | null;
  decimals: number;
  /** For the sentence a card statement's summary says when it does not add up. */
  currencyCode?: string;
  /** A credit card (2.46): its PDFs are read for their balances only, and nothing else is taken. */
  side?: BalanceSide;
}

const COLUMNS_NOT_RECOGNIZED = "Its columns were not recognized — import it once on Banking to choose them";
const COULD_NOT_READ = "This file could not be read";

/**
 * A run cannot stop to ask which way round a file writes its dates, and
 * guessing month first in silence is what 2.79 stopped Import statement doing.
 * The file waits, as one with unknown columns does, until an import on Banking
 * has asked and remembered the answer for this account.
 */
export function datesReadTwoWays(example: string): string {
  const { mdy, dmy } = dateOrderReadings(example);
  return `Its dates read two ways: ${example} is ${mdy} month first, or ${dmy} day first — import it once on Banking to choose`;
}

const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

function unreadable(fileName: string, source: RunSource, problem: string): RunStatement {
  return {
    key: `${fileName}#unreadable`,
    fileName,
    source,
    from: null,
    to: null,
    openingMinor: null,
    closingMinor: null,
    lines: [],
    problem,
    outByMinor: null,
  };
}

async function readPdf(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
  const result = await readPdfStatementFile(file, bank.decimals);
  if ("message" in result) return [unreadable(file.name, "PDF", result.message)];
  return statementsFromPdf(file.name, result.statements, bank.maskedNumber);
}

/**
 * A credit card's PDF statement (2.46): its summary — cycle, previous and new
 * balance — and no lines. The transactions are the books' own, from the
 * card's CSV imported under Banking.
 */
async function readCardPdf(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  if (bank.decimals !== 2) return [unreadable(file.name, "PDF", PDF_MESSAGES.cents)];
  const { readPdfGlyphs } = await import("@/lib/client/pdf-text");
  const result = await readPdfGlyphs(await file.arrayBuffer());
  if ("failure" in result) return [unreadable(file.name, "PDF", PDF_MESSAGES[result.failure])];
  if (!result.glyphs.length) return [unreadable(file.name, "PDF", PDF_MESSAGES.scanned)];
  const summary = readCardStatementSummary(rowsFromGlyphs(result.glyphs));
  if (!summary) return [unreadable(file.name, "PDF", RUN_MESSAGES.notACardStatement)];
  const money = (minor: number) => formatMoney(minor, bank.currencyCode ?? "USD", bank.decimals);
  return [cardRunStatement(file.name, summary, bank.maskedNumber, money)];
}

async function readFile(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  if (bank.side === "card") {
    if (isPdfFile(file)) return readCardPdf(file, bank);
    return [unreadable(file.name, "CSV", RUN_MESSAGES.cardNeedsPdf)];
  }
  if (isPdfFile(file)) return readPdf(file, bank);
  const text = await file.text();
  const verdict = detectStatementFormat(file.name, text);
  if ("unsupported" in verdict) return [unreadable(file.name, "CSV", verdict.unsupported)];
  if (verdict.format === "pdf") return readPdf(file, bank);
  if (verdict.format !== "csv") return [unreadable(file.name, "CSV", RUN_MESSAGES.noBalanceFormat)];

  // Read as the import dialog reads it: a preamble set aside, a headless file read by its columns.
  const { headers, records } = readStatementCsv(text);
  const remembered = rememberedColumns(bank.id, headers);
  const columns = remembered?.columns ?? guessStatementColumns(headers, records);
  if (!statementColumnsComplete(columns)) return [unreadable(file.name, "CSV", COLUMNS_NOT_RECOGNIZED)];
  const reading = remembered ? null : readDateOrder(records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
  if (reading?.example) return [unreadable(file.name, "CSV", datesReadTwoWays(reading.example))];
  const dateOrder = remembered?.dateOrder ?? reading?.order ?? "mdy";
  const { rows } = parseStatementRows(records, {
    decimals: bank.decimals,
    columns,
    dateOrder,
    flipSigns: remembered?.flipSigns ?? false,
  });
  const months = monthsFromCsv(file.name, rows);
  return months.length ? months : [unreadable(file.name, "CSV", RUN_MESSAGES.noLines)];
}

export async function readRunFile(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  try {
    return await readFile(file, bank);
  } catch {
    // A file the browser cannot open, or a reader that fails on it, is still a
    // row that says so — never a file that silently drops out of the run.
    return [unreadable(file.name, isPdfFile(file) ? "PDF" : "CSV", COULD_NOT_READ)];
  }
}
