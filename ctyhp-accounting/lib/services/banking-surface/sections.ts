import type { DerivedWorkItem, SurfaceControl } from "@/lib/domain/work-surface/types";
import { orderWork } from "@/lib/domain/work-surface/priority";
import {
  feedHealthControl,
  statementReconciliationControl,
  unmatchedActivityControl,
} from "@/lib/domain/banking-surface/controls";
import {
  brokenFeedItem,
  openReconciliationItem,
  QUEUE_UNMATCHED_LIMIT,
  unmatchedBankItem,
} from "@/lib/domain/banking-surface/queue-items";
import type { BankingContext, BankingFacts } from "./facts";
import { daysBetween, previousMonthEnd } from "./facts";

/**
 * The two sections, both derived from one read of the facts.
 *
 * Pure functions of `(facts, context, policy)`: no client, no clock, no
 * database. That is what lets the interesting decisions — which line is late,
 * which account is behind — be tested with plain objects rather than with a
 * seeded company.
 */

/** Settled and still unmatched, oldest first. Pending lines are not yet real. */
function unmatchedLines(facts: BankingFacts) {
  return facts.transactions.filter(
    (transaction) => transaction.status === "unmatched" && !transaction.pending,
  );
}

export function bankingControls(
  facts: BankingFacts,
  context: BankingContext,
  evaluatedAt: string,
): SurfaceControl[] {
  const unmatched = unmatchedLines(facts);
  const pending = facts.transactions.filter((transaction) => transaction.pending);
  const staleBefore = previousMonthEnd(context.asOf);

  // An account counts as current when a *completed* session reaches the date.
  // An in-progress one proves somebody started, not that anything tied out.
  const reachedBy = new Map<string, string>();
  for (const session of facts.sessions) {
    if (session.status !== "completed") continue;
    const best = reachedBy.get(session.bank_account_id);
    if (!best || session.statement_ending_date > best) {
      reachedBy.set(session.bank_account_id, session.statement_ending_date);
    }
  }
  const behindNames = facts.accounts
    .filter((account) => (reachedBy.get(account.id) ?? "") < staleBefore)
    .map((account) => account.name);

  return [
    unmatchedActivityControl({
      asOf: context.asOf,
      unmatchedCount: unmatched.length,
      oldestAgeDays: unmatched.length
        ? daysBetween(context.asOf, unmatched[0].txn_date)
        : null,
      pendingCount: pending.length,
      evaluatedAt,
    }),
    feedHealthControl({
      connectionCount: facts.feeds.length,
      brokenCount: facts.feeds.filter((feed) => feed.broken).length,
      brokenNames: facts.feeds.filter((feed) => feed.broken).map((feed) => feed.institutionName),
      evaluatedAt,
    }),
    statementReconciliationControl({
      accountCount: facts.accounts.length,
      behindNames,
      inProgressCount: facts.sessions.filter((session) => session.status === "in_progress").length,
      staleBefore,
      evaluatedAt,
    }),
  ];
}

export function bankingWorkQueue(
  facts: BankingFacts,
  context: BankingContext,
  ageLimitDays: number | null,
  confirmedAt: string,
): DerivedWorkItem[] {
  const names = new Map(facts.accounts.map((account) => [account.id, account.name]));
  const items: DerivedWorkItem[] = [];

  // Oldest first, then capped. Capping before sorting would hand back an
  // arbitrary fifty rather than the fifty that have waited longest.
  for (const line of unmatchedLines(facts).slice(0, QUEUE_UNMATCHED_LIMIT)) {
    items.push(
      unmatchedBankItem(
        {
          id: line.id,
          txnDate: line.txn_date,
          description: line.description,
          amountMinor: line.amount_minor,
          accountName: names.get(line.bank_account_id) ?? "Bank account",
        },
        {
          ageDays: daysBetween(context.asOf, line.txn_date),
          ageLimitDays,
          confirmedAt,
        },
      ),
    );
  }

  for (const feed of facts.feeds.filter((candidate) => candidate.broken)) {
    items.push(
      brokenFeedItem(
        {
          id: feed.id,
          institutionName: feed.institutionName,
          status: feed.status,
          lastError: feed.lastError,
        },
        {
          ageDays: feed.lastSyncAt ? daysBetween(context.asOf, feed.lastSyncAt) : 0,
          confirmedAt,
        },
      ),
    );
  }

  for (const session of facts.sessions.filter((candidate) => candidate.status === "in_progress")) {
    items.push(
      openReconciliationItem(
        {
          id: session.id,
          accountName: names.get(session.bank_account_id) ?? "Bank account",
          statementEndingDate: session.statement_ending_date,
        },
        { ageDays: daysBetween(context.asOf, session.created_at), confirmedAt },
      ),
    );
  }

  return orderWork(items);
}
