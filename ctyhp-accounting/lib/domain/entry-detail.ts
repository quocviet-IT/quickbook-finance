/**
 * One journal entry, opened: the "Transaction detail" sheet of the client's
 * prototype (`drillTxn` in Accounting-System-v3.html).
 *
 * The sheet shows who the entry was with, the document behind it and its
 * lines, the double entry, what settled it or what it settled, and the entry
 * as Beancount writes it. This module holds the shape and the few rules the
 * screen needs; reading it is `lib/services/entry-detail.ts`.
 *
 * Pure. Money is integer minor units in the entry's own currency.
 */

/** What each kind of entry is called on screen, in a tag beside its number. */
const SOURCE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  manual: "Journal",
  bank: "Bank",
  reconciliation: "Reconciliation",
  opening_balance: "Opening",
  bill: "Bill",
  expense: "Expense",
  bill_payment: "Bill payment",
  tax_payment: "Tax payment",
  goods_receipt: "Goods receipt",
  inventory: "Inventory",
  inventory_adjustment: "Stock adjustment",
  depreciation: "Depreciation",
  asset_disposal: "Asset disposal",
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABEL[sourceType] ?? sourceType.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * The side of the business an entry belongs to, which colours its tag.
 *
 * The prototype tints sales documents, purchase documents, cash movements and
 * plain journals differently, so a column of tags can be read at a glance.
 */
export type SourceTone = "sales" | "purchases" | "cash" | "ledger";

export function sourceTone(sourceType: string): SourceTone {
  if (sourceType === "invoice" || sourceType === "payment") return "sales";
  if (sourceType === "bill" || sourceType === "bill_payment" || sourceType === "expense" || sourceType === "goods_receipt") {
    return "purchases";
  }
  if (sourceType === "bank" || sourceType === "reconciliation" || sourceType === "tax_payment") return "cash";
  return "ledger";
}

export interface EntryDetailLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  memo: string | null;
}

/** A line of the invoice, bill or expense behind the entry. */
export interface EntryDocumentLine {
  account: string;
  description: string;
  /** As the document stored it; null where the document has no quantity. */
  quantity: string | null;
  rateMinor: number | null;
  amountMinor: number;
}

export type EntryDocumentKind = "invoice" | "bill" | "payment" | "bill_payment" | "expense";

export interface EntryDocument {
  kind: EntryDocumentKind;
  number: string | null;
  dueDate: string | null;
  /** Sales tax on an invoice, shown as its own line under the document lines. */
  taxMinor: number;
  totalMinor: number;
}

/** A payment against this document, or a document this payment settled. */
export interface EntryRelatedRow {
  /** The related document's own journal entry, so the sheet can open it. */
  entryId: string | null;
  date: string;
  sourceType: string;
  number: string | null;
  label: string;
  appliedMinor: number;
}

export interface EntrySettlement {
  heading: "Settlement" | "Applied to";
  rows: EntryRelatedRow[];
  totalLabel: "Open balance" | "Total applied";
  totalMinor: number;
}

export interface EntryDetail {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  status: "posted" | "void";
  currencyCode: string;
  decimals: number;
  /** The customer or vendor, when the entry has one. */
  party: string | null;
  document: EntryDocument | null;
  documentLines: EntryDocumentLine[];
  settlement: EntrySettlement | null;
  lines: EntryDetailLine[];
  /** The entry exactly as the Beancount export writes it. */
  beancount: string;
}

/**
 * The large name at the top of the sheet, and the line under it.
 *
 * The prototype leads with the payee and puts the narration beneath. An entry
 * from a bank statement usually has no customer or vendor, and its description
 * is the bank's own text — which is who the money went to or came from — so the
 * description takes the payee's place rather than leaving the heading blank.
 */
export function entryHeadline(detail: Pick<EntryDetail, "party" | "description" | "entryNumber">): {
  payee: string;
  narration: string | null;
} {
  const description = detail.description?.trim() || null;
  if (detail.party) return { payee: detail.party, narration: description };
  return { payee: description ?? detail.entryNumber, narration: null };
}

/** Debits, credits, and how far apart they are — which should be nothing. */
export function entryTotals(lines: readonly Pick<EntryDetailLine, "debitMinor" | "creditMinor">[]): {
  debitMinor: number;
  creditMinor: number;
  differenceMinor: number;
} {
  const debitMinor = lines.reduce((s, l) => s + l.debitMinor, 0);
  const creditMinor = lines.reduce((s, l) => s + l.creditMinor, 0);
  return { debitMinor, creditMinor, differenceMinor: debitMinor - creditMinor };
}

/**
 * The name to show for a row of the transaction list.
 *
 * The same rule as the sheet's heading: the customer or vendor, or else the
 * entry's own description — so a bank line reads as the bank described it
 * instead of as a dash.
 */
export function entryDisplayName(row: { partyName: string | null; description: string | null }): string {
  return row.partyName?.trim() || row.description?.trim() || "";
}
