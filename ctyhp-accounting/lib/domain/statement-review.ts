/**
 * The one proposal each line of an imported statement gets on Review import.
 *
 * First that applies: a line already handled or still pending is left alone;
 * then a match to an entry already in the books; then the one open invoice or
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75), or nothing when two cards or loans claim the line;
 * then a rule or history (1.70).
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

/** A pair this line belongs to, in the words the screen shows. */
export interface ReviewPairView {
  kind: "transfer" | "funding";
  counterpartId: string;
  label: string;
  why: string;
  /** The funding pair as a second choice: "possible shareholder funding with …". */
  also: string;
}

export type ReviewProposal =
  | { kind: "handled"; why: string }
  | { kind: "match"; reconciliationId: string; label: string; why: string }
  | { kind: "document"; documentId: string; label: string; why: string }
  | { kind: "transfer"; counterpartId: string; label: string; why: string }
  | { kind: "funding"; counterpartId: string; label: string; why: string }
  | { kind: "account"; accountId: string; label: string; why: string; alternative?: ReviewPairView; repayment?: "card" }
  | { kind: "none"; why: string };

export function reviewProposal(input: {
  line: ReviewLineFacts;
  match: ReviewMatch | null;
  documents: readonly ReviewDocument[];
  coding: CodingSuggestionView | null;
  /** A transfer or funding pair this line belongs to (bank-pairs.ts). */
  pair?: ReviewPairView | null;
  /** How many lines could be the other side, when more than one could. */
  pairRivals?: number;
  /** Another of the company's bank accounts this line names as a transfer. */
  namedTransfer?: { accountId: string; label: string; why: string } | null;
  /** How many registered cards or loans claim this line, when more than one does. */
  repaymentRivals?: number;
}): ReviewProposal {
  const { line, match, documents, coding, pair, pairRivals, namedTransfer, repaymentRivals } = input;
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
  // A transfer is matched against something real — the other line — so it
  // outranks anything guessed from a word or from history.
  if (pair?.kind === "transfer") {
    return { kind: "transfer", counterpartId: pair.counterpartId, label: pair.label, why: pair.why };
  }
  if (namedTransfer) {
    return { kind: "account", accountId: namedTransfer.accountId, label: namedTransfer.label, why: namedTransfer.why };
  }
  // Two registered cards or loans claim this line: which balance it repays is
  // a person's call, and a rule or history must not guess it as a cost.
  if (repaymentRivals && repaymentRivals > 1) {
    return { kind: "none", why: `Matches ${repaymentRivals} cards or loans — code it yourself` };
  }
  // Funding is only ever a suggestion: a rule or history keeps its place, and
  // the pair is offered beside it.
  const funding = pair?.kind === "funding" ? pair : null;
  if (coding) {
    const isCard = coding.source === "card";
    const proposal = {
      kind: "account" as const,
      accountId: coding.accountId,
      label: isCard ? `Card payment · ${coding.accountLabel}` : coding.accountLabel,
      why: coding.why,
      ...(isCard ? { repayment: "card" as const } : {}),
    };
    return funding ? { ...proposal, why: `${coding.why}. Also: ${funding.also}`, alternative: funding } : proposal;
  }
  if (funding) return { kind: "funding", counterpartId: funding.counterpartId, label: funding.label, why: funding.why };
  if (pairRivals && pairRivals > 1) {
    return { kind: "none", why: `${pairRivals} lines could be the other side — code it yourself` };
  }
  return { kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" };
}

export type ReviewPostItem =
  | { transactionId: string; kind: "match"; reconciliationId: string }
  | { transactionId: string; kind: "document"; documentId: string }
  | { transactionId: string; kind: "account"; accountId: string }
  | { transactionId: string; kind: "pair"; pairKind: "transfer" | "funding"; counterpartId: string };

/** The Post as picker holds one string per line: the proposal's own, or an account a person picked. */
export function proposalValue(proposal: ReviewProposal): string | null {
  if (proposal.kind === "match") return `match:${proposal.reconciliationId}`;
  if (proposal.kind === "document") return `document:${proposal.documentId}`;
  if (proposal.kind === "account") return `account:${proposal.accountId}`;
  if (proposal.kind === "transfer" || proposal.kind === "funding") return `pair:${proposal.kind}:${proposal.counterpartId}`;
  return null;
}

/** A funding pair offered beside a rule or history proposal. */
export function alternativeValue(proposal: ReviewProposal): string | null {
  return proposal.kind === "account" && proposal.alternative ? `pair:funding:${proposal.alternative.counterpartId}` : null;
}

/** A funding pair is a suggestion only; everything else with a value starts ticked. */
export function startsTicked(proposal: ReviewProposal): boolean {
  return proposalValue(proposal) !== null && proposal.kind !== "funding";
}

export function itemFromValue(transactionId: string, value: string | null): ReviewPostItem | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts[0] === "pair") {
    const [, pairKind, counterpartId] = parts;
    if (parts.length !== 3 || !counterpartId || (pairKind !== "transfer" && pairKind !== "funding")) return null;
    return { transactionId, kind: "pair", pairKind, counterpartId };
  }
  const kind = parts[0];
  const id = parts.slice(1).join(":");
  if (!kind || !id) return null;
  if (kind === "match") return { transactionId, kind, reconciliationId: id };
  if (kind === "document") return { transactionId, kind, documentId: id };
  if (kind === "account") return { transactionId, kind, accountId: id };
  return null;
}

/** The value the other line of a pair takes when this one chooses the pair. */
export function reciprocalValue(value: string | null, lineId: string): string | null {
  const parts = (value ?? "").split(":");
  return parts[0] === "pair" && parts.length === 3 ? `pair:${parts[1]}:${lineId}` : null;
}

export function pairKey(item: Extract<ReviewPostItem, { kind: "pair" }>): string {
  return `${item.pairKind}:${[item.transactionId, item.counterpartId].sort().join(":")}`;
}

/** A pair ticked on both of its lines is posted once. */
export function dedupePairItems(items: readonly ReviewPostItem[]): ReviewPostItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== "pair") return true;
    const key = pairKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function chunked<T>(items: readonly T[], size = REVIEW_POST_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
