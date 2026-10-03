/**
 * Cents, once: the prototype keeps two-decimal floating-point dollars; the
 * harness and OneBook work in integer cents.
 */
import type { ParityPosting } from "./types.ts";

export function toCents(dollars: number): number {
  const cents = Math.round(Math.abs(dollars) * 100 + 1e-6);
  if (cents === 0) return 0;
  return dollars < 0 ? -cents : cents;
}

/** One line of acc_post_manual_journal's p_lines. */
export interface JournalLineInput {
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  memo: string | null;
}

/** A prototype entry's postings as manual-journal lines, or why they cannot be posted. */
export function journalLines(
  postings: readonly ParityPosting[],
  accountIds: ReadonlyMap<string, string>,
): { lines: JournalLineInput[] } | { problem: string } {
  const lines: JournalLineInput[] = [];
  let net = 0;
  for (const posting of postings) {
    if (posting.cents === 0) continue;
    const accountId = accountIds.get(posting.account);
    if (!accountId) return { problem: `no account for ${posting.account}` };
    lines.push({
      account_id: accountId,
      debit_minor: posting.cents > 0 ? posting.cents : 0,
      credit_minor: posting.cents < 0 ? -posting.cents : 0,
      memo: null,
    });
    net += posting.cents;
  }
  if (lines.length < 2) return { problem: "fewer than two non-zero postings" };
  if (net !== 0) return { problem: `does not balance by ${net} cent(s)` };
  return { lines };
}
