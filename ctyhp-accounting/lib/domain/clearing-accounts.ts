import { daysFromTo } from "@/lib/domain/bank-standing";

import { formatDate, plural } from "@/lib/format";
/** A clearing account with no movement for more than this many days is left standing. */
export const CLEARING_IDLE_DAYS = 60;
/** A clearing account whose oldest open item is more than this many days old is left standing. */
export const CLEARING_ITEM_DAYS = 90;

export const LEFT_STANDING = "Left standing";

export const CLEARING_FIFO_NOTE =
  "The oldest items are found first in, first out: each amount out clears the oldest amount in that is still open.";

export const CLEARING_WHY =
  "A clearing account should empty: money received waits there until it is banked, wages until they are paid. A balance left standing is either money not yet banked or something counted twice.";

// The form's part lives in a module that imports nothing, so the shared form
// schemas can read it without carrying this file into every page.
export { CLEARING_FORM_HELP, CLEARING_TYPE_MESSAGE, canBeClearing } from "./clearing-account-type";

/** One row of acc_clearing_standing(p_as_of). */
export interface ClearingStanding {
  accountId: string;
  /** Debit minus credit. */
  balanceMinor: number;
  lastMovementDate: string | null;
  openCount: number;
  openOldestDate: string | null;
  /** Absolute. */
  openMinor: number;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Maps one RPC row; bigint arrives as a number or a numeric string. */
export function toClearingStanding(row: Record<string, unknown>): ClearingStanding {
  return {
    accountId: String(row.account_id ?? ""),
    balanceMinor: num(row.balance_minor),
    lastMovementDate: dateOrNull(row.last_movement_date),
    openCount: num(row.open_count),
    openOldestDate: dateOrNull(row.open_oldest_date),
    openMinor: num(row.open_minor),
  };
}

export type ClearingItemNoun = "receipts" | "entries";

/** "receipts" for an account whose detail type is undeposited_funds, "entries" for any other. */
export function clearingItemNoun(detailType: string | null | undefined): ClearingItemNoun {
  return detailType === "undeposited_funds" ? "receipts" : "entries";
}

export type Money = (minor: number) => string;

export interface ClearingView {
  /** Not zero and (idle more than CLEARING_IDLE_DAYS, or oldest open item more than CLEARING_ITEM_DAYS old). */
  leftStanding: boolean;
  /** Whole days from lastMovementDate to asOf; null when no movement or a date does not parse. */
  idleDays: number | null;
  /** Whole days from openOldestDate to asOf; null when nothing open or a date does not parse. */
  oldestDays: number | null;
  /** `{amount} across {n} receipts, oldest {date}`; null when the balance is zero. */
  composition: string | null;
  /** `No movement for {d} days, since {date}`; null when there is no movement. */
  idle: string | null;
}

function noun(n: number, kind: ClearingItemNoun): string {
  if (kind === "receipts") return plural(n, "receipt");
  return plural(n, "entry", "entries");
}

export function describeClearing(
  s: ClearingStanding,
  asOf: string,
  kind: ClearingItemNoun,
  money: Money,
): ClearingView {
  const idleDays = s.lastMovementDate ? daysFromTo(s.lastMovementDate, asOf) : null;
  const oldestDays = s.openOldestDate ? daysFromTo(s.openOldestDate, asOf) : null;

  const zero = s.balanceMinor === 0;
  // A day count that cannot be worked out never makes a balance look healthy.
  const leftStanding =
    !zero &&
    (idleDays === null ||
      oldestDays === null ||
      idleDays > CLEARING_IDLE_DAYS ||
      oldestDays > CLEARING_ITEM_DAYS);

  // A non-zero balance always has an oldest open item and a last movement in
  // the database's answer; a sentence is only written from figures it has.
  const composition =
    zero || s.openOldestDate === null
      ? null
      : `${money(s.openMinor)} across ${noun(s.openCount, kind)}, oldest ${formatDate(s.openOldestDate)}`;

  const idle =
    s.lastMovementDate === null || idleDays === null
      ? null
      : `No movement for ${plural(idleDays, "day")}, since ${formatDate(s.lastMovementDate)}`;

  return { leftStanding, idleDays, oldestDays, composition, idle };
}

/** Exceptions order: left standing first, then by name. */
export function byLeftStandingThenName<T extends { leftStanding: boolean; name: string }>(
  a: T,
  b: T,
): number {
  if (a.leftStanding !== b.leftStanding) return a.leftStanding ? -1 : 1;
  return a.name.localeCompare(b.name);
}
