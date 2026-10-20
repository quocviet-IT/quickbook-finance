/**
 * The opening balances form, read as a draft: what it adds up to, what Opening
 * Balance Equity will take, and what still stands between it and Post.
 *
 * The UI review of 2026-10-20 found the empty form announcing, in green,
 * "Balanced. Debit = Credit = 0.00 USD." before anything had been typed, and a
 * Post button that stayed disabled with no word of why. An empty form is not
 * balanced — it is empty — and a disabled button owes the reader the list of
 * what it is waiting for.
 *
 * It also closes a gap: a line with an amount but no account counted in the
 * totals on screen and was then dropped when posting, so the entry posted was
 * not the one the reader saw. Such a line now holds Post until it has an
 * account.
 *
 * Pure: lines and a date in, a review out. The posting rule itself stays in
 * buildOpeningBalancePosting.
 */
import { formatDate, plural } from "@/lib/format";
import { buildOpeningBalancePosting } from "./posting";

export interface OpeningDraftLine {
  /** The line's place on screen, from 1, for "Choose an account for line 3". */
  line: number;
  accountId?: string | null;
  debitMinor: number;
  creditMinor: number;
}

/**
 * - `empty`: no line carries an amount yet. Neutral: nothing is wrong, and
 *   nothing is balanced either.
 * - `incomplete`: a line carries an amount but no account. Neutral too: the
 *   figures may add up, but this is not an entry that can post, and a green
 *   "Balanced" beside a disabled Post is the fault this module exists to end.
 * - `balanced`: debits equal credits, and nothing goes to Opening Balance Equity.
 * - `equity`: Opening Balance Equity takes the difference so the entry balances.
 */
export type OpeningDraftStatus = "empty" | "incomplete" | "balanced" | "equity";

export interface OpeningPostCondition {
  key: "date" | "amount" | "accounts";
  met: boolean;
  /** What is done, or what to do, in the reader's words. */
  label: string;
}

export interface OpeningDraftReview {
  status: OpeningDraftStatus;
  /** Lines that carry an amount. */
  entered: number;
  debitMinor: number;
  creditMinor: number;
  /** Opening Balance Equity's share: positive on the credit side, negative on the debit side, 0 when none. */
  equityMinor: number;
  /** Lines, from 1, that carry an amount but no account. */
  missingAccountLines: number[];
  /** Every condition for Post, met or not, in the order a reader would meet them. */
  conditions: OpeningPostCondition[];
  canPost: boolean;
}

const EQUITY = "__opening_balance_equity";

function lineList(lines: number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`;
  return `lines ${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]}`;
}

export function reviewOpeningDraft(lines: readonly OpeningDraftLine[], asOf: string | null): OpeningDraftReview {
  const withAmount = lines.filter((l) => l.debitMinor !== 0 || l.creditMinor !== 0);
  const debitMinor = withAmount.reduce((sum, l) => sum + l.debitMinor, 0);
  const creditMinor = withAmount.reduce((sum, l) => sum + l.creditMinor, 0);

  // A line without an account still counts toward what the entry adds up to;
  // it is given a stand-in so the posting rule can say what equity would take.
  const posting = buildOpeningBalancePosting(
    withAmount.map((l) => ({ accountId: l.accountId || `__line${l.line}`, debitMinor: l.debitMinor, creditMinor: l.creditMinor })),
    EQUITY,
  );
  const equityLine = posting.find((l) => l.accountId === EQUITY);
  const equityMinor = equityLine ? (equityLine.creditMinor > 0 ? equityLine.creditMinor : -equityLine.debitMinor) : 0;

  const missingAccount = withAmount.filter((l) => !l.accountId).map((l) => l.line);
  const conditions: OpeningPostCondition[] = [
    asOf
      ? { key: "date", met: true, label: `As of ${formatDate(asOf)}` }
      : { key: "date", met: false, label: "Choose the as-of date" },
    withAmount.length > 0
      ? { key: "amount", met: true, label: `${plural(withAmount.length, "balance")} entered` }
      : { key: "amount", met: false, label: "Enter at least one balance" },
    // With nothing entered, "every balance has an account" is true of nothing,
    // and a tick for it read as a step already done.
    withAmount.length === 0
      ? { key: "accounts", met: false, label: "Give every balance an account" }
      : missingAccount.length === 0
        ? { key: "accounts", met: true, label: "Every balance has an account" }
        : { key: "accounts", met: false, label: `Choose an account for ${lineList(missingAccount)}` },
  ];

  return {
    status:
      withAmount.length === 0
        ? "empty"
        : missingAccount.length > 0
          ? "incomplete"
          : equityMinor === 0
            ? "balanced"
            : "equity",
    entered: withAmount.length,
    debitMinor,
    creditMinor,
    equityMinor,
    missingAccountLines: missingAccount,
    conditions,
    canPost: conditions.every((c) => c.met),
  };
}
