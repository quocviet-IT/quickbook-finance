import type { AccountType } from "./accounts";
import { translateAccountType } from "./import-mapping";

/**
 * How the type words in a file were read, one row per word rather than per
 * account.
 *
 * "Provide a mapping step where users can review and correct account types
 * before the import is finalized." Reviewing ninety-five rows to check thirteen
 * decisions is not review, it is proof-reading — and the decisions repeat, so
 * this groups them. A chart of ninety-five accounts is usually a dozen distinct
 * words, and a dozen lines can actually be read.
 *
 * What makes it worth reading is that the translation is a guess with real
 * consequences: QuickBooks writes "Other Current Asset" and "Bank" and "Credit
 * Card", and which One Book type each becomes decides where the money appears
 * on the balance sheet for every transaction afterwards.
 */
export interface AccountTypeReading {
  /** The word as the file wrote it. */
  source: string;
  /** What it was read as, or null when nothing here matches it. */
  type: AccountType | null;
  /** Whether a person chose this rather than the matcher. */
  chosen: boolean;
  /** How many accounts carry this word. */
  rows: number;
  /** An example account, so an unfamiliar word can be placed. */
  example: string;
}

/**
 * Read the type column straight out of the file.
 *
 * From the raw rows rather than the parsed records, because the parse has
 * already thrown the file's own wording away — and the file's wording is the
 * thing being reviewed.
 */
export function accountTypeReadings(
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  nameColumn: number | null,
  overrides: Record<string, AccountType> = {},
): AccountTypeReading[] {
  const column = mapping.account_type ?? null;
  if (column === null) return [];

  const seen = new Map<string, { rows: number; example: string }>();
  for (const row of rows) {
    const source = (row[column] ?? "").trim();
    if (source === "") continue;
    const found = seen.get(source);
    if (found) found.rows += 1;
    else {
      seen.set(source, {
        rows: 1,
        example: nameColumn === null ? "" : (row[nameColumn] ?? "").trim(),
      });
    }
  }

  return [...seen]
    .map(([source, count]) => ({
      source,
      type: overrides[source] ?? translateAccountType(source),
      chosen: overrides[source] !== undefined,
      rows: count.rows,
      example: count.example,
    }))
    .sort((a, b) => b.rows - a.rows || a.source.localeCompare(b.source));
}
