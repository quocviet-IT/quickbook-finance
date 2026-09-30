/**
 * The one proposal each line of an imported statement gets on Review import.
 *
 * First that applies: a line already handled or still pending is left alone;
 * then a match to an entry already in the books; then the one open invoice or
 * bill whose balance is exactly this amount; then a rule or history (1.70).
 * Two open documents of the same amount give no proposal at all — money that
 * probably pays a document must not be coded to income or expense.
 */
import type { CodingSuggestionView } from "./coding";

export const REVIEW_POST_CHUNK = 50;

export interface ReviewLineFacts {
  id: string;
  status: string;
  pending: boolean;
  amountMinor: number;
  currencyCode: string;
}

export interface ReviewMatch {
  reconciliationId: string;
  entryNumber: string | null;
}

export interface ReviewDocument {
  documentId: string;
  documentNumber: string | null;
  partyName: string;
  balanceDueMinor: number;
  currencyCode: string;
  direction: "receivable" | "payable";
}

export type ReviewProposal =
  | { kind: "handled"; why: string }
  | { kind: "match"; reconciliationId: string; label: string; why: string }
  | { kind: "document"; documentId: string; label: string; why: string }
  | { kind: "account"; accountId: string; label: string; why: string }
  | { kind: "none"; why: string };

export function reviewProposal(input: {
  line: ReviewLineFacts;
  match: ReviewMatch | null;
  documents: readonly ReviewDocument[];
  coding: CodingSuggestionView | null;
}): ReviewProposal {
  const { line, match, documents, coding } = input;
  if (line.pending) return { kind: "handled", why: "Pending at the bank — it can be posted once it clears" };
  if (line.status !== "unmatched") return { kind: "handled", why: "Already handled on Bank Transactions" };
  if (match) {
    return {
      kind: "match",
      reconciliationId: match.reconciliationId,
      label: `Already in the books · ${match.entryNumber ?? "entry"}`,
      why: "This amount is already posted to the bank account; posting approves the match and adds no entry",
    };
  }
  const direction = line.amountMinor > 0 ? "receivable" : line.amountMinor < 0 ? "payable" : null;
  const noun = direction === "payable" ? "bill" : "invoice";
  const exact = direction
    ? documents.filter(
        (d) => d.direction === direction && d.currencyCode === line.currencyCode && d.balanceDueMinor === Math.abs(line.amountMinor),
      )
    : [];
  if (exact.length === 1) {
    const [only] = exact;
    return {
      kind: "document",
      documentId: only.documentId,
      label: `Pays ${only.documentNumber ?? noun} · ${only.partyName}`,
      why: `The only open ${noun} for exactly this amount`,
    };
  }
  if (exact.length > 1) {
    return { kind: "none", why: `${exact.length} open ${noun}s of this amount — use Settle on Bank Transactions` };
  }
  if (coding) return { kind: "account", accountId: coding.accountId, label: coding.accountLabel, why: coding.why };
  return { kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" };
}

export type ReviewPostItem =
  | { transactionId: string; kind: "match"; reconciliationId: string }
  | { transactionId: string; kind: "document"; documentId: string }
  | { transactionId: string; kind: "account"; accountId: string };

/** The Post as picker holds one string per line: the proposal's own, or an account a person picked. */
export function proposalValue(proposal: ReviewProposal): string | null {
  if (proposal.kind === "match") return `match:${proposal.reconciliationId}`;
  if (proposal.kind === "document") return `document:${proposal.documentId}`;
  if (proposal.kind === "account") return `account:${proposal.accountId}`;
  return null;
}

export function itemFromValue(transactionId: string, value: string | null): ReviewPostItem | null {
  if (!value) return null;
  const colon = value.indexOf(":");
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (colon < 1 || !id) return null;
  if (kind === "match") return { transactionId, kind, reconciliationId: id };
  if (kind === "document") return { transactionId, kind, documentId: id };
  if (kind === "account") return { transactionId, kind, accountId: id };
  return null;
}

export function chunked<T>(items: readonly T[], size = REVIEW_POST_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
