import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockCountLineRow, StockCountRow } from "@/lib/db/types";
import type { StockCountLineInput } from "@/lib/domain/stock-count";
import { hasPermission } from "@/lib/services/access";
import { readAllPages } from "@/lib/services/paging";
import { getLedgerBalances } from "@/lib/services/reports";

export class StockCountError extends Error {}

const fail = (message: string) => new StockCountError(message);

const HEADER_COLUMNS =
  "id,count_number,as_of,status,memo,counted_minor,book_minor,difference_minor," +
  "inventory_account_id,offset_account_id,journal_entry_id,approval_request_id," +
  "posted_by,posted_at,created_by,created_at,updated_by,updated_at";

const LINE_COLUMNS = "id,stock_count_id,line_order,name,sku,quantity,unit_cost_minor,sells_for_minor";

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** bigint and numeric columns can arrive as strings; the screen works in numbers. */
function headerFromRow(r: Record<string, unknown>): StockCountRow {
  return {
    ...(r as unknown as StockCountRow),
    counted_minor: numberOrNull(r.counted_minor),
    book_minor: numberOrNull(r.book_minor),
    difference_minor: numberOrNull(r.difference_minor),
  };
}

function lineFromRow(r: Record<string, unknown>): StockCountLineRow {
  return {
    ...(r as unknown as StockCountLineRow),
    line_order: Number(r.line_order),
    quantity: Number(r.quantity),
    unit_cost_minor: Number(r.unit_cost_minor),
    sells_for_minor: numberOrNull(r.sells_for_minor),
  };
}

/**
 * Every count, newest first. Ordered by as-of date, then count number (unique),
 * then id, so a row cannot straddle a page.
 */
export async function listStockCounts(sb: SupabaseClient): Promise<StockCountRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count")
        .select(HEADER_COLUMNS)
        .order("as_of", { ascending: false })
        .order("count_number", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map(headerFromRow);
}

export interface StockCountSummary extends StockCountRow {
  lineCount: number;
}

/**
 * The list screen's rows: every count, newest first, each with how many lines
 * it holds. The line count comes from an embedded count, so no line is read.
 */
export async function listStockCountSummaries(sb: SupabaseClient): Promise<StockCountSummary[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count")
        .select(`${HEADER_COLUMNS},lines:acc_stock_count_line(count)`)
        .order("as_of", { ascending: false })
        .order("count_number", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map((r) => {
    const embedded = r.lines as { count?: number | string }[] | null | undefined;
    return { ...headerFromRow(r), lineCount: Number(embedded?.[0]?.count ?? 0) };
  });
}

export interface StockCountWithLines {
  count: StockCountRow;
  lines: StockCountLineRow[];
}

/** One count with its lines in sheet order (line_order, then id), or null when there is none. */
export async function getStockCount(sb: SupabaseClient, id: string): Promise<StockCountWithLines | null> {
  const { data, error } = await sb.from("acc_stock_count").select(HEADER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fail(error.message);
  if (!data) return null;
  const lines = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count_line")
        .select(LINE_COLUMNS)
        .eq("stock_count_id", id)
        .order("line_order")
        .order("id")
        .range(from, to),
    fail,
  );
  return { count: headerFromRow(data as unknown as Record<string, unknown>), lines: lines.map(lineFromRow) };
}

/** The ids acc_inventory_account_ids() returns, whether PostgREST wraps each scalar or not. */
async function inventoryAccountIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.rpc("acc_inventory_account_ids");
  if (error) throw fail(error.message);
  return ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String(Object.values(row as Record<string, unknown>)[0]),
  );
}

/**
 * What the books say the stock is worth on a date: the net debit balance, up to
 * and including that date, of the accounts acc_inventory_account_ids() names.
 * That function is the very one acc_post_stock_count sums over, so the figure on
 * the screen and the figure the post freezes pick the same accounts.
 *
 * It sums `getLedgerBalances(null, asOf)` for those accounts. The database
 * adds debit_minor less credit_minor over the same posted entries; the two agree
 * for any base-currency line. They part only for a foreign-currency line on an
 * inventory account, where this uses the base amount (amount_base_minor) and the
 * post function the document-currency amount.
 */
export async function getBookValue(sb: SupabaseClient, asOf: string): Promise<number> {
  const [ids, balances] = await Promise.all([inventoryAccountIds(sb), getLedgerBalances(sb, null, asOf)]);
  const inventory = new Set(ids);
  let total = 0;
  for (const b of balances) if (inventory.has(b.accountId)) total += b.debitBase - b.creditBase;
  return total;
}

