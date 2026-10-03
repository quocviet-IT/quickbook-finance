/**
 * What Import statement says about a PDF statement before it is imported:
 * which statement, its figures, and whether it proves itself. Pure, so the
 * wording is tested where it is written.
 */
import { statementProof, type PdfStatement } from "./pdf-statement";

export const PDF_MESSAGES = {
  scanned:
    "This PDF holds no text — it looks like a scanned image. Download the statement from online banking as a PDF, or as CSV, OFX or QFX.",
  password: "This PDF is locked with a password. Open it, save a copy without the password, and choose that copy.",
  unreadable: "This PDF could not be read.",
  noLines: "No dated amounts could be read out of this PDF.",
  cents: "A PDF statement can be read only into an account kept in a currency with two decimal places.",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Jan 1 – Jan 31, 2026", "Dec 15, 2025 – Jan 14, 2026", "closing Nov 30, 2026" or "no period printed". */
export function periodLabel(from: string | null, to: string | null): string {
  if (from && to) return `${shortDate(from, from.slice(0, 4) !== to.slice(0, 4))} – ${shortDate(to, true)}`;
  if (to) return `closing ${shortDate(to, true)}`;
  return "no period printed";
}

/** How a PDF that holds several statements offers each: "Account ending 1111 · Jan 1 – Jan 31, 2026 · 3 lines". */
export function statementLabel(s: PdfStatement): string {
  const account = s.accountNumber ? `Account ending ${s.accountNumber.slice(-4)}` : "Account not named";
  return `${account} · ${periodLabel(s.from, s.to)} · ${s.lines.length} line${s.lines.length === 1 ? "" : "s"}`;
}

/** The statement for the bank account being imported into: the one whose last four digits match, else the first. */
export function pickStatement(statements: readonly PdfStatement[], maskedNumber: string | null): number {
  const last4 = (maskedNumber ?? "").replace(/\D/g, "").slice(-4);
  if (last4.length < 4) return 0;
  const at = statements.findIndex((s) => (s.accountNumber ?? "").slice(-4) === last4);
  return at < 0 ? 0 : at;
}

export interface StatementSummary {
  moneyIn: { count: number; minor: number };
  /** The total paid out, as a positive amount. */
  moneyOut: { count: number; minor: number };
  proves: boolean;
  /** The one sentence under the figures. */
  proof: string;
}

/** The figures Import statement shows for a PDF, and its proof sentence. `money` formats minor units for the account. */
export function summarizeStatement(s: PdfStatement, money: (minor: number) => string): StatementSummary {
  const moneyIn = s.lines.filter((l) => l.amountMinor > 0);
  const moneyOut = s.lines.filter((l) => l.amountMinor < 0);
  const { linesMinor, differenceMinor } = statementProof(s);
  const lines = `${linesMinor < 0 ? "−" : "+"} lines ${money(Math.abs(linesMinor))}`;
  let proof: string;
  if (differenceMinor === null || s.openingMinor === null || s.closingMinor === null) {
    proof = "The statement shows no opening or closing balance, so it cannot prove itself.";
  } else if (differenceMinor === 0) {
    proof = `Opening ${money(s.openingMinor)} ${lines} = ${money(s.closingMinor)}, the closing balance on the statement.`;
  } else {
    proof =
      `Out by ${money(Math.abs(differenceMinor))}: opening ${money(s.openingMinor)} ${lines} comes to ` +
      `${money(s.openingMinor + linesMinor)}, and the statement closes at ${money(s.closingMinor)}. ` +
      "A line may not have been read — check before importing.";
  }
  return {
    moneyIn: { count: moneyIn.length, minor: moneyIn.reduce((sum, l) => sum + l.amountMinor, 0) },
    moneyOut: { count: moneyOut.length, minor: -moneyOut.reduce((sum, l) => sum + l.amountMinor, 0) },
    proves: differenceMinor === 0,
    proof,
  };
}

/** Said under the figures when a printed date does not exist. */
export function skippedNote(count: number): string {
  return count === 1
    ? "1 line dated a day that does not exist was left out."
    : `${count} lines dated a day that does not exist were left out.`;
}
