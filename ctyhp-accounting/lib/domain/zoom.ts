/**
 * QuickZoom: the posted lines behind one figure of a statement (the
 * prototype's `drillDetail`). The list must add up to the figure that opened
 * it; this is where that is decided, and checked.
 *
 * Pure: lines already read come in; rows, a running balance and the check come
 * out. Amounts are base-currency minor units.
 */

import { normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import type { ZoomSpec } from "@/lib/domain/statement";

export interface ZoomLineInput {
  lineId: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  accountId: string;
  /** Base currency, read as `acc_ledger_balances` reads it. */
  debitBase: number;
  creditBase: number;
  /** Who the entry was with, as the transaction list names it. */
  name: string;
}

export interface ZoomAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

export interface ZoomRow {
  key: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  name: string;
  /** The account, for a total; the other side of the entry, for one account. */
  detail: string;
  amount: number;
  /** For one account: its balance after this line. */
  balance: number | null;
}

export interface ZoomResult {
  spec: ZoomSpec;
  single: boolean;
  /** For one account with a start date: its balance the day before, on the statement's side. */
  opening: number | null;
  rows: ZoomRow[];
  total: number;
  /** Whether the rows add up to the figure that opened them. */
  matches: boolean;
}

/**
 * The sign the list is shown with, so it adds up to the figure: the
 * prototype's `dsign`. A statement shows income, liabilities and equity as
 * positive although the ledger holds them as credits.
 */
export function zoomSign(figure: number, raw: number, creditNatured: boolean): 1 | -1 {
  if (figure !== 0 && raw !== 0) return figure < 0 === raw < 0 ? 1 : -1;
  return creditNatured ? -1 : 1;
}

export interface BuildZoomInput {
  spec: ZoomSpec;
  lines: readonly ZoomLineInput[];
  accounts: ReadonlyMap<string, ZoomAccount>;
  /** Every account's "code name", to name the other side of an entry. */
  labels: ReadonlyMap<string, string>;
  /** Per entry, the accounts it touched. */
  entryAccounts: ReadonlyMap<string, readonly string[]>;
  /** For one account with a start date: its debit less credit before the start. */
  openingRaw: number | null;
}

function otherSide(input: BuildZoomInput, entryId: string, accountId: string): string {
  const others = [...new Set((input.entryAccounts.get(entryId) ?? []).filter((id) => id !== accountId))];
  if (others.length === 0) return "";
  if (others.length === 1) return input.labels.get(others[0]) ?? "";
  return "— Split —";
}

export function buildZoom(input: BuildZoomInput): ZoomResult {
  const { spec } = input;
  const single = spec.accountIds.length === 1;
  const raw = input.lines.reduce((sum, l) => sum + l.debitBase - l.creditBase, 0);
  const creditNatured = spec.accountIds.every((id) => {
    const account = input.accounts.get(id);
    return account ? normalBalanceOf(account.type) === "credit" : false;
  });
  const sign = zoomSign(spec.figure, raw, creditNatured);
  const sorted = [...input.lines].sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate) || a.entryNumber.localeCompare(b.entryNumber) || a.lineId.localeCompare(b.lineId),
  );
  const opening = single && spec.from !== null && input.openingRaw !== null ? input.openingRaw * sign : null;
  let balance = opening ?? 0;
  const rows = sorted.map((l): ZoomRow => {
    const amount = (l.debitBase - l.creditBase) * sign;
    balance += amount;
    return {
      key: l.lineId,
      entryId: l.entryId,
      entryNumber: l.entryNumber,
      entryDate: l.entryDate,
      sourceType: l.sourceType,
      name: l.name,
      detail: single ? otherSide(input, l.entryId, l.accountId) : (input.labels.get(l.accountId) ?? ""),
      amount,
      balance: single ? balance : null,
    };
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { spec, single, opening, rows, total, matches: total === spec.figure };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A sanity bound on one request, far above any chart OneBook holds: the
 * service reads the accounts in batches, so the limit is not the URL's.
 */
export const MAX_ZOOM_ACCOUNTS = 2000;

/** Why a zoom request is not one a statement could have made, or null when it is. */
export function zoomSpecProblem(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return "That is not a figure on a report.";
  const s = spec as Partial<ZoomSpec>;
  if (typeof s.title !== "string" || s.title.length === 0 || s.title.length > 200) return "The figure has no name.";
  if (!Array.isArray(s.accountIds) || s.accountIds.length === 0) return "That figure has no accounts behind it.";
  if (s.accountIds.length > MAX_ZOOM_ACCOUNTS) {
    return `That figure draws on more than ${MAX_ZOOM_ACCOUNTS} accounts. Open one of its lines instead.`;
  }
  if (!s.accountIds.every((id) => typeof id === "string" && UUID.test(id))) return "That figure names an account that is not one.";
  if (s.from !== null && (typeof s.from !== "string" || !ISO_DATE.test(s.from))) return "The start date is not a date.";
  if (typeof s.to !== "string" || !ISO_DATE.test(s.to)) return "The end date is not a date.";
  if (s.from !== null && s.from > s.to) return "The start date is after the end date.";
  if (typeof s.figure !== "number" || !Number.isSafeInteger(s.figure)) return "The figure is not an amount.";
  return null;
}
