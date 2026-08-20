import type { AccountingControl, ControlKey } from "./types";

/**
 * What each accounting control means, and when it has passed.
 *
 * Pure by design: every builder takes plain numbers and dates, so the rules
 * that decide whether the books are safe can be read and tested without a
 * database. Two rules run through all of them:
 *
 *   a control that could not be computed is `unavailable`, never `healthy` —
 *   "we did not look" and "nothing is wrong" are opposite answers;
 *
 *   every status carries a sentence and a pass condition, so the screen never
 *   has to make a colour do the explaining.
 */

/** Minor units as a plain decimal string: the detail lines read as English. */
function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function trialBalanceControl(input: {
  balanced: boolean;
  differenceMinor: number;
  evaluatedAt: string;
}): AccountingControl {
  return {
    key: "trial-balance",
    title: "Trial balance",
    // The one control whose failure is a blocker rather than a warning: a
    // ledger that does not balance cannot produce a statement anyone may
    // rely on, and acc_close_period refuses to close over it.
    status: input.balanced ? "healthy" : "blocked",
    passCondition: "Posted debits equal posted credits across the whole ledger.",
    detail: input.balanced
      ? "Debits and credits agree across the posted ledger."
      : `Debits and credits differ by ${money(input.differenceMinor)}. A period cannot be closed over this.`,
    differenceMinor: Math.abs(input.differenceMinor),
    evaluatedAt: input.evaluatedAt,
    href: "/reports?report=trial",
    blocksClose: true,
  };
}

const SUBLEDGER_TITLE: Record<"ar-to-gl" | "ap-to-gl" | "inventory-to-gl", string> = {
  "ar-to-gl": "Receivables to the ledger",
  "ap-to-gl": "Payables to the ledger",
  "inventory-to-gl": "Inventory to the ledger",
};

const SUBLEDGER_SUBJECT: Record<"ar-to-gl" | "ap-to-gl" | "inventory-to-gl", string> = {
  "ar-to-gl": "The open invoices",
  "ap-to-gl": "The open bills",
  "inventory-to-gl": "The inventory on hand",
};

export function subledgerControl(
  key: "ar-to-gl" | "ap-to-gl" | "inventory-to-gl",
  input: { differenceMinor: number | null; evaluatedAt: string },
): AccountingControl {
  const subject = SUBLEDGER_SUBJECT[key];
  const base = {
    key,
    title: SUBLEDGER_TITLE[key],
    passCondition: `${subject} add up to the control account, to the cent.`,
    evaluatedAt: input.evaluatedAt,
    href: "/reports/gl-posting",
    blocksClose: true,
  };
  if (input.differenceMinor === null) {
    return {
      ...base,
      status: "unavailable",
      detail: "This control could not be evaluated, so it cannot be reported as passing.",
    };
  }
  return {
    ...base,
    status: input.differenceMinor === 0 ? "healthy" : "attention",
    detail:
      input.differenceMinor === 0
        ? `${subject} agree with the control account.`
        : `${subject} are out by ${money(input.differenceMinor)} against the control account.`,
    differenceMinor: Math.abs(input.differenceMinor),
  };
}

export function periodStatusControl(input: {
  openCount: number;
  overdueCount: number;
  evaluatedAt: string;
}): AccountingControl {
  return {
    key: "period-status",
    title: "Accounting periods",
    status: input.overdueCount === 0 ? "healthy" : "attention",
    passCondition: "No period is still open after the last day it covers.",
    detail:
      input.overdueCount === 0
        ? `${plural(input.openCount, "open period")}, none past its end date.`
        : `${plural(input.overdueCount, "period")} still open after the last day covered.`,
    evaluatedAt: input.evaluatedAt,
    href: "/settings/periods",
    blocksClose: false,
  };
}

export function approvalsControl(input: {
  pendingCount: number;
  oldestAgeDays: number | null;
  evaluatedAt: string;
}): AccountingControl {
  const waited =
    input.oldestAgeDays === null
      ? ""
      : ` The oldest has waited ${plural(input.oldestAgeDays, "day")}.`;
  return {
    key: "pending-approvals",
    title: "Controlled actions",
    status: input.pendingCount === 0 ? "healthy" : "attention",
    passCondition: "No controlled action is waiting for a decision.",
    detail:
      input.pendingCount === 0
        ? "Nothing is waiting for approval."
        : `${plural(input.pendingCount, "action")} waiting for a decision.${waited}`,
    evaluatedAt: input.evaluatedAt,
    // Not a blocker: an unapproved action has not posted, so it cannot put
    // the ledger out. It is work, not a control failure.
    href: "/approvals",
    blocksClose: false,
  };
}

export function bankReconciliationControl(input: {
  lastCompletedOn: string | null;
  unmatchedCount: number;
  evaluatedAt: string;
}): AccountingControl {
  const lastPart =
    input.lastCompletedOn === null
      ? "No completed reconciliation on record."
      : `Last reconciled through ${input.lastCompletedOn}.`;
  const unmatchedPart =
    input.unmatchedCount === 0
      ? "No unmatched bank activity."
      : `${plural(input.unmatchedCount, "bank transaction")} still unmatched.`;
  return {
    key: "bank-reconciliation",
    title: "Bank reconciliation",
    status: input.unmatchedCount === 0 && input.lastCompletedOn !== null ? "healthy" : "attention",
    passCondition: "Every bank line is matched and the statement has been reconciled.",
    detail: `${unmatchedPart} ${lastPart}`,
    evaluatedAt: input.evaluatedAt,
    href: "/banking/reconcile",
    blocksClose: false,
  };
}

const UNAVAILABLE_TITLE: Record<ControlKey, string> = {
  "trial-balance": "Trial balance",
  "bank-reconciliation": "Bank reconciliation",
  "ar-to-gl": "Receivables to the ledger",
  "ap-to-gl": "Payables to the ledger",
  "inventory-to-gl": "Inventory to the ledger",
  "period-status": "Accounting periods",
  "pending-approvals": "Controlled actions",
};

const UNAVAILABLE_HREF: Record<ControlKey, string> = {
  "trial-balance": "/reports?report=trial",
  "bank-reconciliation": "/banking/reconcile",
  "ar-to-gl": "/reports/gl-posting",
  "ap-to-gl": "/reports/gl-posting",
  "inventory-to-gl": "/reports/gl-posting",
  "period-status": "/settings/periods",
  "pending-approvals": "/approvals",
};

/** A control the system could not evaluate. Says so, and says why. */
export function unavailableControl(
  key: ControlKey,
  reason: string,
  evaluatedAt: string,
): AccountingControl {
  return {
    key,
    title: UNAVAILABLE_TITLE[key],
    status: "unavailable",
    passCondition: "This check could not run, so nothing about it has been proven.",
    detail: reason,
    evaluatedAt,
    href: UNAVAILABLE_HREF[key],
    blocksClose: false,
  };
}
