import type { SurfaceControl } from "@/lib/domain/work-surface/types";

/**
 * What Sales checks about itself.
 *
 * Three, and every one of them is about *collection* — the job the design
 * document gives this screen. Whether receivables tie to the ledger is a real
 * check and it belongs to Accounting, which is where it already is; repeating it
 * here would be two screens answering one question and eventually disagreeing.
 *
 * Pure by design: plain numbers in, a status and a sentence out, so the rules
 * can be read and tested without a database.
 */

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export type SalesControlKey =
  | "overdue-receivables"
  | "unapplied-receipts"
  | "unissued-invoices";

/**
 * Nothing a customer owes has gone past its due date.
 *
 * The one check on this surface with money in it, and the figure is what makes
 * it useful: "4 invoices overdue" is a number, "4 invoices overdue, 62,400.00"
 * is a decision about who to call first.
 */
export function overdueReceivablesControl(input: {
  /** Null when the ageing could not be read. */
  overdueCount: number | null;
  overdueMinor: number;
  oldestDaysPastDue: number | null;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "overdue-receivables" as const,
    title: "Nothing is past due",
    passCondition: "Every issued invoice is within its payment terms.",
    evaluatedAt: input.evaluatedAt,
    href: "/reports?report=ar-aging",
    // Being owed money late is the work this screen exists for, not a control
    // failure that stops something else. Nothing on Sales blocks.
    blocking: false,
  };
  if (input.overdueCount === null) {
    return {
      ...base,
      status: "unavailable",
      detail: "The receivables ageing could not be read, so nothing here is proven.",
    };
  }
  if (input.overdueCount === 0) {
    return { ...base, status: "healthy", detail: "Every issued invoice is within terms." };
  }
  const oldest =
    input.oldestDaysPastDue === null
      ? ""
      : ` The oldest is ${plural(input.oldestDaysPastDue, "day")} past due.`;
  return {
    ...base,
    status: "attention",
    detail: `${plural(input.overdueCount, "invoice")} overdue, ${money(input.overdueMinor)} in total.${oldest}`,
    differenceMinor: Math.abs(input.overdueMinor),
  };
}

/**
 * Money received has been applied to something.
 *
 * An unapplied receipt is not lost — it is on the customer's account and in the
 * ledger — but until it is applied, that customer's balance says they owe money
 * they have already paid. Every chase based on it is a chase for nothing.
 */
export function unappliedReceiptsControl(input: {
  /** Null when the payments could not be read. */
  count: number | null;
  amountMinor: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "unapplied-receipts" as const,
    title: "Receipts are applied to invoices",
    passCondition: "No customer payment is sitting unapplied.",
    evaluatedAt: input.evaluatedAt,
    href: "/payments",
    blocking: false,
  };
  if (input.count === null) {
    return { ...base, status: "unavailable", detail: "The customer payments could not be read." };
  }
  if (input.count === 0) {
    return { ...base, status: "healthy", detail: "Every receipt is applied." };
  }
  return {
    ...base,
    status: "attention",
    detail: `${plural(input.count, "receipt")} holding ${money(input.amountMinor)} that is not applied to any invoice — the customers concerned look like they owe money they have paid.`,
    differenceMinor: Math.abs(input.amountMinor),
  };
}

/**
 * Work that has been done has been billed.
 *
 * A draft invoice is revenue nobody has asked for yet. `staleAfterDays` is
 * supplied by the caller because "how long is too long in draft" is a question
 * about a company's own rhythm, and this file does not own a clock.
 */
export function unissuedInvoicesControl(input: {
  /** Null when the invoices could not be read. */
  draftCount: number | null;
  draftMinor: number;
  staleCount: number;
  staleAfterDays: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "unissued-invoices" as const,
    title: "Finished work has been billed",
    passCondition: `No invoice has sat in draft for more than ${plural(input.staleAfterDays, "day")}.`,
    evaluatedAt: input.evaluatedAt,
    href: "/invoices?status=draft",
    blocking: false,
  };
  if (input.draftCount === null) {
    return { ...base, status: "unavailable", detail: "The invoices could not be read." };
  }
  if (input.draftCount === 0) {
    return { ...base, status: "healthy", detail: "Nothing is waiting in draft." };
  }
  if (input.staleCount === 0) {
    return {
      ...base,
      status: "healthy",
      detail: `${plural(input.draftCount, "draft")} in progress, none older than ${plural(input.staleAfterDays, "day")}.`,
    };
  }
  return {
    ...base,
    status: "attention",
    detail: `${plural(input.staleCount, "draft")} older than ${plural(input.staleAfterDays, "day")}, ${money(input.draftMinor)} not yet billed.`,
    differenceMinor: Math.abs(input.draftMinor),
  };
}
