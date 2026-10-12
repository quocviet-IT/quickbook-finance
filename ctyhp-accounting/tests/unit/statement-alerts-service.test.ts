import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StatementAlertsError,
  getAllStatementAlerts,
  getBalanceEntryBlockers,
  getBankAccountLines,
  getBelowZeroBankAccounts,
  getStatementAlerts,
  removeBalanceEntries,
} from "@/lib/services/statement-alerts";

/**
 * A stub client that answers each table this service reads, the way PostgREST
 * does: `.range(from, to)` is inclusive at both ends, and a read that never
 * asks for a range gets everything. Filters the service sets with `.eq` are
 * recorded and used to pick the right rows.
 */
type Row = Record<string, unknown>;

interface World {
  banks: Row[];
  chart: Row[];
  /** Journal lines by ledger account id. */
  lines: Record<string, Row[]>;
  /** Ticked journal line ids by bank account id (completed sessions only). */
  ticked: Record<string, string[]>;
  sessions: Row[];
  transactions: Row[];
  ledger?: Row[];
  /** acc_journal_reversal_link rows. */
  reversals?: Row[];
  fail?: string;
}

interface Calls {
  ranges: Record<string, [number, number][]>;
  rpc: { name: string; args: Record<string, unknown> }[];
}

function fakeClient(world: World, calls: Calls = { ranges: {}, rpc: [] }): SupabaseClient {
  const rowsFor = (table: string, eqs: Record<string, unknown>): Row[] => {
    switch (table) {
      case "acc_bank_account":
        return eqs.id === undefined ? world.banks : world.banks.filter((b) => b.id === eqs.id);
      case "acc_account":
        return world.chart;
      case "acc_journal_line":
        return world.lines[eqs.account_id as string] ?? [];
      case "acc_reconciliation_line":
        return (world.ticked[eqs["acc_statement_reconciliation.bank_account_id"] as string] ?? []).map((id, i) => ({
          id: `rl${i}`,
          journal_line_id: id,
        }));
      case "acc_statement_reconciliation":
        return eqs.bank_account_id === undefined
          ? world.sessions
          : world.sessions.filter((s) => s.bank_account_id === eqs.bank_account_id);
      case "acc_journal_reversal_link":
        return world.reversals ?? [];
      default:
        throw new Error(`fakeClient: unhandled table "${table}"`);
    }
  };

  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          eqs[column] = value;
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          (calls.ranges[table] ??= []).push([from, to]);
          if (world.fail === table) return { data: null, error: { message: `${table} unreachable` } };
          return { data: rowsFor(table, eqs).slice(from, to + 1), error: null };
        },
        maybeSingle: async () => {
          if (world.fail === table) return { data: null, error: { message: `${table} unreachable` } };
          return { data: rowsFor(table, eqs)[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            world.fail === table
              ? { data: null, error: { message: `${table} unreachable` } }
              : { data: rowsFor(table, eqs), error: null },
          ),
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      if (name === "acc_transaction_list") {
        return {
          range: async (from: number, to: number) => {
            (calls.ranges.acc_transaction_list ??= []).push([from, to]);
            return { data: world.transactions.slice(from, to + 1), error: null };
          },
        };
      }
      if (name === "acc_ledger_balances") {
        return {
          range: async (from: number, to: number) => ({ data: (world.ledger ?? []).slice(from, to + 1), error: null }),
        };
      }
      return Promise.resolve(rpcAnswers[name]?.(args) ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

const rpcAnswers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }> = {};

function emptyWorld(): World {
  return { banks: [], chart: [], lines: {}, ticked: {}, sessions: [], transactions: [] };
}

const BANK = { id: "bank-1", account_id: "gl-1", bank_name: "First Test Bank", acc_account: { name: "Operating Checking" } };

/** Day `i` of an invented calendar, one date per index. */
function day(i: number): string {
  return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
}

let seq = 0;
function journalLine(date: string, signed: number, over: { id?: string; entry?: string } = {}): { line: Row; entry: Row } {
  seq += 1;
  const id = over.id ?? `line-${String(seq).padStart(5, "0")}`;
  const entryId = over.entry ?? `entry-${String(seq).padStart(5, "0")}`;
  return {
    line: {
      id,
      debit_minor: signed > 0 ? signed : 0,
      credit_minor: signed < 0 ? -signed : 0,
      amount_base_minor: Math.abs(signed),
      acc_journal_entry: { id: entryId, entry_number: `JE-${String(seq).padStart(6, "0")}`, entry_date: date, source_type: "manual" },
    },
    entry: {
      entry_id: entryId,
      entry_number: `JE-${String(seq).padStart(6, "0")}`,
      entry_date: date,
      description: "",
      source_type: "manual",
      party_name: null,
      category_label: null,
      money_label: null,
      amount_minor: Math.abs(signed),
      currency_code: "USD",
      reconciled: false,
      account_ids: ["gl-1", "gl-expense"],
    },
  };
}

describe("getStatementAlerts", () => {
  it("reads past 1,000 lines and finds a balance posted as payments that sits on a later page", async () => {
    // 1,100 ordinary days of +$1.00 each under its own name, then the balance
    // read as payments on four of those days: the 1,101st to 1,104th rows,
    // which only a second page contains.
    const world = emptyWorld();
    world.banks = [BANK];
    world.chart = [{ id: "gl-expense", account_code: "6000", name: "Wages" }];
    const rows: { line: Row; entry: Row }[] = [];
    for (let i = 0; i < 1100; i += 1) rows.push(journalLine(day(i), 100));
    for (const i of [900, 1000, 1050, 1090]) {
      const made = journalLine(day(i), -(100 * (i + 1)));
      made.entry.description = "PAYROLL";
      rows.push(made);
    }
    // The name comes from the transaction list; give every ordinary entry its own.
    rows.forEach((r, i) => {
      if (r.entry.description === "") r.entry.description = `Counterparty ${i}`;
    });
    world.lines["gl-1"] = rows.map((r) => r.line);
    world.transactions = rows.map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const alerts = await getStatementAlerts(fakeClient(world, calls), "bank-1");

    expect(calls.ranges.acc_journal_line).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls.ranges.acc_transaction_list).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(alerts.ghosts).toHaveLength(1);
    expect(alerts.ghosts[0].payee).toBe("PAYROLL");
    expect(alerts.ghosts[0].agree).toBe(4);
    expect(alerts.ghosts[0].rows[0].codedTo).toEqual(["6000 Wages"]);
    // Four such payments take the account below zero, which the second detector sees on the same read.
    expect(alerts.negative?.outstandingCount).toBe(4);
  });

  it("reads the last agreed statement and which lines are ticked, and leaves those out of the unpaid list", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const deposit = journalLine("2026-01-01", 50_000);
    const rent = journalLine("2026-01-05", -20_000);
    const supplier = journalLine("2026-01-10", -40_000);
    const other = journalLine("2026-01-12", -2_000);
    world.lines["gl-1"] = [deposit, rent, supplier, other].map((r) => r.line);
    supplier.entry.party_name = "Supplier A";
    other.entry.party_name = "Supplier B";
    world.transactions = [deposit, rent, supplier, other].map((r) => r.entry);
    world.ticked["bank-1"] = [rent.line.id as string, supplier.line.id as string];
    world.sessions = [
      { id: "s-old", bank_account_id: "bank-1", statement_ending_date: "2025-12-31", statement_ending_balance_minor: 0, completed_at: "2026-01-01T00:00:00Z" },
      { id: "s-new", bank_account_id: "bank-1", statement_ending_date: "2026-01-05", statement_ending_balance_minor: "30000", completed_at: "2026-01-06T00:00:00Z" },
    ];

    const { negative } = await getStatementAlerts(fakeClient(world), "bank-1");

    expect(negative?.last).toEqual({ date: "2026-01-05", endingMinor: 30_000 });
    expect(negative?.nowMinor).toBe(-12_000);
    expect(negative?.worst).toEqual({ date: "2026-01-12", balanceMinor: -12_000 });
    // The supplier payment is ticked, so only the last one is outstanding.
    expect(negative?.outstanding.map((o) => [o.name, o.amountMinor])).toEqual([["Supplier B", -2_000]]);
    expect(negative?.outstandingCount).toBe(1);
  });

  it("asks only for ticks and sessions that are completed, and for this bank account", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient(world);
    const original = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const eq = b.eq;
      b.eq = (column: unknown, value: unknown) => {
        seen.push({ table, column, value });
        return eq(column, value);
      };
      return b;
    };
    await getStatementAlerts(client, "bank-1");
    expect(seen).toContainEqual({ table: "acc_reconciliation_line", column: "acc_statement_reconciliation.status", value: "completed" });
    expect(seen).toContainEqual({ table: "acc_reconciliation_line", column: "acc_statement_reconciliation.bank_account_id", value: "bank-1" });
    expect(seen).toContainEqual({ table: "acc_statement_reconciliation", column: "status", value: "completed" });
    expect(seen).toContainEqual({ table: "acc_journal_line", column: "acc_journal_entry.status", value: "posted" });
    expect(seen).toContainEqual({ table: "acc_journal_line", column: "account_id", value: "gl-1" });
  });

  it("names an entry by its number when the transaction list has no row for it", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const a = journalLine("2026-01-01", 1_000);
    const b = journalLine("2026-01-02", -5_000);
    world.lines["gl-1"] = [a.line, b.line];
    world.transactions = [a.entry];
    const { negative } = await getStatementAlerts(fakeClient(world), "bank-1");
    expect(negative?.outstanding[0].name).toBe(b.entry.entry_number);
  });

  it("leaves out an entry that was reversed, and its reversal, before either detector looks", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const deposit = journalLine("2026-01-01", 10_000);
    const wrong = journalLine("2026-01-02", -40_000);
    const undo = journalLine("2026-01-02", 40_000);
    world.lines["gl-1"] = [deposit, wrong, undo].map((r) => r.line);
    world.transactions = [deposit, wrong, undo].map((r) => r.entry);
    world.reversals = [{ id: "link-1", original_entry_id: wrong.entry.entry_id, reversal_entry_id: undo.entry.entry_id }];
    const calls: Calls = { ranges: {}, rpc: [] };

    const { lines } = await getBankAccountLines(fakeClient(world, calls), "bank-1");

    expect(lines.map((l) => l.entryId)).toEqual([deposit.entry.entry_id]);
    expect(calls.ranges.acc_journal_reversal_link).toEqual([[0, 999]]);
  });

  it("finds nothing on an account with no lines", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    expect(await getStatementAlerts(fakeClient(world), "bank-1")).toEqual({ ghosts: [], negative: null });
  });

  it("fails, rather than answering from half a ledger, when a read fails", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    world.fail = "acc_journal_line";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toBeInstanceOf(StatementAlertsError);
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/entries failed: acc_journal_line unreachable/);
    world.fail = "acc_reconciliation_line";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/ticked lines failed/);
    world.fail = "acc_journal_reversal_link";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/the reversals failed/);
  });

  it("says so when the bank account is not there", async () => {
    await expect(getStatementAlerts(fakeClient(emptyWorld()), "nope")).rejects.toThrow("Bank account not found");
  });
});

