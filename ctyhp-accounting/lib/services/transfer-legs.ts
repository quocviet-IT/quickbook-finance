import type { SupabaseClient } from "@supabase/supabase-js";
import { toTransferRow, type TransferRow } from "@/lib/domain/transfer-legs";
import { BankRecError } from "@/lib/services/bankrec";
import { readAllPages } from "@/lib/services/paging";

/**
 * The legs of every transfer between two bank accounts, the evidence for an
 * open leg and the entries left out, as `acc_transfer_legs()` returns them. A
 * read; paged past PostgREST's 1,000-row cap, ordered by kind, date and the
 * row key, which is unique.
 */
export async function getTransferRows(sb: SupabaseClient): Promise<TransferRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_transfer_legs")
        .order("row_kind")
        .order("entry_date")
        .order("row_key")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map(toTransferRow);
}
