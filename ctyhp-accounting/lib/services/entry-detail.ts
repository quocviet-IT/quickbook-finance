import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountNames,
  beancountEntryText,
  beancountNameWidth,
  type BeancountDocument,
} from "@/lib/domain/beancount";
import type {
  EntryDetail,
  EntryDetailLine,
  EntryDocument,
  EntryDocumentLine,
  EntryRelatedRow,
  EntrySettlement,
} from "@/lib/domain/entry-detail";
import { readBeancountAccounts } from "@/lib/services/beancount";
import { getTransactionList } from "@/lib/services/reports";

/**
 * Reading one journal entry for its detail sheet.
 *
 * Every call here reads. The sheet is opened from reports that promise never
 * to change a figure, and it keeps that promise: there is no insert, update,
 * delete or posting RPC in this file.
 *
 * Documents are found by the journal entry they posted (`journal_entry_id`),
 * never by matching document numbers to entry numbers — the two come from
 * separate sequences and are never equal.
 */
export class EntryDetailError extends Error {}

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

async function read<T>(label: string, query: PromiseLike<Result>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new EntryDetailError(`Reading ${label} failed: ${error.message}`);
  return data as T;
}

const nameOf = (v: unknown): string => (v as { name?: string } | null)?.name ?? "";
const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const accountLabel = (v: unknown): string => {
  const a = v as { account_code?: string; name?: string } | null;
  return a ? `${a.account_code ?? ""} ${a.name ?? ""}`.trim() : "";
};

/** The one document, of whichever kind, that posted this entry. */
async function findDocument(sb: SupabaseClient, entryId: string) {
  const one = (table: string, columns: string) =>
    read<Row[]>(table, sb.from(table).select(columns).eq("journal_entry_id", entryId).limit(1)).then((r) => r[0] ?? null);
  const [invoice, bill, payment, billPayment, expense] = await Promise.all([
    one("acc_invoice", "id,invoice_number,due_date,tax_total_minor,total_minor,balance_due_minor,acc_customer(name)"),
    one("acc_bill", "id,bill_number,due_date,total_minor,balance_due_minor,acc_vendor(name)"),
    one("acc_payment", "id,payment_number,reference,amount_minor,acc_customer(name)"),
    one("acc_bill_payment", "id,payment_number,reference,amount_minor,acc_vendor(name)"),
    one("acc_expense", "id,expense_number,total_minor,acc_vendor(name)"),
  ]);
  return { invoice, bill, payment, billPayment, expense };
}

interface DocumentPart {
  document: EntryDocument;
  party: string | null;
  lines: EntryDocumentLine[];
  settlement: EntrySettlement | null;
  beancount: BeancountDocument;
}

const live = (r: Row, embed: string) => (r[embed] as { status?: string } | null)?.status !== "void";

async function invoicePart(sb: SupabaseClient, inv: Row): Promise<DocumentPart> {
  const [lineRows, allocations] = await Promise.all([
    read<Row[]>(
      "acc_invoice_line",
      sb
        .from("acc_invoice_line")
        .select("description,quantity,unit_price_minor,line_subtotal_minor,line_order,acc_account(account_code,name)")
        .eq("invoice_id", inv.id as string)
        .order("line_order"),
    ),
    read<Row[]>(
      "acc_payment_allocation",
      sb
        .from("acc_payment_allocation")
        .select("amount_minor,acc_payment(payment_number,payment_date,journal_entry_id,status,reference,memo)")
        .eq("invoice_id", inv.id as string),
    ),
  ]);
  const number = text(inv.invoice_number);
  return {
    party: text(nameOf(inv.acc_customer)),
    document: {
      kind: "invoice",
      number,
      dueDate: text(inv.due_date),
      taxMinor: Number(inv.tax_total_minor ?? 0),
      totalMinor: Number(inv.total_minor),
    },
    lines: lineRows.map((l) => ({
      account: accountLabel(l.acc_account),
      description: String(l.description ?? ""),
      quantity: l.quantity === null || l.quantity === undefined ? null : String(Number(l.quantity)),
      rateMinor: Number(l.unit_price_minor),
      amountMinor: Number(l.line_subtotal_minor),
    })),
    settlement: {
      heading: "Settlement",
      rows: allocations.filter((a) => live(a, "acc_payment")).map((a) => {
        const p = a.acc_payment as Row;
        return {
          entryId: text(p.journal_entry_id),
          date: String(p.payment_date),
          sourceType: "payment",
          number: text(p.payment_number),
          label: text(p.reference) ?? text(p.memo) ?? "",
          appliedMinor: Number(a.amount_minor),
        } satisfies EntryRelatedRow;
      }),
      totalLabel: "Open balance",
      totalMinor: Number(inv.balance_due_minor),
    },
    beancount: { links: number ? [number] : [], reference: null, dueDate: text(inv.due_date) },
  };
}

