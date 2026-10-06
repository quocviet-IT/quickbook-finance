/**
 * One statement file read in the browser into the statements of a run: a PDF
 * by 1.78's reader, a CSV cut into months. The file never leaves the browser;
 * only the lines read are sent. A file that cannot prove a month — or cannot be
 * read at all — comes back as one statement saying why, so the person sees
 * every file they chose.
 */
import { parseCsv } from "@/lib/csv";
import { rememberedColumns } from "@/lib/client/statement-columns";
import { detectStatementFormat } from "@/lib/domain/statement-files";
import {
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
} from "@/lib/domain/statement-import";
import { RUN_MESSAGES, monthsFromCsv, statementsFromPdf, type RunSource, type RunStatement } from "@/lib/domain/statement-run";

export interface RunBankAccount {
  id: string;
  maskedNumber: string | null;
  decimals: number;
}

const COLUMNS_NOT_RECOGNIZED = "Its columns were not recognized — import it once on Banking to choose them";
const COULD_NOT_READ = "This file could not be read";

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

async function readFile(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  if (isPdfFile(file)) return readPdf(file, bank);
  const text = await file.text();
  const verdict = detectStatementFormat(file.name, text);
  if ("unsupported" in verdict) return [unreadable(file.name, "CSV", verdict.unsupported)];
  if (verdict.format === "pdf") return readPdf(file, bank);
  if (verdict.format !== "csv") return [unreadable(file.name, "CSV", RUN_MESSAGES.noBalanceFormat)];

  const records = parseCsv(text);
  const headers = records.length ? Object.keys(records[0]) : [];
  const remembered = rememberedColumns(bank.id, headers);
  const columns = remembered?.columns ?? detectStatementColumns(headers).columns;
  if (!statementColumnsComplete(columns)) return [unreadable(file.name, "CSV", COLUMNS_NOT_RECOGNIZED)];
  const dateOrder = remembered?.dateOrder ?? detectDateOrder(records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
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
