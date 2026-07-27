/**
 * Pure rule-based reconciliation (v0): match incoming bank transactions to
 * recorded customer payments by amount + reference + date proximity.
 * Produces scored, one-to-one suggestions; a human approves them.
 */

export interface BankTxnLite {
  id: string;
  txnDate: string; // YYYY-MM-DD
  amountMinor: number; // signed; >0 money in
  description: string;
  reference: string | null;
}

export interface PaymentLite {
  id: string;
  paymentDate: string;
  amountMinor: number; // >0
  number: string | null;
  customerName: string;
}

export interface MatchSuggestion {
  bankTransactionId: string;
  paymentId: string;
  confidence: number; // 0..1
  rule: string;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return Math.round(ms / 86_400_000);
}

/**
 * Score a candidate (txn, payment) pair. Returns null when the amounts don't
 * match — amount equality is a hard requirement for an auto-suggestion.
 */
export function scoreMatch(txn: BankTxnLite, payment: PaymentLite): { score: number; rule: string } | null {
  if (txn.amountMinor <= 0) return null; // only incoming money matches payments
  if (txn.amountMinor !== payment.amountMinor) return null;

  const reasons: string[] = ["amount"];
  let score = 0.6;

  const haystack = `${txn.reference ?? ""} ${txn.description}`.toLowerCase();
  if (payment.number && haystack.includes(payment.number.toLowerCase())) {
    score += 0.25;
    reasons.push("reference");
  } else if (payment.customerName && haystack.includes(payment.customerName.toLowerCase())) {
    score += 0.2;
    reasons.push("customer");
  }

  const days = daysBetween(txn.txnDate, payment.paymentDate);
  if (days <= 2) {
    score += 0.15;
    reasons.push("date");
  } else if (days <= 7) {
    score += 0.08;
    reasons.push("date~");
  } else if (days > 30) {
    return null; // too far apart to auto-suggest
  }

  return { score: Math.min(1, Number(score.toFixed(3))), rule: reasons.join("+") };
}

/**
 * Greedy one-to-one matcher: strongest matches first; each bank transaction and
 * each payment is used at most once.
 */
export function matchTransactions(txns: BankTxnLite[], payments: PaymentLite[]): MatchSuggestion[] {
  const pairs: MatchSuggestion[] = [];
  for (const t of txns) {
    for (const p of payments) {
      const s = scoreMatch(t, p);
      if (s) pairs.push({ bankTransactionId: t.id, paymentId: p.id, confidence: s.score, rule: s.rule });
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence);

  const usedTxn = new Set<string>();
  const usedPay = new Set<string>();
  const result: MatchSuggestion[] = [];
  for (const pair of pairs) {
    if (usedTxn.has(pair.bankTransactionId) || usedPay.has(pair.paymentId)) continue;
    usedTxn.add(pair.bankTransactionId);
    usedPay.add(pair.paymentId);
    result.push(pair);
  }
  return result;
}

export interface LedgerMatchCandidate {
  journalLineId: string;
  journalEntryId: string;
  entryDate: string;
  amountMinor: number; // signed from the bank account's perspective
  entryNumber: string;
  sourceType: string;
  sourceId: string | null;
  description: string;
  reference: string | null;
}

export interface LedgerMatchSuggestion {
  bankTransactionId: string;
  journalLineId: string;
  confidence: number;
  rule: string;
}

function normalizedTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

/** Score an immutable bank line against the corresponding posted bank-GL line. */
export function scoreLedgerMatch(
  txn: BankTxnLite,
  candidate: LedgerMatchCandidate,
): { score: number; rule: string } | null {
  if (txn.amountMinor === 0 || txn.amountMinor !== candidate.amountMinor) return null;

  const days = daysBetween(txn.txnDate, candidate.entryDate);
  if (days > 30) return null;

  let score = 0.62;
  const reasons = ["amount"];
  if (days <= 2) {
    score += 0.2;
    reasons.push("date");
  } else if (days <= 7) {
    score += 0.12;
    reasons.push("date~");
  } else {
    score += 0.04;
    reasons.push("date-window");
  }

  const bankText = `${txn.reference ?? ""} ${txn.description}`.toLowerCase();
  const exactReferences = [candidate.entryNumber, candidate.reference]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.toLowerCase());
  if (exactReferences.some((value) => bankText.includes(value))) {
    score += 0.16;
    reasons.push("reference");
  } else {
    const bankTokens = normalizedTokens(bankText);
    const ledgerTokens = normalizedTokens(`${candidate.description} ${candidate.reference ?? ""}`);
    const overlap = [...bankTokens].filter((token) => ledgerTokens.has(token)).length;
    if (overlap >= 2) {
      score += 0.1;
      reasons.push("description");
    } else if (overlap === 1) {
      score += 0.05;
      reasons.push("description~");
    }
  }

  return { score: Math.min(1, Number(score.toFixed(3))), rule: reasons.join("+") };
}

/**
 * Strongest-first, one-to-one matching at journal-line level. Journal line is
 * the correct grain because a transfer journal can contain two different bank
 * account lines.
 */
export function matchLedgerTransactions(
  txns: BankTxnLite[],
  candidates: LedgerMatchCandidate[],
): LedgerMatchSuggestion[] {
  const pairs: LedgerMatchSuggestion[] = [];
  for (const txn of txns) {
    for (const candidate of candidates) {
      const scored = scoreLedgerMatch(txn, candidate);
      if (scored) {
        pairs.push({
          bankTransactionId: txn.id,
          journalLineId: candidate.journalLineId,
          confidence: scored.score,
          rule: scored.rule,
        });
      }
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence);

  const usedTransactions = new Set<string>();
  const usedJournalLines = new Set<string>();
  return pairs.filter((pair) => {
    if (usedTransactions.has(pair.bankTransactionId) || usedJournalLines.has(pair.journalLineId)) {
      return false;
    }
    usedTransactions.add(pair.bankTransactionId);
    usedJournalLines.add(pair.journalLineId);
    return true;
  });
}