async function billPart(sb: SupabaseClient, bill: Row): Promise<DocumentPart> {
  const [lineRows, allocations] = await Promise.all([
    read<Row[]>(
      "acc_bill_line",
      sb
        .from("acc_bill_line")
        .select("description,quantity,unit_cost_minor,amount_minor,line_order,acc_account(account_code,name)")
        .eq("bill_id", bill.id as string)
        .order("line_order"),
    ),
    read<Row[]>(
      "acc_bill_payment_allocation",
      sb
        .from("acc_bill_payment_allocation")
        .select("amount_minor,acc_bill_payment(payment_number,payment_date,journal_entry_id,status,reference,memo)")
        .eq("bill_id", bill.id as string),
    ),
  ]);
  const number = text(bill.bill_number);
  return {
    party: text(nameOf(bill.acc_vendor)),
    document: {
      kind: "bill",
      number,
      dueDate: text(bill.due_date),
      taxMinor: 0,
      totalMinor: Number(bill.total_minor),
    },
    lines: lineRows.map((l) => ({
      account: accountLabel(l.acc_account),
      description: String(l.description ?? ""),
      quantity: l.quantity === null || l.quantity === undefined ? null : String(Number(l.quantity)),
      rateMinor: l.unit_cost_minor === null || l.unit_cost_minor === undefined ? null : Number(l.unit_cost_minor),
      amountMinor: Number(l.amount_minor),
    })),
    settlement: {
      heading: "Settlement",
      rows: allocations.filter((a) => live(a, "acc_bill_payment")).map((a) => {
        const p = a.acc_bill_payment as Row;
        return {
          entryId: text(p.journal_entry_id),
          date: String(p.payment_date),
          sourceType: "bill_payment",
          number: text(p.payment_number),
          label: text(p.reference) ?? text(p.memo) ?? "",
          appliedMinor: Number(a.amount_minor),
        } satisfies EntryRelatedRow;
      }),
      totalLabel: "Open balance",
      totalMinor: Number(bill.balance_due_minor),
    },
    beancount: { links: number ? [number] : [], reference: null, dueDate: text(bill.due_date) },
  };
}

async function paymentPart(sb: SupabaseClient, pay: Row, kind: "payment" | "bill_payment"): Promise<DocumentPart> {
  const customer = kind === "payment";
  const allocations = await read<Row[]>(
    customer ? "acc_payment_allocation" : "acc_bill_payment_allocation",
    customer
      ? sb
          .from("acc_payment_allocation")
          .select("amount_minor,acc_invoice(invoice_number,issue_date,journal_entry_id,status,memo)")
          .eq("payment_id", pay.id as string)
      : sb
          .from("acc_bill_payment_allocation")
          .select("amount_minor,acc_bill(bill_number,bill_date,journal_entry_id,status,vendor_ref,memo)")
          .eq("bill_payment_id", pay.id as string),
  );
  const rows: EntryRelatedRow[] = allocations.map((a) => {
    const d = (customer ? a.acc_invoice : a.acc_bill) as Row;
    return {
      entryId: text(d.journal_entry_id),
      date: String(customer ? d.issue_date : d.bill_date),
      sourceType: customer ? "invoice" : "bill",
      number: text(customer ? d.invoice_number : d.bill_number),
      label: (customer ? null : text(d.vendor_ref)) ?? text(d.memo) ?? "",
      appliedMinor: Number(a.amount_minor),
    };
  });
  const links = [...new Set(rows.map((r) => r.number).filter((n): n is string => n !== null))].sort();
  return {
    party: text(nameOf(customer ? pay.acc_customer : pay.acc_vendor)),
    document: {
      kind,
      number: text(pay.payment_number),
      dueDate: null,
      taxMinor: 0,
      totalMinor: Number(pay.amount_minor),
    },
    lines: [],
    settlement: {
      heading: "Applied to",
      rows,
      totalLabel: "Total applied",
      totalMinor: rows.reduce((s, r) => s + r.appliedMinor, 0),
    },
    beancount: { links, reference: text(pay.reference), dueDate: null },
  };
}

