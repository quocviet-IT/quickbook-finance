import type { SupabaseClient } from "@supabase/supabase-js";
import { changeLog, changeLogDetail, CHANGE_LOG_LIMIT, type ChangeLogEntry, type ChangeLogReport } from "@/lib/domain/change-log";
import { closeLog, type CloseEvent, type ClosePeriod, type CloseLogReport } from "@/lib/domain/close-log";
import {
  reconciliationList,
  type ReconciliationListReport,
  type SignedOffReconciliation,
  type VoidedClearedLine,
} from "@/lib/domain/reconciliation-list";
import { voidedEntries, type ReversedEntry, type VoidedEntriesReport, type VoidedEntry } from "@/lib/domain/voided-entries";
import { searchAudit } from "./access";
import { getDiscrepancies } from "./bankrec";
import { describeAuditActivity } from "./dashboard";
import { PAGE_SIZE, readAllPages } from "./paging";

/**
 * The review reports: reconciliations that were signed off, what changed in
 * the books, the month-end closes, and the entries that were voided or
 * reversed. All read-only; every list is paged past PostgREST's cap.
 */
export class ReviewReportError extends Error {}

const fail = (message: string) => new ReviewReportError(message);

/** User id → the name a report shows: the person's name, or their email when they have none. */
async function actorNames(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb.rpc("acc_actor_directory");
  if (error) throw fail(error.message);
  const names = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; email: string | null; full_name: string | null }[]) {
    const name = r.full_name?.trim() || r.email?.trim() || "";
    if (name) names.set(r.id, name);
  }
  return names;
}

// --- Reconciliation Report -------------------------------------------------------

export async function getReconciliationList(sb: SupabaseClient): Promise<ReconciliationListReport> {
  const [sessions, accounts, names] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_statement_reconciliation")
          .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at,completed_by")
          .eq("status", "completed")
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_bank_account")
          .select("id,bank_name,account_number_masked,acc_account(account_code,name)")
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
  ]);
  const accountName = new Map(
    accounts.map((r) => {
      const gl = r.acc_account as { account_code?: string; name?: string } | null;
      const label = gl?.account_code ? `${gl.account_code} — ${gl.name ?? ""}` : ((r.bank_name as string) ?? "Bank account");
      const masked = r.account_number_masked as string | null;
      return [r.id as string, masked ? `${label} (${masked})` : label] as const;
    }),
  );
  const signedOff: SignedOffReconciliation[] = sessions.map((r) => ({
    id: r.id as string,
    bankAccountId: r.bank_account_id as string,
    bankAccountName: accountName.get(r.bank_account_id as string) ?? "A bank account no longer on file",
    statementEndingDate: r.statement_ending_date as string,
    statementEndingBalanceMinor: Number(r.statement_ending_balance_minor),
    completedAt: (r.completed_at as string | null) ?? null,
    completedByName: r.completed_by ? (names.get(r.completed_by as string) ?? null) : null,
  }));
  // Only accounts with a signed-off reconciliation can have one that stopped agreeing.
  const withSignedOff = [...new Set(signedOff.map((session) => session.bankAccountId))];
  const voided = (await Promise.all(withSignedOff.map((id) => getDiscrepancies(sb, id)))).flat();
  const lost: VoidedClearedLine[] = voided.map((line) => ({
    reconciliationId: line.reconciliationId,
    entryNumber: line.entryNumber ?? "",
    signedMinor: line.signedMinor,
  }));
  return reconciliationList(signedOff, lost);
}

// --- Change Log -------------------------------------------------------------------------

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * What changed between two dates, newest first, from the audit log. The
 * database refuses anybody without `audit.read`; this does not ask again.
 */
export async function getChangeLog(sb: SupabaseClient, from: string, to: string): Promise<ChangeLogReport> {
  const rows = await searchAudit(sb, { from, to, limit: CHANGE_LOG_LIMIT });
  const entries: ChangeLogEntry[] = rows.map((row) => {
    const activity = describeAuditActivity(row);
    return {
      id: row.id,
      at: row.created_at,
      who: row.actor_email ?? "System",
      what: capitalize(activity.verb.replaceAll("_", " ")),
      record: capitalize(activity.entity),
      reference: activity.reference,
      detail: changeLogDetail(row),
    };
  });
  return changeLog(entries);
}

// --- Month-End Close Log ---------------------------------------------------------------