export interface PostingAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface PostingContext {
  inventoryAccounts: PostingAccountOption[];
  /** Active posting cost-of-sales accounts, for the offset select. */
  offsetAccounts: PostingAccountOption[];
  defaultInventoryAccountId: string | null;
  defaultOffsetAccountId: string | null;
  /** True when the company keeps stock item by item; a count then cannot be posted. */
  tracksItems: boolean;
  canAdjust: boolean;
}

/** What the confirm dialog needs: the two selects, their defaults, and whether posting is open to this person here. */
export async function getPostingContext(sb: SupabaseClient): Promise<PostingContext> {
  const [ids, accounts, defaults, tracked, canAdjust] = await Promise.all([
    inventoryAccountIds(sb),
    readAllPages<{ id: string; account_code: string; name: string; account_type: string }>(
      (from, to) =>
        sb
          .from("acc_account")
          .select("id,account_code,name,account_type")
          .eq("is_posting_account", true)
          .eq("status", "active")
          .order("account_code")
          .order("id")
          .range(from, to),
      fail,
    ),
    sb.rpc("acc_stock_count_default_accounts"),
    sb.from("acc_item").select("id", { count: "exact", head: true }).eq("is_inventory", true).eq("is_active", true),
    hasPermission(sb, "inventory.adjust"),
  ]);
  if (defaults.error) throw fail(defaults.error.message);
  if (tracked.error) throw fail(tracked.error.message);

  const inventory = new Set(ids);
  const option = (a: { id: string; account_code: string; name: string }): PostingAccountOption => ({
    id: a.id,
    code: a.account_code,
    name: a.name,
  });
  const row = (Array.isArray(defaults.data) ? defaults.data[0] : defaults.data) as
    | { inventory_account_id?: string | null; offset_account_id?: string | null }
    | null
    | undefined;

  return {
    inventoryAccounts: accounts.filter((a) => inventory.has(a.id)).map(option),
    offsetAccounts: accounts.filter((a) => a.account_type === "cost_of_goods_sold").map(option),
    defaultInventoryAccountId: row?.inventory_account_id ?? null,
    defaultOffsetAccountId: row?.offset_account_id ?? null,
    tracksItems: (tracked.count ?? 0) > 0,
    canAdjust,
  };
}

/** The open count, or a new draft dated asOf that starts as a copy of the previous count's lines. */
export async function createStockCount(sb: SupabaseClient, asOf: string): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_stock_count", { p_as_of: asOf });
  if (error) throw fail(error.message);
  return String(data);
}

export interface SaveStockCountInput {
  id: string;
  asOf: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
}

/** Replace a draft's lines in one transaction. Returns how many lines were saved. */
export async function saveStockCount(sb: SupabaseClient, input: SaveStockCountInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_save_stock_count", {
    p_id: input.id,
    p_as_of: input.asOf,
    p_memo: input.memo,
    p_lines: input.lines.map((l) => ({
      name: l.name,
      sku: l.sku,
      quantity: l.quantity,
      unit_cost_minor: l.unitCostMinor,
      sells_for_minor: l.sellsForMinor,
    })),
  });
  if (error) throw fail(error.message);
  return Number(data ?? 0);
}

/** Post the count. Returns the journal entry id. */
export async function postStockCount(
  sb: SupabaseClient,
  input: { id: string; inventoryAccountId: string; offsetAccountId: string },
): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_stock_count", {
    p_id: input.id,
    p_inventory_account_id: input.inventoryAccountId,
    p_offset_account_id: input.offsetAccountId,
  });
  if (error) throw fail(error.message);
  return String(data);
}

/** After a count has been sent for approval: link the request and freeze the count. */
export async function markStockCountPending(sb: SupabaseClient, id: string, requestId: string): Promise<void> {
  const { error } = await sb.rpc("acc_mark_stock_count_pending", { p_id: id, p_request_id: requestId });
  if (error) throw fail(error.message);
}

/** The number of a journal entry (JE-...), or null when it cannot be read. */
export async function getEntryNumber(sb: SupabaseClient, entryId: string): Promise<string | null> {
  const { data, error } = await sb.from("acc_journal_entry").select("entry_number").eq("id", entryId).maybeSingle();
  if (error || !data) return null;
  return String((data as { entry_number: string }).entry_number);
}
