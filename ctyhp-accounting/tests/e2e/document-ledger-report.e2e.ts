import { describe, expect, it } from "vitest";
import { buildProfitAndLoss, buildTrialBalance } from "@/lib/domain/reports";
import { closeE2eSession, openE2eSession } from "./support/session";
import {
  describeSnapshotDelta,
  readLedgerBalances,
  readSnapshot,
} from "./support/ledger-snapshot";
import { sweepMarker } from "./support/cleanup";

const AMOUNT_MINOR = 248_750;

describe("document → journal → ledger → report over HTTPS", () => {
  it("posts one USD invoice through every authoritative layer and leaves the ledger untouched", async () => {
    const { sb, marker, today } = await openE2eSession();
    await sweepMarker(sb, marker);
    // Captured outside the try so the finally block can compare against it.
    const opening = await readSnapshot(sb, today);
    const balancesBefore = await readLedgerBalances(sb, today);
    let postedEntryId: string | null = null;

    try {
      expect(opening.totalDebitMinor).toBe(opening.totalCreditMinor);
      expect(buildTrialBalance(balancesBefore).balanced).toBe(true);

      const { data: income, error: incomeError } = await sb
        .from("acc_account")
        .select("id, account_code")
        .eq("account_type", "income")
        .eq("status", "active")
        .eq("is_posting_account", true)
        .order("account_code")
        .limit(1)
        .single();
      expect(incomeError, "an active posting income account is required").toBeNull();

      const { data: customer, error: customerError } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD" })
        .select("id")
        .single();
      expect(customerError).toBeNull();

      // Draft creation and its audit row are one atomic RPC (migration 0058).
      const { data: invoiceId, error: draftError } = await sb.rpc(
        "acc_create_draft_invoice",
        {
          p_customer_id: customer!.id,
          p_issue_date: today,
          p_due_date: today,
          p_currency: "USD",
          p_memo: marker,
          p_lines: [
            {
              description: "Jewelry appraisal and setting service",
              quantity: 1,
              unit_price_minor: AMOUNT_MINOR,
              income_account_id: income!.id,
              tax_code_id: null,
              item_id: null,
            },
          ],
          p_recurring_run_id: null,
        },
      );
      expect(
        draftError,
        `acc_create_draft_invoice failed: ${draftError?.message}`,
      ).toBeNull();

      const { count: lineCount } = await sb
        .from("acc_invoice_line")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", invoiceId);
      expect(lineCount, "the draft RPC must write header and lines atomically").toBe(1);

      const { count: draftAudit } = await sb
        .from("acc_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("table_name", "acc_invoice")
        .eq("record_id", invoiceId)
        .eq("action", "insert");
      expect(draftAudit, "the draft RPC must audit atomically").toBe(1);

      const { data: journalEntryId, error: issueError } = await sb.rpc(
        "acc_issue_invoice",
        { p_invoice_id: invoiceId },
      );
      expect(issueError, `acc_issue_invoice failed: ${issueError?.message}`).toBeNull();
      expect(journalEntryId).toBeTruthy();
      postedEntryId = journalEntryId as string;

      const { data: journalLines, error: journalError } = await sb
        .from("acc_journal_line")
        .select("debit_minor, credit_minor, account_id")
        .eq("journal_entry_id", journalEntryId);
      expect(journalError).toBeNull();
      const debit = journalLines!.reduce((sum, row) => sum + Number(row.debit_minor), 0);
      const credit = journalLines!.reduce(
        (sum, row) => sum + Number(row.credit_minor),
        0,
      );
      expect(debit, "the posted entry must balance").toBe(credit);
      expect(debit).toBe(AMOUNT_MINOR);

      const issued = await readSnapshot(sb, today);
      expect(issued.totalDebitMinor - opening.totalDebitMinor).toBe(AMOUNT_MINOR);
      expect(issued.totalCreditMinor - opening.totalCreditMinor).toBe(AMOUNT_MINOR);
      expect(issued.arTotalMinor - opening.arTotalMinor).toBe(AMOUNT_MINOR);

      // The report builders must agree with the database they read from.
      const balancesAfter = await readLedgerBalances(sb, today);
      const trialBalanceAfter = buildTrialBalance(balancesAfter);
      expect(trialBalanceAfter.balanced, "the trial balance must stay balanced").toBe(true);
      expect(
        trialBalanceAfter.totalDebit - buildTrialBalance(balancesBefore).totalDebit,
      ).toBe(AMOUNT_MINOR);
      expect(
        buildProfitAndLoss(balancesAfter).income.total -
          buildProfitAndLoss(balancesBefore).income.total,
        "income must rise by the invoice total",
      ).toBe(AMOUNT_MINOR);

      const { error: voidError } = await sb.rpc("acc_void_invoice", {
        p_invoice_id: invoiceId,
      });
      expect(voidError, `acc_void_invoice failed: ${voidError?.message}`).toBeNull();

      const reversed = await readSnapshot(sb, today);
      expect(reversed.arTotalMinor).toBe(opening.arTotalMinor);
      expect(buildTrialBalance(await readLedgerBalances(sb, today)).balanced).toBe(true);

      // Voiding does not post a counter-entry: it flips the entry to 'void' and
      // reports read posted entries only. The entry therefore stays in history.
      const { data: voidedEntry } = await sb
        .from("acc_journal_entry")
        .select("status, voided_at")
        .eq("id", postedEntryId)
        .single();
      expect(voidedEntry?.status).toBe("void");
      expect(voidedEntry?.voided_at).toBeTruthy();
    } finally {
      await sweepMarker(sb, marker);
      const closing = await readSnapshot(sb, today);

      // The voided entry's lines remain by design, so the journal legitimately
      // grew. Money must not have: every other figure is compared exactly.
      const expectedGrowth = postedEntryId
        ? ((
            await sb
              .from("acc_journal_line")
              .select("id", { count: "exact", head: true })
              .eq("journal_entry_id", postedEntryId)
          ).count ?? 0)
        : 0;
      await closeE2eSession(sb);

      expect(
        closing.journalLineCount - opening.journalLineCount,
        "the only new journal lines must be the voided entry's own",
      ).toBe(expectedGrowth);
      expect(
        describeSnapshotDelta(
          { ...opening, journalLineCount: closing.journalLineCount },
          closing,
        ),
        "the run must leave every reported figure exactly as it found it",
      ).toBe("no difference");
    }
  });
});