describe("getAllStatementAlerts", () => {
  it("runs both detectors for every bank account and reads the transaction list once", async () => {
    const world = emptyWorld();
    world.banks = [
      BANK,
      { id: "bank-2", account_id: "gl-2", bank_name: "Second Test Bank", acc_account: null },
    ];
    const overdrawn = [journalLine("2026-01-01", 1_000), journalLine("2026-01-03", -5_000)];
    const fine = [journalLine("2026-01-01", 9_000)];
    world.lines["gl-1"] = overdrawn.map((r) => r.line);
    world.lines["gl-2"] = fine.map((r) => r.line);
    world.transactions = [...overdrawn, ...fine].map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const all = await getAllStatementAlerts(fakeClient(world, calls));

    expect(all.map((a) => [a.bankAccountId, a.accountName, a.negative !== null, a.ghosts.length])).toEqual([
      ["bank-1", "Operating Checking", true, 0],
      ["bank-2", "Second Test Bank", false, 0],
    ]);
    expect(calls.rpc.filter((c) => c.name === "acc_transaction_list")).toHaveLength(1);
  });

  it("returns nothing when there are no bank accounts", async () => {
    const calls: Calls = { ranges: {}, rpc: [] };
    expect(await getAllStatementAlerts(fakeClient(emptyWorld(), calls))).toEqual([]);
    expect(calls.rpc).toEqual([]);
  });
});