export async function getCloseLog(sb: SupabaseClient, fiscalYear: number): Promise<CloseLogReport> {
  const periodRows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_accounting_period")
        .select("id,label,period_start,status")
        .eq("fiscal_year", fiscalYear)
        .order("period_start")
        .range(from, to),
    fail,
  );
  const periods: ClosePeriod[] = periodRows.map((r) => ({
    id: r.id as string,
    label: r.label as string,
    periodStart: r.period_start as string,
    status: r.status as ClosePeriod["status"],
  }));
  if (periods.length === 0) return closeLog([], []);
  const [eventRows, names] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_period_event")
          .select("id,period_id,event,reason,actor_id,created_at")
          .in("period_id", periods.map((p) => p.id))
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
  ]);
  const events: CloseEvent[] = eventRows
    .filter((r) => r.event === "close" || r.event === "reopen")
    .map((r) => ({
      periodId: r.period_id as string,
      event: r.event as CloseEvent["event"],
      reason: (r.reason as string | null) ?? "",
      actorName: r.actor_id ? (names.get(r.actor_id as string) ?? null) : null,
      createdAt: r.created_at as string,
    }));
  return closeLog(periods, events);
}

// --- Voided and Reversed Entries ---------------------------------------------------------

/** A day either side, so a moment near midnight in the company's zone is not cut off by UTC. */
function widen(from: string, to: string): { start: string; end: string } {
  const shift = (iso: string, days: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString();
  };
  return { start: shift(from, -1), end: shift(to, 2) };
}

type CountedPage = { data: unknown; error: { message: string } | null; count?: number | null };

/**
 * `readAllPages`, with the pages after the first read side by side. The first
 * page asks for the row count; the rest are fetched eight at a time. Rows added
 * after the count are still read: while a page comes back full, the next is
 * asked for, as `readAllPages` does. Like it, only correct for a totally
 * ordered query.
 */
async function readPagesSideBySide<T>(
  fetchPage: (from: number, to: number, withCount: boolean) => PromiseLike<CountedPage>,
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_SIZE - 1, true);
  if (first.error) throw fail(first.error.message);
  const rows = [...((first.data ?? []) as T[])];
  let last = rows.length;
  const total = first.count ?? 0;
  const starts: number[] = [];
  for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) starts.push(start);
  for (let i = 0; i < starts.length; i += CHUNKS_IN_FLIGHT) {
    const pages = await Promise.all(starts.slice(i, i + CHUNKS_IN_FLIGHT).map((s) => fetchPage(s, s + PAGE_SIZE - 1, false)));
    for (const page of pages) {
      if (page.error) throw fail(page.error.message);
      const data = (page.data ?? []) as T[];
      rows.push(...data);
      last = data.length;
    }
  }
  for (let start = PAGE_SIZE * (starts.length + 1); last === PAGE_SIZE; start += PAGE_SIZE) {
    const page = await fetchPage(start, start + PAGE_SIZE - 1, false);
    if (page.error) throw fail(page.error.message);
    const data = (page.data ?? []) as T[];
    rows.push(...data);
    last = data.length;
  }
  return rows;
}

/** Ids per request: 200 uuids keep the URL well inside what the gateway takes. */
const ID_CHUNK = 200;
/** Chunks in flight at once. A book that was re-imported can hold thousands of voided entries. */
const CHUNKS_IN_FLIGHT = 8;

