/**
 * Which column of a bank's CSV holds what, remembered per bank account in this
 * browser — chosen once on Import statement, used again there and when a run of
 * statements is reconciled from the same bank's files. A convenience: when the
 * browser keeps nothing, the columns are detected again.
 */
import type { DateOrder, StatementColumnMap } from "@/lib/domain/statement-import";

export interface CsvColumnChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;

/** The choice remembered for this bank account, when every column it names is in this file. */
export function rememberedColumns(bankAccountId: string, headers: readonly string[]): CsvColumnChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvColumnChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

export function rememberColumns(bankAccountId: string, choice: CsvColumnChoice): void {
  try {
    localStorage.setItem(storageKey(bankAccountId), JSON.stringify(choice));
  } catch {
    // Remembering the columns is a convenience; nothing needs it.
  }
}
