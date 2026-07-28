import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addIsoDays,
  buildWorkQueueItems,
  type DashboardWorkQueue,
  type WorkQueueSource,
} from "@/lib/domain/work-queue";

export class WorkQueueError extends Error {}

const QUEUE_PREVIEW_LIMIT = 12;
const BILL_DUE_WINDOW_DAYS = 7;

function relatedName(
  value: unknown,
  fallback: string,
  key: "name" | "bank_name",
): string {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== "object") return fallback;
  const candidate = (relation as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
}

export async function getDashboardWorkQueue(
  sb: SupabaseClient,
  asOf: string,
): Promise<DashboardWorkQueue> {
  const dueThrough = addIsoDays(asOf, BILL_DUE_WINDOW_DAYS);
  const [invoices, bills, bankTransactions, approvals] = await Promise.all([
    sb
      .from("acc_invoice")
      .select(
        "id,invoice_number,due_date,balance_due_minor,currency_code,acc_customer(name)",
        { count: "exact" },
      )
      .in("status", ["issued", "partial"])
      .gt("balance_due_minor", 0)
      .not("due_date", "is", null)
      .lt("due_date", asOf)
      .order("due_date", { ascending: true })
      .limit(QUEUE_PREVIEW_LIMIT),
    sb
      .from("acc_bill")
      .select(
        "id,bill_number,vendor_ref,due_date,balance_due_minor,currency_code,acc_vendor(name)",
        { count: "exact" },
      )
      .in("status", ["open", "partial"])
      .gt("balance_due_minor", 0)
      .not("due_date", "is", null)
      .lte("due_date", dueThrough)
      .order("due_date", { ascending: true })
      .limit(QUEUE_PREVIEW_LIMIT),
    sb
      .from("acc_bank_transaction")
      .select(
        "id,bank_account_id,txn_date,description,amount_minor,acc_bank_account(bank_name)",
        { count: "exact" },
      )
      .eq("status", "unmatched")
      .eq("pending", false)
      .is("provider_removed_at", null)
      .lte("txn_date", asOf)
      .order("txn_date", { ascending: true })
      .limit(QUEUE_PREVIEW_LIMIT),
    sb
      .from("acc_approval_request")
      .select("id,title,action_key,amount_minor,requested_at", { count: "exact" })
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(QUEUE_PREVIEW_LIMIT),
  ]);

  for (const result of [invoices, bills, bankTransactions, approvals]) {
    if (result.error) throw new WorkQueueError(result.error.message);
  }

  const sources: WorkQueueSource[] = [
    ...((invoices.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: `overdue_invoice:${String(row.id)}`,
      kind: "overdue_invoice" as const,
      title: String(row.invoice_number ?? "Invoice"),
      subtitle: relatedName(row.acc_customer, "Customer", "name"),
      eventDate: String(row.due_date),
      amountMinor: Number(row.balance_due_minor),
      href: `/invoices?queue=overdue&asOf=${asOf}&focus=${String(row.id)}`,
    })),
    ...((bills.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: `due_bill:${String(row.id)}`,
      kind: "due_bill" as const,
      title: String(row.bill_number ?? row.vendor_ref ?? "Bill"),
      subtitle: relatedName(row.acc_vendor, "Vendor", "name"),
      eventDate: String(row.due_date),
      amountMinor: Number(row.balance_due_minor),
      href: `/bills?queue=due&through=${dueThrough}&focus=${String(row.id)}`,
    })),
    ...((bankTransactions.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: `unreconciled_transaction:${String(row.id)}`,
      kind: "unreconciled_transaction" as const,
      title: String(row.description || "Bank transaction"),
      subtitle: relatedName(row.acc_bank_account, "Bank account", "bank_name"),
      eventDate: String(row.txn_date),
      amountMinor: Number(row.amount_minor),
      href:
        `/banking?queue=unmatched&account=${String(row.bank_account_id)}` +
        `&focus=${String(row.id)}`,
    })),
    ...((approvals.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: `pending_approval:${String(row.id)}`,
      kind: "pending_approval" as const,
      title: String(row.title || "Approval request"),
      subtitle: String(row.action_key ?? "Controlled action").replaceAll("_", " "),
      eventDate: String(row.requested_at).slice(0, 10),
      amountMinor: Number(row.amount_minor),
      href: `/approvals?focus=${String(row.id)}`,
    })),
  ];

  return {
    asOf,
    dueThrough,
    counts: {
      overdue_invoice: invoices.count ?? 0,
      due_bill: bills.count ?? 0,
      unreconciled_transaction: bankTransactions.count ?? 0,
      pending_approval: approvals.count ?? 0,
    },
    items: buildWorkQueueItems(sources, asOf),
  };
}