/** Entry id → its debits in base currency. */
async function entryAmounts(sb: SupabaseClient, entryIds: readonly string[]): Promise<Map<string, number>> {
  const chunks: string[][] = [];
  for (let i = 0; i < entryIds.length; i += ID_CHUNK) chunks.push(entryIds.slice(i, i + ID_CHUNK));
  const readChunk = (chunk: string[]) =>
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_journal_line")
          .select("id,journal_entry_id,debit_minor,amount_base_minor")
          .in("journal_entry_id", chunk)
          .gt("debit_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    );
  const amounts = new Map<string, number>();
  for (let i = 0; i < chunks.length; i += CHUNKS_IN_FLIGHT) {
    const pages = await Promise.all(chunks.slice(i, i + CHUNKS_IN_FLIGHT).map(readChunk));
    for (const r of pages.flat()) {
      const id = r.journal_entry_id as string;
      amounts.set(id, (amounts.get(id) ?? 0) + Number(r.amount_base_minor));
    }
  }
  return amounts;
}

/**
 * Who voided each document, from the audit log, by the document's id. Only for
 * a reader who may read the audit log; for anybody else the column stays empty
 * rather than reading around the permission.
 */
async function voidedBy(sb: SupabaseClient, from: string, to: string): Promise<Map<string, string>> {
  const rows = await searchAudit(sb, { action: "void", from, to, limit: CHANGE_LOG_LIMIT });
  const by = new Map<string, string>();
  for (const row of rows) if (row.record_id && row.actor_email) by.set(row.record_id, row.actor_email);
  return by;
}

export async function getVoidedEntries(
  sb: SupabaseClient,
  range: { from: string; to: string },
  timeZone: string,
  canReadAudit: boolean,
): Promise<VoidedEntriesReport> {
  const { start, end } = widen(range.from, range.to);
  const voidColumns = "id,entry_number,entry_date,description,voided_at,source_id";
  const [timedVoids, untimedVoids, linkRows, names, auditBy, timedLines, untimedLines] = await Promise.all([
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_entry")
        .select(voidColumns, withCount ? { count: "exact" } : undefined)
        .eq("status", "void")
        .gte("voided_at", start)
        .lt("voided_at", end)
        .order("id")
        .range(from, to),
    ),
    // Voided before the books kept the time: dated by the entry instead.
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_entry")
        .select(voidColumns, withCount ? { count: "exact" } : undefined)
        .eq("status", "void")
        .is("voided_at", null)
        .gte("entry_date", range.from)
        .lte("entry_date", range.to)
        .order("id")
        .range(from, to),
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_journal_reversal_link")
          .select(
            "id,reason,created_by,created_at," +
              "orig:acc_journal_entry!acc_journal_reversal_link_original_entry_id_fkey(id,entry_number,entry_date,description)," +
              "rev:acc_journal_entry!acc_journal_reversal_link_reversal_entry_id_fkey(id,entry_number)",
          )
          .gte("created_at", start)
          .lt("created_at", end)
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
    canReadAudit ? voidedBy(sb, range.from, range.to) : Promise.resolve(new Map<string, string>()),
    // The voided entries' debits, read by the same windows as the entries
    // themselves rather than id by id: a re-imported book can hold thousands.
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,amount_base_minor,acc_journal_entry!inner(status,voided_at)",
          withCount ? { count: "exact" } : undefined,
        )
        .gt("debit_minor", 0)
        .eq("acc_journal_entry.status", "void")
        .gte("acc_journal_entry.voided_at", start)
        .lt("acc_journal_entry.voided_at", end)
        .order("id")
        .range(from, to),
    ),
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,amount_base_minor,acc_journal_entry!inner(status,voided_at,entry_date)",
          withCount ? { count: "exact" } : undefined,
        )
        .gt("debit_minor", 0)
        .eq("acc_journal_entry.status", "void")
        .is("acc_journal_entry.voided_at", null)
        .gte("acc_journal_entry.entry_date", range.from)
        .lte("acc_journal_entry.entry_date", range.to)
        .order("id")
        .range(from, to),
    ),
  ]);
  const voidRows = [...timedVoids, ...untimedVoids];

  type EntryRef = { id: string; entry_number: string; entry_date?: string; description?: string };
  const links = linkRows.map((r) => ({
    reason: (r.reason as string | null) ?? "",
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    orig: r.orig as EntryRef,
    rev: r.rev as EntryRef,
  }));
  // A reversed entry is still posted, so its debits are read by its id.
  const amounts = await entryAmounts(sb, links.map((l) => l.orig.id));
  for (const r of [...timedLines, ...untimedLines]) {
    const id = r.journal_entry_id as string;
    amounts.set(id, (amounts.get(id) ?? 0) + Number(r.amount_base_minor));
  }

  const voided: VoidedEntry[] = voidRows.map((r) => ({
    entryId: r.id as string,
    entryNumber: r.entry_number as string,
    entryDate: r.entry_date as string,
    description: (r.description as string | null) ?? "",
    amountMinor: amounts.get(r.id as string) ?? 0,
    voidedAt: (r.voided_at as string | null) ?? null,
    byName: r.source_id ? (auditBy.get(r.source_id as string) ?? null) : null,
  }));
  const reversed: ReversedEntry[] = links.map((link) => ({
    originalEntryId: link.orig.id,
    originalNumber: link.orig.entry_number,
    originalDate: link.orig.entry_date ?? "",
    description: link.orig.description ?? "",
    amountMinor: amounts.get(link.orig.id) ?? 0,
    reversalEntryId: link.rev.id,
    reversalNumber: link.rev.entry_number,
    reason: link.reason,
    reversedAt: link.createdAt,
    byName: link.createdBy ? (names.get(link.createdBy) ?? null) : null,
  }));
  return voidedEntries(voided, reversed, range, timeZone);
}
