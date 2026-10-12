/**
 * The statement alerts, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to and every bank account in it, both
 * detectors run over the account's real lines, and their output is checked for
 * internal consistency:
 *  (a) the account's lines add up to its ledger balance, and when the account
 *      is flagged below zero, "now" is that balance;
 *  (b) every row of a flagged group lands on the account's balance without the
 *      group, worked out again here by a plain sum, plus its offset;
 *  (c) every outstanding payment is an unticked, negative line dated after the
 *      last agreed statement.
 * Counts are logged: how many accounts each detector flags. Names and amounts
 * never are, and nothing is written — every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/statement-alerts.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { payeeKeyOf, statementAlerts } from "@/lib/domain/statement-alerts";
import { listBankAccounts } from "@/lib/services/banking";
import { getLedgerBalances } from "@/lib/services/reports";
import { getBankAccountLines } from "@/lib/services/statement-alerts";

interface Company {
  name: string;
  sb: SupabaseClient;
}

const companies: Company[] = [];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    companies.push({
      name: row.schema_name,
      sb: createClient(s.supabaseUrl, s.anonKey, {
        db: { schema: row.schema_name },
        auth,
        global: { headers },
      }) as unknown as SupabaseClient,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("statement alerts on every company's bank accounts", () => {
  it("both detectors agree with the ledger and with themselves", async () => {
    for (const c of companies) {
      const [banks, balances] = await Promise.all([listBankAccounts(c.sb), getLedgerBalances(c.sb, null, "9999-12-31")]);
      const ledger = new Map(balances.map((b) => [b.accountId, b.debitBase - b.creditBase]));
      let ghostAccounts = 0;
      let ghostGroupCount = 0;
      let negativeAccounts = 0;
      let nowNegative = 0;
      let outstandingChecked = 0;
      let problems = 0;

      for (const bank of banks) {
        const { lines, last } = await getBankAccountLines(c.sb, bank.id);
        const found = statementAlerts(lines, last);
        const byId = new Map(lines.map((l) => [l.lineId, l]));
        const total = lines.reduce((sum, l) => sum + l.amountMinor, 0);

        // (a) The lines are the ledger, and "now" is the ledger balance.
        if (total !== (ledger.get(bank.account_id) ?? 0)) problems += 1;
        if (found.negative && found.negative.nowMinor !== total) problems += 1;

        // (b) Each flagged row lands on the balance without its group, plus its offset.
        for (const group of found.ghosts) {
          const inGroup = new Set(
            lines.filter((l) => payeeKeyOf(l.payee) === payeeKeyOf(group.payee)).map((l) => l.lineId),
          );
          const offsets = new Map<number, number>();
          for (const row of group.rows) offsets.set(row.differenceMinor, (offsets.get(row.differenceMinor) ?? 0) + 1);
          for (const row of group.rows) {
            const without = lines
              .filter((l) => !inGroup.has(l.lineId) && l.date <= row.date)
              .reduce((sum, l) => sum + l.amountMinor, 0);
            if (row.balanceMinor !== without) problems += 1;
            if (Math.abs(row.amountMinor) !== row.balanceMinor + row.differenceMinor) problems += 1;
            if (row.differenceMinor !== 0 && (offsets.get(row.differenceMinor) ?? 0) < 3) problems += 1;
          }
          if (group.agree < 3 || group.agree / group.of < 0.6) problems += 1;
          ghostGroupCount += 1;
        }
        if (found.ghosts.length > 0) ghostAccounts += 1;

        // (c) Outstanding payments are unticked, negative and after the last statement.
        if (found.negative) {
          negativeAccounts += 1;
          if (found.negative.nowMinor < 0) nowNegative += 1;
          for (const o of found.negative.outstanding) {
            const line = byId.get(o.lineId);
            outstandingChecked += 1;
            if (!line || line.cleared || line.amountMinor >= 0 || (last !== null && line.date <= last.date)) problems += 1;
          }
          if (found.negative.last?.date !== last?.date) problems += 1;
          // A never-reconciled account is flagged only while negative now.
          if (last === null && found.negative.nowMinor >= 0) problems += 1;
        }
      }

      console.log(
        `${c.name}: ${banks.length} bank accounts, ${ghostAccounts} with a balance posted as payments (${ghostGroupCount} groups), ` +
          `${negativeAccounts} below zero since the last statement (${nowNegative} still today), ` +
          `${outstandingChecked} outstanding payments checked, ${problems === 0 ? "all consistent" : `${problems} INCONSISTENT`}`,
      );
      expect(problems, c.name).toBe(0);
    }
  });
});
