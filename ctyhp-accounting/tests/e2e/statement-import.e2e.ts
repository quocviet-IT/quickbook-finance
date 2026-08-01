import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { parseStatementRows } from "@/lib/domain/statement-import";
import { importStatement, listBankTransactions } from "@/lib/services/banking";
import {
  closeE2eSession,
  createE2eServiceClient,
  openE2eSession,
} from "./support/session";

function serviceClient() {
  return createE2eServiceClient();
}

/**
 * The path a statement takes from a file to the reconciliation: parse, import,
 * de-duplicate. Run against the live schema because the duplicate rule lives in
 * the database, not in the parser.
 */
describe("bank statement import over HTTPS", () => {
  it("imports a statement once, and recognises the same file the second time", async () => {
    const { sb, marker } = await openE2eSession();
    const admin = serviceClient();
    const descriptions = [`${marker} deposit`, `${marker} rent`];

    try {
      const { data: bankAccount } = await sb
        .from("acc_bank_account")
        .select("id")
        .limit(1)
        .single();
      expect(bankAccount, "a bank account is required to import a statement").toBeTruthy();
      const bankAccountId = (bankAccount as { id: string }).id;

      // A file in the shape a US bank exports: US dates, a thousands separator,
      // and separate debit and credit columns.
      const csv = [
        "Posting Date,Narrative,Check Number,Debit,Credit,Balance",
        `7/15/2026,${descriptions[0]},,,"2,806.51","27,120.27"`,
        `7/03/2026,${descriptions[1]},10428,"3,200.00",,"24,313.76"`,
      ].join("\n");

      const parsed = parseStatementRows(parseCsv(csv));
      expect(parsed.skipped).toBe(0);
      expect(parsed.rows.map((row) => row.amount_minor)).toEqual([280651, -320000]);
      expect(parsed.rows[1].reference).toBe("10428");

      const first = await importStatement(sb, bankAccountId, `${marker}.csv`, parsed.rows);
      expect(first.inserted, "both lines must land").toBe(2);
      expect(first.skipped).toBe(0);

      const stored = (await listBankTransactions(sb, bankAccountId)).filter((txn) =>
        descriptions.includes(txn.description),
      );
      expect(stored).toHaveLength(2);
      expect(stored.find((txn) => txn.description === descriptions[1])?.amount_minor).toBe(-320000);
      expect(stored.every((txn) => txn.status === "unmatched" || txn.status === "matched")).toBe(true);

      // The same file again: a bank statement gets re-uploaded all the time, and
      // a second copy of a transaction would put the reconciliation out.
      const second = await importStatement(sb, bankAccountId, `${marker}.csv`, parsed.rows);
      expect(second.inserted, "a re-upload must add nothing").toBe(0);
      expect(second.skipped).toBe(2);
    } finally {
      await admin.from("acc_bank_transaction").delete().in("description", descriptions);
      await closeE2eSession(sb);
    }
  });
});