describe("getBalanceEntryBlockers", () => {
  it("maps the database's rows", async () => {
    rpcAnswers.acc_balance_entry_blockers = () => ({
      data: [{ entry_id: "e1", entry_number: "JE-000007", reason: "Ticked in a completed reconciliation" }],
      error: null,
    });
    const calls: Calls = { ranges: {}, rpc: [] };
    const blockers = await getBalanceEntryBlockers(fakeClient(emptyWorld(), calls), ["e1", "e2"]);
    expect(blockers).toEqual([{ entryId: "e1", entryNumber: "JE-000007", reason: "Ticked in a completed reconciliation" }]);
    expect(calls.rpc).toEqual([{ name: "acc_balance_entry_blockers", args: { p_entry_ids: ["e1", "e2"] } }]);
  });

  it("does not ask when there is nothing to ask about", async () => {
    const calls: Calls = { ranges: {}, rpc: [] };
    expect(await getBalanceEntryBlockers(fakeClient(emptyWorld(), calls), [])).toEqual([]);
    expect(calls.rpc).toEqual([]);
  });

  it("throws the database's message", async () => {
    rpcAnswers.acc_balance_entry_blockers = () => ({ data: null, error: { message: "Not authorized to check entries for removal" } });
    await expect(getBalanceEntryBlockers(fakeClient(emptyWorld()), ["e1"])).rejects.toThrow("Not authorized to check entries for removal");
  });
});

