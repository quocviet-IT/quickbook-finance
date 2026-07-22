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
