/**
 * What customers owe and what the company owes, split the way the Dashboard
 * speaks about it: overdue, due within a week, due later, and the credits that
 * net the total.
 *
 * Pure: the aging report's rows in (`getArAging` / `getApAging`), already in
 * base currency at today's rate. Credits and unapplied payments arrive as
 * negative rows; they net the total, as the aging report nets it, and are
 * never counted as documents. The split adds back to the report's total
 * exactly, so the Dashboard and the A/R and A/P Aging reports cannot disagree.
 */
import { bucketOf } from "@/lib/domain/aging";
import { addIsoDays, calendarDayDifference } from "@/lib/domain/work-queue";
import type { AgingReportRow } from "@/lib/services/aging";
import type { HomeHorizon, HomeNextBill, HomeOpenSide, HomeOwesLongest, HomeProjection } from "./types";

/** "Due soon" runs from asOf through this many days later, as the bills queue's `through` does. */
export const DUE_SOON_DAYS = 7;
/** The cash projection's horizon when none is named. */
export const PROJECTION_DAYS = 30;
/** The horizons the Cash flow card offers (3.0.41). */
export const PROJECTION_HORIZONS: readonly HomeHorizon[] = [30, 60, 90];

export type OpenItemRow = Pick<
  AgingReportRow,
  "entityId" | "entityName" | "docType" | "docNumber" | "dueDate" | "balanceMinor" | "bucket"
>;

type BucketKey = keyof HomeOpenSide["buckets"];
const BUCKET_KEYS: readonly BucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

function bucketKeyOf(row: OpenItemRow, asOf: string): BucketKey {
  const key = (BUCKET_KEYS as readonly string[]).includes(row.bucket) ? row.bucket : bucketOf(row.dueDate, asOf);
  return key as BucketKey;
}

/**
 * One side of the books, split by due date.
 *
 * Overdue is due before asOf; due soon is due from asOf through asOf + 7 days;
 * later is after that. Negative rows go to `creditsMinor` whatever their date.
 * Only rows of `documentType` count as documents. `totalMinor` is the sum of
 * every row, which is what the aging report totals, and it always equals
 * overdue + due soon + later + credits.
 */
export function splitOpenSide(rows: readonly OpenItemRow[], asOf: string, documentType: "invoice" | "bill"): HomeOpenSide {
  const soonThrough = addIsoDays(asOf, DUE_SOON_DAYS);
  const side: HomeOpenSide = {
    totalMinor: 0,
    documents: 0,
    overdueMinor: 0,
    overdueDocuments: 0,
    dueSoonMinor: 0,
    dueSoonDocuments: 0,
    laterMinor: 0,
    laterDocuments: 0,
    creditsMinor: 0,
    buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  };
  for (const row of rows) {
    side.totalMinor += row.balanceMinor;
    side.buckets[bucketKeyOf(row, asOf)] += row.balanceMinor;
    if (row.balanceMinor < 0) {
      side.creditsMinor += row.balanceMinor;
      continue;
    }
    const document = row.docType === documentType ? 1 : 0;
    side.documents += document;
    if (row.dueDate < asOf) {
      side.overdueMinor += row.balanceMinor;
      side.overdueDocuments += document;
    } else if (row.dueDate <= soonThrough) {
      side.dueSoonMinor += row.balanceMinor;
      side.dueSoonDocuments += document;
    } else {
      side.laterMinor += row.balanceMinor;
      side.laterDocuments += document;
    }
  }
  return side;
}

export interface OverdueParty {
  entityId: string;
  name: string;
  /** The party's overdue documents (positive rows due before asOf); credits do not net it. */
  overdueMinor: number;
  oldestDueDate: string;
}

/** Each party with something overdue, in no particular order. */
export function overdueParties(rows: readonly OpenItemRow[], asOf: string): OverdueParty[] {
  const byParty = new Map<string, OverdueParty>();
  for (const row of rows) {
    if (row.balanceMinor <= 0 || row.dueDate >= asOf) continue;
    const seen = byParty.get(row.entityId);
    if (seen) {
      seen.overdueMinor += row.balanceMinor;
      if (row.dueDate < seen.oldestDueDate) seen.oldestDueDate = row.dueDate;
    } else {
      byParty.set(row.entityId, {
        entityId: row.entityId,
        name: row.entityName,
        overdueMinor: row.balanceMinor,
        oldestDueDate: row.dueDate,
      });
    }
  }
  return [...byParty.values()];
}

/**
 * The customers who have owed longest: oldest overdue invoice first, then the
 * larger overdue amount, then the name. At most `limit`.
 */
