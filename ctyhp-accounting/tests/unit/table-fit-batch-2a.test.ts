import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { BANK_IMPORT_LIST_FIXED_WIDTHS } from "@/app/(app)/banking/BankImportList";
import { RECONCILE_LIST_FIXED_WIDTHS } from "@/app/(app)/banking/reconcile/ReconcileListClient";
import { LEDGER_LINES_FIXED_WIDTHS } from "@/app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient";
import { STATEMENT_LINE_WIDTH } from "@/app/(app)/banking/reconcile/[id]/statement-line-columns";
import { SETTLE_FROM_BANK_FIXED_WIDTHS, SETTLE_FROM_BANK_MODAL_WIDTH } from "@/components/banking/SettleFromBankModal";
import { SETTLEMENT_HISTORY_FIXED_WIDTHS } from "@/components/settlements/SettlementHistory";
import { CREDIT_MEMO_APPLY_FIXED_WIDTHS, CREDIT_MEMO_APPLY_MODAL_WIDTH } from "@/app/(app)/credit-memos/CreditMemosClient";
import { VENDOR_CREDIT_APPLY_FIXED_WIDTHS, VENDOR_CREDIT_APPLY_MODAL_WIDTH } from "@/app/(app)/vendor-credits/VendorCreditsClient";
import {
  PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS,
  PAYMENT_DRAWER_JOURNAL_FIXED_WIDTHS,
  PAYMENT_DRAWER_WIDTH,
} from "@/app/(app)/payments/PaymentDetailDrawer";
import { RECEIVE_PAYMENT_FIXED_WIDTHS, RECEIVE_PAYMENT_MODAL_WIDTH } from "@/app/(app)/payments/ReceivePaymentModal";
import { ITEM_MOVEMENTS_FIXED_WIDTHS, ITEM_MOVEMENTS_MODAL_WIDTH } from "@/app/(app)/items/ItemMovementsModal";
import { OPENING_BALANCES_FIXED_WIDTHS } from "@/app/(app)/opening-balances/OpeningBalancesClient";
import { VENDOR_TAX_DRAWER_WIDTH, VENDOR_TAX_VERSIONS_FIXED_WIDTHS } from "@/app/(app)/vendors/VendorTaxDrawer";

/**
 * The second batch of screens off Ant Design's own Table, group A (2.91): the
 * banking lists, the reconciliation workspace, the settlement and apply
 * dialogs, the payment drawer, item movements, opening balances and the vendor
 * tax drawer. Each is a fitted DataTable now, so each row has to fit its box
 * with its elastic columns at their floors.
 */
const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);
/** Ant Design's modal and drawer body: the container's width less 24px of padding each side. */
const body = (width: number) => width - 48;

describe("the second batch of fitted tables, group A", () => {
  it("fits the statement imports at 1280 with File and Into at their floors", () => {
    expect(fitsBox(sum(BANK_IMPORT_LIST_FIXED_WIDTHS), COLUMN.RICH_MIN + COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the reconciliations list at 1280 with Statement at its floor", () => {
    expect(fitsBox(sum(RECONCILE_LIST_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the workspace's statement lines at 1280 with Description at its floor", () => {
    expect(fitsBox(sum(Object.values(STATEMENT_LINE_WIDTH)), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the workspace's ledger lines at 1280 with Memo at its floor", () => {
    expect(fitsBox(sum(LEDGER_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the candidates in Settle from bank transaction with the name at its floor", () => {
    expect(fitsBox(sum(SETTLE_FROM_BANK_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(SETTLE_FROM_BANK_MODAL_WIDTH))).toBe(true);
  });

  it("fits the credit memo's Apply dialog with the invoice number at its floor", () => {
    expect(fitsBox(sum(CREDIT_MEMO_APPLY_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(CREDIT_MEMO_APPLY_MODAL_WIDTH))).toBe(true);
  });

  it("fits the vendor credit's Apply dialog with the bill number at its floor", () => {
    expect(fitsBox(sum(VENDOR_CREDIT_APPLY_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(VENDOR_CREDIT_APPLY_MODAL_WIDTH))).toBe(true);
  });

  it("fits the invoices a payment settled inside its drawer with the invoice number at its floor", () => {
    expect(
      fitsBox(sum(PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(PAYMENT_DRAWER_WIDTH)),
    ).toBe(true);
  });

  it("fits the payment's journal lines inside its drawer with the account at its floor", () => {
    expect(fitsBox(sum(PAYMENT_DRAWER_JOURNAL_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(PAYMENT_DRAWER_WIDTH))).toBe(true);
  });

  it("fits the open invoices in Receive payment with the invoice number at its floor", () => {
    expect(fitsBox(sum(RECEIVE_PAYMENT_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(RECEIVE_PAYMENT_MODAL_WIDTH))).toBe(true);
  });

  it("fits an item's movements inside their dialog with Memo at its floor", () => {
    expect(fitsBox(sum(ITEM_MOVEMENTS_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(ITEM_MOVEMENTS_MODAL_WIDTH))).toBe(true);
  });

  it("fits the opening balances entry at 1280 with Account at its floor", () => {
    expect(fitsBox(sum(OPENING_BALANCES_FIXED_WIDTHS), COLUMN.RICH_MIN)).toBe(true);
  });

  it("fits a vendor's tax version history inside its drawer with Reason at its floor", () => {
    expect(fitsBox(sum(VENDOR_TAX_VERSIONS_FIXED_WIDTHS), COLUMN.TEXT_MIN, body(VENDOR_TAX_DRAWER_WIDTH))).toBe(true);
  });

  // The settlement history sits in the invoice dialog (820px, body 772) and the
  // bill dialog (860px, body 812). As seven measured columns and Reference it
  // came to 998px; type, number, method and reference now share one column.
  it("fits the settlement history inside the invoice dialog, the narrower of its two, with Settlement at its floor", () => {
    expect(fitsBox(sum(SETTLEMENT_HISTORY_FIXED_WIDTHS), COLUMN.RICH_MIN, 820 - 48)).toBe(true);
  });
});
