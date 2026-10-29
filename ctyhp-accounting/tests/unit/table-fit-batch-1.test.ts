import { describe, expect, it } from "vitest";
import { COLUMN, EXPAND_COLUMN_WIDTH, fitsBox } from "@/lib/design/table-metrics";
import { PAYMENTS_FIXED_WIDTHS } from "@/app/(app)/payments/PaymentsClient";
import { OPEN_BILLS_FIXED_WIDTHS, PAY_BILLS_FIXED_WIDTHS, PAY_BILLS_MODAL_WIDTH } from "@/app/(app)/pay-bills/PayBillsClient";
import { INVOICE_LINES_FIXED_WIDTHS, VIEW_INVOICE_MODAL_WIDTH } from "@/app/(app)/invoices/InvoicesClient";
import { JOURNAL_FIXED_WIDTHS, JOURNAL_LINES_FIXED_WIDTHS } from "@/app/(app)/journal/JournalClient";

/**
 * The first batch of screens off Ant Design's own Table (2.75): Payments, Pay
 * Bills, an invoice's lines and the Journal. Each is a fitted DataTable now, so
 * each row has to fit its box with its elastic columns at their floors.
 */
const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);
/** Ant Design's modal body: the dialog's width less 24px of padding each side. */
const modalBody = (width: number) => width - 48;

describe("the first batch of fitted tables", () => {
  it("fits Payments at 1280 with Customer at its floor", () => {
    expect(fitsBox(sum(PAYMENTS_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits Pay Bills' payments at 1280 with Vendor at its floor", () => {
    expect(fitsBox(sum(PAY_BILLS_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the open bills inside the Pay bills dialog with Discount at its floor", () => {
    expect(fitsBox(sum(OPEN_BILLS_FIXED_WIDTHS), COLUMN.TEXT_MIN, modalBody(PAY_BILLS_MODAL_WIDTH))).toBe(true);
  });

  it("fits an invoice's lines inside its dialog with Description at its floor", () => {
    expect(fitsBox(sum(INVOICE_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN, modalBody(VIEW_INVOICE_MODAL_WIDTH))).toBe(true);
  });

  it("fits the Journal at 1280 with Description at its floor and the expand button", () => {
    expect(fitsBox(sum(JOURNAL_FIXED_WIDTHS) + EXPAND_COLUMN_WIDTH, COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits an opened entry's lines under it with Account and Memo at their floors", () => {
    const underTheEntry = 984 - EXPAND_COLUMN_WIDTH;
    expect(fitsBox(sum(JOURNAL_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN * 2, underTheEntry)).toBe(true);
  });
});