describe("removeBalanceEntries", () => {
  it("sends the account, the entries and the reason, and returns the counts", async () => {
    rpcAnswers.acc_remove_balance_entries = () => ({
      data: { removed: 3, reversed: 2, voided: 1, total_minor: -123_400 },
      error: null,
    });
    const calls: Calls = { ranges: {}, rpc: [] };
    const result = await removeBalanceEntries(fakeClient(emptyWorld(), calls), "bank-1", ["e1", "e2", "e3"], "Balance column");
    expect(result).toEqual({ removed: 3, reversed: 2, voided: 1, total_minor: -123_400 });
    expect(calls.rpc).toEqual([
      { name: "acc_remove_balance_entries", args: { p_bank_account_id: "bank-1", p_entry_ids: ["e1", "e2", "e3"], p_reason: "Balance column" } },
    ]);
  });

  it("passes a refusal through as it is", async () => {
    const message = "2 of these entries cannot be removed: JE-000007 (closed period); JE-000009 (invoice INV-0001, void it there)";
    rpcAnswers.acc_remove_balance_entries = () => ({ data: null, error: { message } });
    await expect(removeBalanceEntries(fakeClient(emptyWorld()), "bank-1", ["e1"], "x")).rejects.toThrow(message);
    await expect(removeBalanceEntries(fakeClient(emptyWorld()), "bank-1", ["e1"], "x")).rejects.toBeInstanceOf(StatementAlertsError);
  });
});


describe("getBelowZeroBankAccounts", () => {
  const ledger = (accountId: string, debit: number, credit: number): Row => ({
    account_id: accountId,
    account_code: "1000",
    name: "x",
    account_type: "bank",
    debit_base: debit,
    credit_base: credit,
  });

  it("looks only at the accounts that read below zero on that date, and counts their flagged entries", async () => {
    const world = emptyWorld();
    world.banks = [BANK, { id: "bank-2", account_id: "gl-2", bank_name: "Second Test Bank", acc_account: { name: "Savings" } }];
    world.ledger = [ledger("gl-1", 1_000, 5_000), ledger("gl-2", 9_000, 0)];
    const overdrawn = [journalLine("2026-01-01", 1_000), journalLine("2026-01-03", -5_000)];
    world.lines["gl-1"] = overdrawn.map((r) => r.line);
    world.transactions = overdrawn.map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const found = await getBelowZeroBankAccounts(fakeClient(world, calls), "2026-02-01");

    expect(found).toEqual([{ bankAccountId: "bank-1", accountName: "Operating Checking", ghostEntries: 0 }]);
    // Only the overdrawn account's lines were read.
    expect(calls.ranges.acc_journal_line).toHaveLength(1);
  });

  it("finds nothing when every bank account is at or above zero", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    world.ledger = [ledger("gl-1", 5_000, 5_000)];
    expect(await getBelowZeroBankAccounts(fakeClient(world), "2026-02-01")).toEqual([]);
  });
});
