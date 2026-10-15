/**
 * How each bank account stands against its statements, in words and in a tone.
 *
 * Pure: one row of `acc_bank_standing(p_as_of)` in, a sentence and a colour
 * out. The age of the last agreed statement is always measured to the report
 * date passed in, never to today, so a report run for a past date reads the
 * way it would have read then.
 */
import type { Tone } from "@/lib/design/tone";
import { shortDate } from "@/lib/domain/report-presets";

/** Days after the last agreed statement at which an account turns amber. */
export const STANDING_AMBER_DAYS = 60;
/** Days after the last agreed statement at which an account turns red. */
export const STANDING_RED_DAYS = 180;

export interface BankStanding {
  bankAccountId: string;
  lastCompletedId: string | null;
  lastCompletedDate: string | null;
  lastClosingMinor: number | null;
  /** False when there is no completed reconciliation. */
  lastBroughtForward: boolean;
  sinceCount: number;
  sinceNetMinor: number;
  earlierOpenCount: number;
  earlierOpenNetMinor: number;
  voidTickedCount: number;
  voidTickedMinor: number;
  voidReconciliationDate: string | null;
  bookMinor: number;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Maps one RPC row (snake_case, bigint as number or string) to a standing. */
export function toBankStanding(row: Record<string, unknown>): BankStanding {
  return {
    bankAccountId: String(row.bank_account_id),
    lastCompletedId: stringOrNull(row.last_completed_id),
    lastCompletedDate: stringOrNull(row.last_completed_date),
    lastClosingMinor: numberOrNull(row.last_closing_minor),
    lastBroughtForward: row.last_brought_forward === true,
    sinceCount: Number(row.since_count ?? 0),
    sinceNetMinor: Number(row.since_net_minor ?? 0),
    earlierOpenCount: Number(row.earlier_open_count ?? 0),
    earlierOpenNetMinor: Number(row.earlier_open_net_minor ?? 0),
    voidTickedCount: Number(row.void_ticked_count ?? 0),
    voidTickedMinor: Number(row.void_ticked_minor ?? 0),
    voidReconciliationDate: stringOrNull(row.void_reconciliation_date),
    bookMinor: Number(row.book_minor ?? 0),
  };
}

/** The shared tone vocabulary without "muted". */
export type StandingTone = Extract<Tone, "positive" | "warning" | "danger" | "neutral">;

/** The screen passes its own money formatter. */
export type Money = (minor: number) => string;

export interface StandingView {
  tone: StandingTone;
  /** The account's line. */
  text: string;
  /** The extra "No longer agrees: …" line, or null. */
  noLongerAgrees: string | null;
  /** Whole days from the last agreed date to the report date; null when never reconciled. */
  ageDays: number | null;
}

/** Whole days from one date to another; null when either does not parse. */
function daysFromTo(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function entries(n: number): string {
  return n === 1 ? "1 entry" : `${n} entries`;
}

function hasActivity(s: BankStanding): boolean {
  return s.sinceCount > 0 || s.bookMinor !== 0;
}

function toneForAge(ageDays: number): StandingTone {
  if (ageDays > STANDING_RED_DAYS) return "danger";
  if (ageDays > STANDING_AMBER_DAYS) return "warning";
  return "positive";
}

export function describeStanding(s: BankStanding, asOf: string, money: Money): StandingView {
  const noLongerAgrees =
    s.voidTickedCount > 0
      ? `No longer agrees: ${entries(s.voidTickedCount)} ticked on ${
          s.voidReconciliationDate ? `the ${shortDate(s.voidReconciliationDate)}` : "a completed"
        } reconciliation ${s.voidTickedCount === 1 ? "was" : "were"} voided (${money(s.voidTickedMinor)})`
      : null;

  if (s.lastCompletedDate === null) {
    if (!hasActivity(s)) {
      return {
        tone: noLongerAgrees ? "danger" : "neutral",
        text: "No activity",
        noLongerAgrees,
        ageDays: null,
      };
    }
    return {
      tone: "danger",
      text: `Never reconciled · ${entries(s.sinceCount)}, ${money(s.sinceNetMinor)} not on a statement`,
      noLongerAgrees,
      ageDays: null,
    };
  }

  const ageDays = daysFromTo(s.lastCompletedDate, asOf);
  const closing = money(s.lastClosingMinor ?? 0);
  const forward = s.lastBroughtForward ? " (brought forward)" : "";
  const since =
    s.sinceCount > 0
      ? `${entries(s.sinceCount)} since, ${money(s.sinceNetMinor)} not on a statement`
      : "nothing since";
  return {
    // A date that does not parse can never read as a healthy account.
    tone: noLongerAgrees || ageDays === null ? "danger" : toneForAge(ageDays),
    text: `Agreed to ${shortDate(s.lastCompletedDate)} at ${closing}${forward} · ${since}`,
    noLongerAgrees,
    ageDays,
  };
}

/** Reconcile's standing card text. */
export function reconcileCardText(accountName: string, s: BankStanding, money: Money): string {
  if (s.lastCompletedDate === null) {
    if (!hasActivity(s)) {
      return `${accountName} has never been reconciled. No entries are waiting on a statement yet.`;
    }
    const waiting = s.sinceCount === 1 ? "is" : "are";
    return `${accountName} has never been reconciled. ${entries(s.sinceCount)}, ${money(
      s.sinceNetMinor,
    )}, ${waiting} waiting on a statement. Start with the oldest statement you have.`;
  }
  if (s.sinceCount === 0) return `Reconciled to ${shortDate(s.lastCompletedDate)}; nothing new since.`;
  // The age only picks a tone, which the card does not use; any report date works.
  return describeStanding(s, s.lastCompletedDate, money).text;
}

/** The Balance Sheet line with the first below-zero date added. */
export function withBelowZero(text: string, belowZeroDate: string): string {
  return `${text} · below zero at ${shortDate(belowZeroDate)}`;
}

/* ------------------------------------------------------------ balance sheet */

/** One line of the Balance Sheet's "Bank accounts" panel. */
export interface BalanceSheetBank {
  bankAccountId: string;
  accountName: string;
  standing: BankStanding;
  /** Found below zero at the report date. */
  belowZero: boolean;
  /** Entries in the account's flagged groups; 0 when it is not below zero. */
  ghostEntries: number;
}

/** What the panel says about entries that look like the account's own balance posted as payments. */
export function ghostEntriesSentence(n: number): string {
  return `${n === 1 ? "1 entry looks" : `${n} entries look`} like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.`;
}

/**
 * One item per bank account that has a standing row, ordered by account name.
 * An account the standing read does not return has nothing to say and is left out.
 */
export function balanceSheetBanks(
  banks: readonly { id: string; name: string }[],
  standings: readonly BankStanding[],
  belowZero: readonly { bankAccountId: string; ghostEntries: number }[],
): BalanceSheetBank[] {
  const byId = new Map(standings.map((s) => [s.bankAccountId, s]));
  const low = new Map(belowZero.map((b) => [b.bankAccountId, b.ghostEntries]));
  const out: BalanceSheetBank[] = [];
  for (const bank of banks) {
    const standing = byId.get(bank.id);
    if (!standing) continue;
    out.push({
      bankAccountId: bank.id,
      accountName: bank.name,
      standing,
      belowZero: low.has(bank.id),
      ghostEntries: low.get(bank.id) ?? 0,
    });
  }
  return out.sort(
    (a, b) =>
      a.accountName.localeCompare(b.accountName, "en", { sensitivity: "base" }) ||
      a.bankAccountId.localeCompare(b.bankAccountId),
  );
}
