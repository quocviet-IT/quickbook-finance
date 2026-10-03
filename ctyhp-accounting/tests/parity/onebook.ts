import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { MigrationSource } from "@/lib/db/migration-sources";
import { buildBalanceSheet, buildProfitAndLoss, buildTrialBalance, type LedgerBalance } from "@/lib/domain/reports";
import { prototypeAccountType } from "@/lib/parity/account-types";
import { journalLines, type JournalLineInput } from "@/lib/parity/cents";
import type { BookFigures, ParityEntry, PrototypeBook } from "@/lib/parity/types";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { ledgerBalanceFromRow } from "@/lib/services/reports";

/**
 * The OneBook side of the harness. Everything here runs inside the caller's
 * transaction, which the caller always rolls back: a throwaway company is
 * built, the prototype's book is posted into it exactly, and OneBook's
 * figures are read on the same connection, so they see the uncommitted
 * entries. Nothing survives.
 */
export interface LoadedBook {
  schema: string;
  /** Prototype account name → OneBook account id. */
  accountIds: Map<string, string>;
  loaded: number;
  notLoaded: { id: string; date: string; problem: string; accounts: string[] }[];
}

const BATCH = 200;
const POST = `select acc_post_manual_journal((x.e->>'date')::date, x.e->>'description', nullif(x.e->>'ref', ''), $2, x.e->'lines') as id
  from jsonb_array_elements($1::jsonb) as x(e)`;

type Ready = { entry: ParityEntry; lines: JournalLineInput[] };
const payload = (items: readonly Ready[]) =>
  JSON.stringify(
    items.map(({ entry, lines }) => ({
      date: entry.date,
      description: entry.description.slice(0, 500) || "Prototype entry",
      ref: entry.ref.slice(0, 100),
      lines,
    })),
  );
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function loadIntoThrowaway(
  client: pg.Client,
  book: PrototypeBook,
  sources: readonly MigrationSource[],
  adminUserId: string,
): Promise<LoadedBook> {
  const slug = `parity_${randomBytes(4).toString("hex")}`;
  const taken = await client.query("select 1 from onebook.company where slug = $1", [slug]);
  if (taken.rowCount) throw new Error("the temporary company name is already taken; run again");
  const { schema } = await provisionCompany(
    client,
    { slug, legalName: "Parity check", isSample: true, displayOrder: 9999, adminUserIds: [adminUserId] },
    sources,
  );
  await client.query(`set local search_path = ${schema}, extensions`);
  const base = (await client.query("select code from acc_currency where is_base limit 1")).rows[0]?.code as string | undefined;
  if (!base) throw new Error("the throwaway company has no base currency");

  // One account per prototype account, typed by the prototype's own classes; P-codes never meet the template's.
  const accountIds = new Map<string, string>();
  for (const [i, name] of book.accounts.entries()) {
    const type = prototypeAccountType(name);
    if (!type) continue;
    const { rows } = await client.query(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, $3, $4, true) returning id`,
      [`P${String(i + 1).padStart(4, "0")}`, name, type, base],
    );
    accountIds.set(name, rows[0].id as string);
  }

  const notLoaded: LoadedBook["notLoaded"] = [];
  const ready: Ready[] = [];
  for (const entry of [...book.entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const result = journalLines(entry.postings, accountIds);
    const accounts = entry.postings.map((p) => p.account);
    if ("problem" in result) notLoaded.push({ id: entry.id, date: entry.date, problem: result.problem, accounts });
    else ready.push({ entry, lines: result.lines });
  }

  // Post as the company's administrator, in batches; a batch that refuses is retried one entry at a time.
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminUserId, role: "authenticated" })]);
  let loaded = 0;
  for (let i = 0; i < ready.length; i += BATCH) {
    const batch = ready.slice(i, i + BATCH);
    await client.query("savepoint parity_batch");
    try {
      await client.query(POST, [payload(batch), base]);
      await client.query("release savepoint parity_batch");
      loaded += batch.length;
    } catch {
      await client.query("rollback to savepoint parity_batch");
      for (const item of batch) {
        await client.query("savepoint parity_one");
        try {
          await client.query(POST, [payload([item]), base]);
          await client.query("release savepoint parity_one");
          loaded += 1;
        } catch (error) {
          await client.query("rollback to savepoint parity_one");
          notLoaded.push({ id: item.entry.id, date: item.entry.date, problem: reason(error), accounts: item.entry.postings.map((p) => p.account) });
        }
      }
    }
  }
  await client.query("reset role");
  return { schema, accountIds, loaded, notLoaded };
}

/** OneBook's figures for the same dates and years the prototype reported, from the builders the Reports screen uses. */
export async function readOnebookFigures(client: pg.Client, book: PrototypeBook, loaded: LoadedBook): Promise<BookFigures> {
  await client.query(`set local search_path = ${loaded.schema}, extensions`);
  const nameOf = new Map([...loaded.accountIds].map(([name, id]) => [id, name]));
  const read = async (from: string | null, to: string): Promise<LedgerBalance[]> =>
    (await client.query("select * from acc_ledger_balances($1, $2)", [from, to])).rows.map(ledgerBalanceFromRow);
  const figures: BookFigures = { balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} };
  for (const to of book.monthEnds) {
    const balances: Record<string, number> = {};
    for (const row of await read(null, to)) {
      const net = row.debitBase - row.creditBase;
      if (net !== 0) balances[nameOf.get(row.accountId) ?? `(not from the prototype) ${row.accountCode} ${row.name}`] = net;
    }
    figures.balances[to] = balances;
  }
  for (const { from, to } of book.fiscalYears) {
    const pl = buildProfitAndLoss(await read(from, to));
    figures.profitAndLoss[`${from}..${to}`] = {
      income: pl.income.total,
      cogs: pl.costOfGoodsSold.total,
      gross: pl.grossProfit,
      opex: pl.operatingExpenses.total,
      netOperating: pl.grossProfit - pl.operatingExpenses.total,
      otherIncome: pl.otherIncome.total,
      otherExpenses: pl.otherExpenses.total,
      netOther: pl.otherIncome.total - pl.otherExpenses.total,
      net: pl.netIncome,
    };
    const atEnd = await read(null, to);
    const sheet = buildBalanceSheet(atEnd);
    figures.balanceSheet[to] = {
      assets: sheet.totalAssets,
      liabilities: sheet.totalLiabilities,
      equity: sheet.totalEquity,
      liabilitiesAndEquity: sheet.totalLiabilities + sheet.totalEquity,
    };
    const trial = buildTrialBalance(atEnd);
    figures.trialBalance[to] = { debit: trial.totalDebit, credit: trial.totalCredit };
  }
  return figures;
}
