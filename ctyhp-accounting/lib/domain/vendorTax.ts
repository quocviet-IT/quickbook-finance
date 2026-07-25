/**
 * Vendor tax profile and 1099 review rules.
 *
 * The database returns facts — what was paid, whether a taxpayer identifier is on
 * file, which box is configured — and this module decides what is reportable and
 * what a reviewer must fix. It is deliberately the only place those judgements
 * live, and it is deliberately *not* a filing: the output is a review dataset
 * with an exception queue, per the user manual.
 */
import type { Minor } from "./money";

export type W9Status = "not_requested" | "requested" | "on_file" | "expired";
export type TinType = "ssn" | "ein" | "itin" | null;
export type TaxClassification =
  | "individual"
  | "sole_proprietor"
  | "partnership"
  | "c_corporation"
  | "s_corporation"
  | "llc"
  | "trust_estate"
  | "exempt_payee"
  | "other";

/** Classifications that are normally outside 1099 reporting. */
const CORPORATE: TaxClassification[] = ["c_corporation", "s_corporation"];

/**
 * How a taxpayer identifier is displayed — the last four characters and nothing
 * else. One definition, so no component can accidentally render the whole value.
 */
export function maskTin(tinRef: string | null, tinType: TinType): string {
  if (!tinRef) return "—";
  const digits = tinRef.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  const last4 = digits.slice(-4);
  if (tinType === "ssn" || tinType === "itin") return `•••-••-${last4}`;
  if (tinType === "ein") return `••-•••${last4}`;
  return `•••••${last4}`;
}

export type W9Effective = "on_file" | "expired" | "missing";

/**
 * The W-9 state that matters. A status of `on_file` with a past expiry is
 * `expired` — otherwise the exception queue would call stale documentation good.
 */
export function w9Effective(
  status: W9Status,
  expiresDate: string | null,
  asOf: string,
): W9Effective {
  if (status === "expired") return "expired";
  if (status !== "on_file") return "missing";
  if (expiresDate && expiresDate < asOf) return "expired";
  return "on_file";
}

export interface Vendor1099Row {
  vendorName: string;
  reportingName: string | null;
  classification: TaxClassification | null;
  w9Status: W9Status;
  w9ExpiresDate: string | null;
  tinOnFile: boolean;
  addressComplete: boolean;
  is1099Eligible: boolean;
  boxCode: string | null;
  thresholdMinor: Minor;
  paidMinor: Minor;
  eligibilityOverride: boolean;
}

export type ExceptionSeverity = "blocker" | "warning";

export interface Vendor1099Exception {
  code: string;
  severity: ExceptionSeverity;
  message: string;
}

export interface Vendor1099Assessment {
  reportable: boolean;
  exceptions: Vendor1099Exception[];
}

/**
 * Decide whether a vendor's year is reportable and what a reviewer must fix.
 *
 * A **blocker** means the form cannot be produced as things stand; a **warning**
 * means a human has to look at it. A documented eligibility override forces
 * reportable — that is the point of recording one.
 */
export function assess1099(row: Vendor1099Row, asOf: string): Vendor1099Assessment {
  const exceptions: Vendor1099Exception[] = [];
  const overThreshold = row.paidMinor >= row.thresholdMinor;
  const reportable = row.eligibilityOverride || (row.is1099Eligible && overThreshold);

  if (!row.is1099Eligible && !row.eligibilityOverride) {
    // Nothing is claimed for this vendor; the only thing worth saying is that a
    // sizeable payment went out without anyone deciding about it.
    if (overThreshold && row.paidMinor > 0) {
      exceptions.push({
        code: "not_marked_eligible",
        severity: "warning",
        message: `Paid over the reporting threshold but not marked 1099-eligible — confirm whether a form is due`,
      });
    }
    return { reportable, exceptions };
  }

  if (!row.eligibilityOverride && !overThreshold) {
    exceptions.push({
      code: "under_threshold",
      severity: "warning",
      message: "Marked eligible but paid under the reporting threshold — no form is due yet",
    });
  }

  if (!row.boxCode) {
    exceptions.push({
      code: "missing_box",
      severity: "blocker",
      message: "No reporting box configured for this vendor",
    });
  }

  if (reportable) {
    if (!row.tinOnFile) {
      exceptions.push({
        code: "missing_tin",
        severity: "blocker",
        message: "No taxpayer identifier on file — collect a W-9 before reporting",
      });
    }
    if (!row.reportingName) {
      exceptions.push({
        code: "missing_reporting_name",
        severity: "blocker",
        message: "No legal reporting name on file",
      });
    }
    if (!row.addressComplete) {
      exceptions.push({
        code: "incomplete_address",
        severity: "blocker",
        message: "Payee address is incomplete",
      });
    }
    const w9 = w9Effective(row.w9Status, row.w9ExpiresDate, asOf);
    if (w9 === "expired") {
      exceptions.push({ code: "w9_expired", severity: "blocker", message: "The W-9 on file has expired" });
    } else if (w9 === "missing") {
      exceptions.push({ code: "w9_missing", severity: "blocker", message: "No W-9 has been collected" });
    }
  }

  if (row.classification && CORPORATE.includes(row.classification) && !row.eligibilityOverride) {
    exceptions.push({
      code: "corporation_eligible",
      severity: "warning",
      message: "A corporation is normally not reportable — document an override if it is",
    });
  }

  return { reportable, exceptions };
}

/** Total of the amounts that would be reported. */
export function sum1099Reportable(rows: Vendor1099Row[], asOf: string): Minor {
  return rows.reduce((sum, r) => (assess1099(r, asOf).reportable ? sum + r.paidMinor : sum), 0);
}

/** The per-vendor rows must add up to what the payment documents say. */
export function ties(rowsTotalMinor: Minor, controlTotalMinor: Minor): boolean {
  return rowsTotalMinor === controlTotalMinor;
}