async function expensePart(sb: SupabaseClient, exp: Row): Promise<DocumentPart> {
  const lineRows = await read<Row[]>(
    "acc_expense_line",
    sb
      .from("acc_expense_line")
      .select("description,amount_minor,line_order,acc_account(account_code,name)")
      .eq("expense_id", exp.id as string)
      .order("line_order"),
  );
  return {
    party: text(nameOf(exp.acc_vendor)),
    document: { kind: "expense", number: text(exp.expense_number), dueDate: null, taxMinor: 0, totalMinor: Number(exp.total_minor) },
    lines: lineRows.map((l) => ({
      account: accountLabel(l.acc_account),
      description: String(l.description ?? ""),
      quantity: null,
      rateMinor: null,
      amountMinor: Number(l.amount_minor),
    })),
    settlement: null,
    // The Beancount file links invoices, bills and the payments between them;
    // an expense carries no link there, so it carries none here.
    beancount: { links: [], reference: null, dueDate: null },
  };
}

/** One entry, opened. Throws `EntryDetailError` when it cannot be read or does not exist. */
export async function getEntryDetail(sb: SupabaseClient, entryId: string): Promise<EntryDetail> {
  const entry = await read<Row | null>(
    "the entry",
    sb
      .from("acc_journal_entry")
      .select(
        "id,entry_number,entry_date,description,source_type,status,currency_code," +
          "acc_journal_line(account_id,debit_minor,credit_minor,memo,line_order,acc_account(account_code,name))",
      )
      .eq("id", entryId)
      .maybeSingle(),
  );
  if (!entry) throw new EntryDetailError("That entry is no longer in the books.");

  const entryDate = String(entry.entry_date).slice(0, 10);
  const currencyCode = String(entry.currency_code);

  const [currency, accounts, listed, docs] = await Promise.all([
    read<Row | null>(
      "the currency",
      sb.from("acc_currency").select("decimal_places").eq("code", currencyCode).maybeSingle(),
    ),
    readBeancountAccounts(sb),
    // The same source the Beancount file takes its payee from, so the sheet's
    // "As Beancount" block is the file's own lines for this entry.
    getTransactionList(sb, entryDate, entryDate),
    findDocument(sb, entryId),
  ]);
  if (!currency) throw new EntryDetailError(`Currency ${currencyCode} has no record.`);
  const decimals = Number(currency.decimal_places);

  const part = docs.invoice
    ? await invoicePart(sb, docs.invoice)
    : docs.bill
      ? await billPart(sb, docs.bill)
      : docs.payment
        ? await paymentPart(sb, docs.payment, "payment")
        : docs.billPayment
          ? await paymentPart(sb, docs.billPayment, "bill_payment")
          : docs.expense
            ? await expensePart(sb, docs.expense)
            : null;

  const lines: EntryDetailLine[] = [...((entry.acc_journal_line as Row[] | null) ?? [])]
    .sort((x, y) => Number(x.line_order) - Number(y.line_order))
    .map((l) => {
      const a = l.acc_account as { account_code?: string; name?: string } | null;
      return {
        accountId: String(l.account_id),
        accountCode: a?.account_code ?? "",
        accountName: a?.name ?? "",
        debitMinor: Number(l.debit_minor),
        creditMinor: Number(l.credit_minor),
        memo: text(l.memo),
      };
    });

  const listedParty = listed.find((r) => r.entryId === entryId)?.partyName ?? null;
  const names = accountNames(accounts);
  const beancount = beancountEntryText(
    {
      id: entryId,
      entryNumber: String(entry.entry_number),
      entryDate,
      description: (entry.description as string | null) ?? null,
      sourceType: String(entry.source_type),
      currencyCode,
      lines: lines.map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor })),
    },
    {
      names,
      nameWidth: beancountNameWidth(names),
      decimals,
      party: listedParty ?? undefined,
      document: part?.beancount,
    },
  );

  return {
    id: entryId,
    entryNumber: String(entry.entry_number),
    entryDate,
    description: (entry.description as string | null) ?? null,
    sourceType: String(entry.source_type),
    status: entry.status === "void" ? "void" : "posted",
    currencyCode,
    decimals,
    party: listedParty ?? part?.party ?? null,
    document: part?.document ?? null,
    documentLines: part?.lines ?? [],
    settlement: part?.settlement ?? null,
    lines,
    beancount,
  };
}