export function owesLongest(rows: readonly OpenItemRow[], asOf: string, limit = 5): HomeOwesLongest[] {
  return overdueParties(rows, asOf)
    .sort(
      (a, b) =>
        a.oldestDueDate.localeCompare(b.oldestDueDate) ||
        b.overdueMinor - a.overdueMinor ||
        a.name.localeCompare(b.name) ||
        a.entityId.localeCompare(b.entityId),
    )
    .slice(0, limit)
    .map((party) => ({
      customerId: party.entityId,
      name: party.name,
      overdueMinor: party.overdueMinor,
      oldestDueDate: party.oldestDueDate,
      daysLate: calendarDayDifference(asOf, party.oldestDueDate),
    }));
}

/**
 * The open bills to pay next: soonest due first, so late bills lead, then the
 * larger amount. At most `limit`. Vendor credits and unapplied payments are not bills.
 */
export function nextBills(rows: readonly OpenItemRow[], asOf: string, limit = 5): HomeNextBill[] {
  return rows
    .filter((row) => row.docType === "bill" && row.balanceMinor > 0)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        b.balanceMinor - a.balanceMinor ||
        a.entityName.localeCompare(b.entityName) ||
        (a.docNumber ?? "").localeCompare(b.docNumber ?? ""),
    )
    .slice(0, limit)
    .map((row) => ({
      vendorName: row.entityName,
      billNumber: row.docNumber,
      dueDate: row.dueDate,
      daysUntilDue: calendarDayDifference(row.dueDate, asOf),
      balanceMinor: row.balanceMinor,
    }));
}

/**
 * Cash in `days` days if every open invoice and bill falling due from asOf
 * through then is paid on its due date. Credits are not counted. Documents
 * already past due are left out, and their amounts reported, so the reader is
 * told what the projection does not include.
 */
export function projection(
  cashTodayMinor: number,
  arRows: readonly OpenItemRow[],
  apRows: readonly OpenItemRow[],
  asOf: string,
  days = PROJECTION_DAYS,
): HomeProjection {
  const through = addIsoDays(asOf, days);
  const sum = (rows: readonly OpenItemRow[], docType: string, keep: (dueDate: string) => boolean) =>
    rows
      .filter((row) => row.docType === docType && row.balanceMinor > 0 && keep(row.dueDate))
      .reduce((total, row) => total + row.balanceMinor, 0);
  const inWindow = (dueDate: string) => asOf <= dueDate && dueDate <= through;
  const late = (dueDate: string) => dueDate < asOf;
  const invoicesDueMinor = sum(arRows, "invoice", inWindow);
  const billsDueMinor = sum(apRows, "bill", inWindow);
  return {
    through,
    invoicesDueMinor,
    billsDueMinor,
    projectedMinor: cashTodayMinor + invoicesDueMinor - billsDueMinor,
    overdueLeftOutMinor: sum(arRows, "invoice", late),
    overdueBillsLeftOutMinor: sum(apRows, "bill", late),
  };
}

/** The projection at every horizon the card offers, from the same rows and the same cash today. */
export function projections(
  cashTodayMinor: number,
  arRows: readonly OpenItemRow[],
  apRows: readonly OpenItemRow[],
  asOf: string,
): Record<HomeHorizon, HomeProjection> {
  const at = (days: HomeHorizon) => projection(cashTodayMinor, arRows, apRows, asOf, days);
  return { 30: at(30), 60: at(60), 90: at(90) };
}

/** Overdue documents of one type: how many, how much, and the oldest one's days late. Null when there are none. */
export function overdueSummary(
  rows: readonly OpenItemRow[],
  asOf: string,
  documentType: "invoice" | "bill",
): { count: number; amountMinor: number; oldestDaysLate: number } | null {
  const late = rows.filter((row) => row.docType === documentType && row.balanceMinor > 0 && row.dueDate < asOf);
  if (late.length === 0) return null;
  const oldest = late.reduce((min, row) => (row.dueDate < min ? row.dueDate : min), late[0].dueDate);
  return {
    count: late.length,
    amountMinor: late.reduce((total, row) => total + row.balanceMinor, 0),
    oldestDaysLate: calendarDayDifference(asOf, oldest),
  };
}

/** Documents of one type due from asOf through asOf + 7 days: how many, how much, and the first due date. Null when there are none. */
export function dueSoonSummary(
  rows: readonly OpenItemRow[],
  asOf: string,
  documentType: "invoice" | "bill",
): { count: number; amountMinor: number; firstDueDate: string } | null {
  const through = addIsoDays(asOf, DUE_SOON_DAYS);
  const soon = rows.filter(
    (row) => row.docType === documentType && row.balanceMinor > 0 && asOf <= row.dueDate && row.dueDate <= through,
  );
  if (soon.length === 0) return null;
  return {
    count: soon.length,
    amountMinor: soon.reduce((total, row) => total + row.balanceMinor, 0),
    firstDueDate: soon.reduce((min, row) => (row.dueDate < min ? row.dueDate : min), soon[0].dueDate),
  };
}
