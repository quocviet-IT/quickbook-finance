/**
 * Balance assertions for the Beancount file: one per completed bank
 * reconciliation, carrying the book balance on the statement date as it stood
 * when the reconciliation was completed.
 *
 * Not the statement balance: Beancount checks the whole account, and the books
 * differ from the statement by whatever has not cleared yet, so the statement
 * figure would fail correct books. Not today's balance either: the file is
 * built from today's books, so that figure would always pass and prove
 * nothing. The figure as it stood at completion is the one that was agreed,
 * and an entry added, voided or missed in that period since makes bean-check
 * refuse the file.
 *
 * Rebuilt from `posted_at` and `voided_at`, which is exact because posted lines
 * cannot change: the only change a posted entry can undergo is being voided.
 *
 * Pure: it imports nothing from `@/lib/db` or `@/lib/services`.
 */

export interface CompletedReconciliation {
  id: string;
  bankAccountId: string;
  /** YYYY-MM-DD. */
  statementDate: string;
  statementMinor: number;
  /** ISO timestamp. */
  completedAt: string;
}

export interface ReconciledBankAccount {
  id: string;
  /** The GL account the bank account posts to. */
  glAccountId: string;
  currencyCode: string;
}

/** A line on a bank's GL account, with what its entry was and when. Void entries included. */
export interface BankLedgerLine {
  id: string;
  accountId: string;
  debitMinor: number;
  creditMinor: number;
  entryDate: string;
  currencyCode: string;
  status: "posted" | "void";
  postedAt: string;
  voidedAt: string | null;
}

export interface ClearedLine {
  reconciliationId: string;
  journalLineId: string;
}

export interface BalanceAssertionRows {
  /** Completed reconciliations only. */
  reconciliations: readonly CompletedReconciliation[];
  bankAccounts: readonly ReconciledBankAccount[];
  lines: readonly BankLedgerLine[];
  cleared: readonly ClearedLine[];
}

interface AssertionBase {
  reconciliationId: string;
  /** The day after the statement: Beancount checks a balance at the start of its day. */
  date: string;
  /** The GL account. */
  accountId: string;
  statementDate: string;
}

export type BalanceAssertion =
  | (AssertionBase & {
      kind: "balance";
      amountMinor: number;
      currencyCode: string;
      statementMinor: number;
      /** Lines counted that neither this reconciliation nor an earlier completed one cleared. */
      unclearedCount: number;
    })
  | (AssertionBase & { kind: "skipped"; reason: "currency"; currencyCode: string })
  | (AssertionBase & { kind: "skipped"; reason: "unknown-void" });

/** The calendar day after an ISO date. */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const at = (iso: string) => Date.parse(iso);

/** One assertion, or the reason there is none, per completed reconciliation; in date order. */
export function balanceAssertions(rows: BalanceAssertionRows, baseCurrency: string): BalanceAssertion[] {
  const bankById = new Map(rows.bankAccounts.map((b) => [b.id, b]));
  const reconById = new Map(rows.reconciliations.map((r) => [r.id, r]));
  // Which completed reconciliations cleared each line.
  const clearedBy = new Map<string, string[]>();
  for (const c of rows.cleared) {
    if (!reconById.has(c.reconciliationId)) continue;
    clearedBy.set(c.journalLineId, [...(clearedBy.get(c.journalLineId) ?? []), c.reconciliationId]);
  }

  const out: BalanceAssertion[] = [];
  for (const r of rows.reconciliations) {
    const bank = bankById.get(r.bankAccountId);
    if (!bank) throw new Error(`The reconciliation of ${r.statementDate} names a bank account that was not read`);
    const base: AssertionBase = {
      reconciliationId: r.id,
      date: nextDay(r.statementDate),
      accountId: bank.glAccountId,
      statementDate: r.statementDate,
    };
    const completed = at(r.completedAt);
    const inPeriod = rows.lines.filter((l) => l.accountId === bank.glAccountId && l.entryDate <= r.statementDate);

    if (inPeriod.some((l) => l.status === "void" && l.voidedAt === null && at(l.postedAt) <= completed)) {
      out.push({ ...base, kind: "skipped", reason: "unknown-void" });
      continue;
    }

    const counted = inPeriod.filter(
      (l) =>
        at(l.postedAt) <= completed &&
        (l.status === "posted" || (l.voidedAt !== null && at(l.voidedAt) > completed)),
    );

    const foreign =
      bank.currencyCode !== baseCurrency
        ? bank.currencyCode
        : counted.find((l) => l.currencyCode !== baseCurrency)?.currencyCode;
    if (foreign) {
      out.push({ ...base, kind: "skipped", reason: "currency", currencyCode: foreign });
      continue;
    }

    const clearedHereOrBefore = (reconId: string) => {
      if (reconId === r.id) return true;
      const other = reconById.get(reconId);
      return other !== undefined && other.bankAccountId === r.bankAccountId && other.statementDate < r.statementDate;
    };

    out.push({
      ...base,
      kind: "balance",
      amountMinor: counted.reduce((sum, l) => sum + l.debitMinor - l.creditMinor, 0),
      currencyCode: bank.currencyCode,
      statementMinor: r.statementMinor,
      unclearedCount: counted.filter((l) => !(clearedBy.get(l.id) ?? []).some(clearedHereOrBefore)).length,
    });
  }

  return out.sort((x, y) => x.date.localeCompare(y.date) || x.reconciliationId.localeCompare(y.reconciliationId));
}
