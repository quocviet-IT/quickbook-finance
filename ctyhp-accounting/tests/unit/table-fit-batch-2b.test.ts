import { describe, expect, it } from "vitest";
import { COLUMN, EXPAND_COLUMN_WIDTH, fitsBox } from "@/lib/design/table-metrics";
import { BILL_FROM_PO_FIXED_WIDTHS, BILL_FROM_PO_MODAL_WIDTH } from "@/app/(app)/purchase-orders/[id]/BillFromPoModal";
import { PO_EXCEPTIONS_FIXED_WIDTHS, PO_LINES_FIXED_WIDTHS } from "@/app/(app)/purchase-orders/[id]/PurchaseOrderDetailClient";
import { RECEIVE_LINES_FIXED_WIDTHS, RECEIVE_MODAL_WIDTH } from "@/app/(app)/purchase-orders/[id]/ReceiveModal";
import { REPORT_1099_FIXED_WIDTHS } from "@/app/(app)/reports/1099/Report1099Client";
import { GL_CONTROL_FIXED_WIDTHS } from "@/app/(app)/reports/gl-posting/GlPostingClient";
import { INVENTORY_REVIEW_FIXED_WIDTHS } from "@/app/(app)/reports/inventory-review/InventoryReviewClient";
import { JOURNAL_REPORT_LINES_FIXED_WIDTHS } from "@/app/(app)/reports/journal/JournalReportClient";
import { SEQUENCE_OVERVIEW_FIXED_WIDTHS } from "@/app/(app)/reports/number-sequence/NumberSequenceClient";
import { SAVED_REPORTS_FIXED_WIDTHS } from "@/app/(app)/reports/saved/SavedReportsClient";
import {
  SALES_TAX_BY_RATE_FIXED_WIDTHS,
  SALES_TAX_BY_STATE_FIXED_WIDTHS,
  SALES_TAX_PAYMENTS_FIXED_WIDTHS,
  SALES_TAX_PERIOD_FLOOR,
  SALES_TAX_RATES_FIXED_WIDTHS,
} from "@/app/(app)/sales-tax/SalesTaxClient";
import { AGING_PARTY_FIXED_WIDTHS } from "@/components/reports/AgingByPartyTable";
import { AFDA_FIXED_WIDTHS } from "@/components/reports/AllowanceForDoubtfulAccounts";

/**
 * The second batch of screens off Ant Design's own Table (2.91): the purchase
 * order's tables and dialogs, the reports and Sales Tax. Each is a fitted
 * DataTable or ReportTable now, so each row has to fit its box with its elastic
 * columns at their floors.
 */
const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);
/** Ant Design's modal body: the dialog's width less 24px of padding each side. */
const modalBody = (width: number) => width - 48;
/** A card's body is padded 24px either side; a small card's, 12px. */
const inCard = 984 - 48;
const inSmallCard = 984 - 24;

describe("the second batch of fitted tables", () => {
  it("fits the receive dialog's lines with Description at its floor", () => {
    expect(fitsBox(sum(RECEIVE_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN, modalBody(RECEIVE_MODAL_WIDTH))).toBe(true);
  });

  it("fits the bill-from-order dialog's lines with Description at its floor", () => {
    expect(fitsBox(sum(BILL_FROM_PO_FIXED_WIDTHS), COLUMN.TEXT_MIN, modalBody(BILL_FROM_PO_MODAL_WIDTH))).toBe(true);
  });

  it("fits a purchase order's lines in their card with Description at its floor", () => {
    expect(fitsBox(sum(PO_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN, inCard)).toBe(true);
  });

  it("fits the approved matching exceptions in their card with Reason at its floor", () => {
    expect(fitsBox(sum(PO_EXCEPTIONS_FIXED_WIDTHS), COLUMN.TEXT_MIN, inCard)).toBe(true);
  });

  // The reporting name and classification sit under the vendor: as columns of
  // their own the two names shared 192px of 984.
  it("fits the 1099 review at 1280 with Vendor at its floor", () => {
    expect(fitsBox(sum(REPORT_1099_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the control accounts at 1280 with the account's name at its floor", () => {
    expect(fitsBox(sum(GL_CONTROL_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  // The assessment wraps under the item and Write down sits under the status
  // tag: as two text columns beside a button column they shared 188px of 984.
  it("fits the inventory review at 1280 with Item at its floor", () => {
    expect(fitsBox(sum(INVENTORY_REVIEW_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits an opened journal report entry's lines with Account at its floor", () => {
    const underTheEntry = 984 - EXPAND_COLUMN_WIDTH;
    expect(fitsBox(sum(JOURNAL_REPORT_LINES_FIXED_WIDTHS), COLUMN.TEXT_MIN, underTheEntry)).toBe(true);
  });

  it("fits the number sequence overview in its card with the document type at its floor", () => {
    expect(fitsBox(sum(SEQUENCE_OVERVIEW_FIXED_WIDTHS), COLUMN.TEXT_MIN, inSmallCard)).toBe(true);
  });

  it("fits the saved reports in their card with the title at its floor", () => {
    expect(fitsBox(sum(SAVED_REPORTS_FIXED_WIDTHS), COLUMN.TEXT_MIN, inCard)).toBe(true);
  });

  it("fits Sales Tax's four tables at 1280", () => {
    // Owed by state: State and Rates are both elastic.
    expect(fitsBox(sum(SALES_TAX_BY_STATE_FIXED_WIDTHS), COLUMN.TEXT_MIN * 2)).toBe(true);
    expect(fitsBox(sum(SALES_TAX_BY_RATE_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
    expect(fitsBox(sum(SALES_TAX_PAYMENTS_FIXED_WIDTHS), SALES_TAX_PERIOD_FLOOR)).toBe(true);
    expect(fitsBox(sum(SALES_TAX_RATES_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  // What is overdue sits under the name: as a seventh amount column it left
  // the party 172px of 984, 28 short of its floor.
  it("fits the aging by party at 1280 with the party at its floor", () => {
    expect(fitsBox(sum(AGING_PARTY_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the allowance for doubtful accounts in its card with Bucket at its floor", () => {
    expect(fitsBox(sum(AFDA_FIXED_WIDTHS), COLUMN.TEXT_MIN, inSmallCard)).toBe(true);
  });
});
