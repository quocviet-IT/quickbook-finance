import type { SupabaseClient } from "@supabase/supabase-js";
import { applyMapping, type ImportTarget } from "@/lib/domain/import-mapping";

/**
 * What a transactions file will ask of this company, read before anything is
 * mapped or previewed.
 *
 * The tester's report said the same thing twice, of two different
 * prerequisites: "this requirement is only revealed after the user has already
 * gone through the upload and mapping steps". Both were true. Every account the
 * file names, and every bank it moves money through, had to exist — and the
 * screen only said which ones were missing once the whole file had been read,
 * mapped and previewed.
 *
 * So this asks the two questions immediately, from the mapping the screen has
 * already proposed, and it asks them cheaply: the distinct names in the file
 * rather than its rows. A 1,566-row file yields eight bank names and fifteen
 * account names, which is one round trip.
 *
 * It answers nothing on its own. Whether a name resolves is the database's
 * answer, through the same function the import uses — a second opinion here is
 * how a screen ends up passing a file the import then refuses.
 */

export class ImportPreflightError extends Error {}

/** A name in the file that the chart cannot turn into exactly one account. */
export interface UnresolvedRef {
  ref: string;
  /** Which column it came from: the two need different remedies. */
  column: "bank" | "category";
  /** How many rows use it, so the biggest problem is obvious. */
  rows: number;
  /** Codes of the accounts a name matches when it matches more than one. */
  candidates: string[];
}

/** A bank the file moves money through that Banking cannot carry a line for. */
export interface UnbankedRef {
  ref: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  rows: number;
  /**
   * Whether Banking could ever list it. A bank or credit-card account is one
   * form away; anything else can only be fixed in the file or in the chart.
   */
  canBeBanked: boolean;
}

export interface ImportPreflight {
  /** Accounts in this company's chart, so "import the chart first" can be checked. */
  chartAccounts: number;
  /** Bank accounts declared under Banking. */
  bankAccounts: number;
  unresolved: UnresolvedRef[];
  unbanked: UnbankedRef[];
  /** Distinct bank names the file uses, resolved or not. */
  bankRefs: number;
  /** Distinct chart-of-account names the file uses. */
  categoryRefs: number;
}

interface RefMatchRow {
  ref: string;
  account_id: string | null;
  matched_by: "code" | "code_and_name" | "name" | "ambiguous" | null;
  candidate_codes: string[] | null;
}

interface AccountRow {
  id: string;
  account_code: string;
  name: string;
  account_type: string;
}

/**
 * Read the two account columns out of the file.
 *
 * Overrides are applied here rather than later: a name the reader has already
 * pointed at an account is not an unresolved name, and showing it as one after
 * they have answered is how a screen nags.
 */
function distinctRefs(
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  overrides: Record<string, string>,
): { bank: Map<string, number>; category: Map<string, number> } {
  const parsed = applyMapping(rows, mapping, "transactions");
  const bank = new Map<string, number>();
  const category = new Map<string, number>();

  for (const record of parsed.records) {
    const bankRef = String(record.bank_account ?? "").trim();
    if (bankRef !== "") {
      const use = overrides[bankRef] ?? bankRef;
      bank.set(use, (bank.get(use) ?? 0) + 1);
    }
    const categoryRef = String(record.category_account ?? "").trim();
    if (categoryRef !== "") {
      const use = overrides[categoryRef] ?? categoryRef;
      category.set(use, (category.get(use) ?? 0) + 1);
    }
  }
  return { bank, category };
}

/** Ask the database what each name means, through the resolver the import uses. */
async function resolve(
  sb: SupabaseClient,
  refs: readonly string[],
): Promise<Map<string, RefMatchRow>> {
  const found = new Map<string, RefMatchRow>();
  if (refs.length === 0) return found;
  const { data, error } = await sb.rpc("acc_account_ref_matches", { p_refs: [...refs] });
  if (error) throw new ImportPreflightError(error.message);
  for (const row of (data ?? []) as RefMatchRow[]) found.set(row.ref, row);
  return found;
}

/**
 * The same question for a general ledger, which has no columns to agree on.
 *
 * A ledger export names accounts in section headings rather than in a column,
 * so it arrives already counted. Everything after that is identical — the same
 * chart, the same resolver, the same two answers — and it had only half of them
 * before: the screen listed what was missing and sent the reader to another
 * page to create it.
 */
export async function accountRefPreflight(
  sb: SupabaseClient,
  refs: readonly { ref: string; rows: number }[],
  overrides: Record<string, string> = {},
): Promise<UnresolvedRef[]> {
  const counted = new Map<string, number>();
  for (const entry of refs) {
    const name = entry.ref.trim();
    if (name === "") continue;
    const use = overrides[name] ?? name;
    counted.set(use, (counted.get(use) ?? 0) + entry.rows);
  }

  const matches = await resolve(sb, [...counted.keys()]);
  const unresolved: UnresolvedRef[] = [];
  for (const [ref, rows] of counted) {
    const match = matches.get(ref);
    if (match?.account_id) continue;
    unresolved.push({ ref, column: "category", rows, candidates: match?.candidate_codes ?? [] });
  }
  return unresolved.sort((a, b) => b.rows - a.rows);
}

export async function importPreflight(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  overrides: Record<string, string> = {},
): Promise<ImportPreflight> {
  if (target !== "transactions") {
    throw new ImportPreflightError("Only a transactions file has accounts to check ahead of time");
  }

  const { bank, category } = distinctRefs(rows, mapping, overrides);
  const everyRef = [...new Set([...bank.keys(), ...category.keys()])];

  const [matches, accountsResult, bankedResult] = await Promise.all([
    resolve(sb, everyRef),
    sb.from("acc_account").select("id,account_code,name,account_type").neq("status", "archived"),
    sb.from("acc_bank_account").select("account_id"),
  ]);
  if (accountsResult.error) throw new ImportPreflightError(accountsResult.error.message);
  if (bankedResult.error) throw new ImportPreflightError(bankedResult.error.message);

  const accounts = new Map(
    ((accountsResult.data ?? []) as AccountRow[]).map((row) => [row.id, row]),
  );
  const banked = new Set(
    ((bankedResult.data ?? []) as { account_id: string }[]).map((row) => row.account_id),
  );

  const unresolved: UnresolvedRef[] = [];
  const unbanked: UnbankedRef[] = [];

  for (const [column, counts] of [
    ["bank", bank],
    ["category", category],
  ] as const) {
    for (const [ref, count] of counts) {
      const match = matches.get(ref);
      if (!match?.account_id) {
        unresolved.push({
          ref,
          column,
          rows: count,
          candidates: match?.candidate_codes ?? [],
        });
        continue;
      }
      if (column !== "bank" || banked.has(match.account_id)) continue;
      const account = accounts.get(match.account_id);
      unbanked.push({
        ref,
        accountId: match.account_id,
        accountCode: account?.account_code ?? "",
        accountName: account?.name ?? "",
        rows: count,
        // Banking will never list anything else, so telling somebody to go
        // there is a wasted trip they cannot tell apart from a real one.
        canBeBanked: account?.account_type === "bank" || account?.account_type === "credit_card",
      });
    }
  }

  const byRows = <T extends { rows: number }>(a: T, b: T) => b.rows - a.rows;
  return {
    chartAccounts: accounts.size,
    bankAccounts: banked.size,
    unresolved: unresolved.sort(byRows),
    unbanked: unbanked.sort(byRows),
    bankRefs: bank.size,
    categoryRefs: category.size,
  };
}
