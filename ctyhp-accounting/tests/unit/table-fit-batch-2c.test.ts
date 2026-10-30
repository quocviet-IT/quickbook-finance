import { describe, expect, it } from "vitest";
import { COLUMN, EXPAND_COLUMN_WIDTH, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  AUDIT_ELASTIC_FLOORS,
  AUDIT_FIELD_CHANGES_FIXED_WIDTHS,
  AUDIT_FIXED_WIDTHS,
} from "@/app/(app)/settings/audit/AuditClient";
import {
  COMPANIES_FIXED_WIDTHS,
  COMPANY_REQUESTS_ELASTIC_FLOORS,
  COMPANY_REQUESTS_FIXED_WIDTHS,
} from "@/app/(app)/settings/companies/CompaniesClient";
import { COMPANY_VERSIONS_FIXED_WIDTHS } from "@/app/(app)/settings/company/CompanySettingsClient";
import { ACCOUNT_TYPE_REVIEW_FIXED_WIDTHS } from "@/app/(app)/settings/import/AccountTypeReview";
import {
  IMPORT_COLUMNS_ELASTIC_FLOORS,
  IMPORT_COLUMNS_FIXED_WIDTHS,
} from "@/app/(app)/settings/import/ImportColumnsTable";
import { UNBANKED_FIXED_WIDTHS } from "@/app/(app)/settings/import/ImportPreflightPanel";
import { IMPORT_PREVIEW_FIXED_WIDTHS } from "@/app/(app)/settings/import/ImportPreviewPanel";
import {
  LEDGER_BATCHES_ELASTIC_FLOORS,
  LEDGER_BATCHES_FIXED_WIDTHS,
} from "@/app/(app)/settings/import/LedgerBatchList";
import { LEDGER_SECTIONS_FIXED_WIDTHS } from "@/app/(app)/settings/import/LedgerImportPanel";
import { UNRESOLVED_ACCOUNTS_FIXED_WIDTHS } from "@/app/(app)/settings/import/UnresolvedAccountsTable";
import { PERIODS_FIXED_WIDTHS } from "@/app/(app)/settings/periods/PeriodsClient";
import { PERMISSION_MATRIX_FIXED_WIDTHS } from "@/app/(app)/settings/permissions/PermissionMatrixClient";
import {
  DOCUMENT_AUDIT_FIELD_CHANGES_FIXED_WIDTHS,
  DOCUMENT_AUDIT_TRAIL_BOX,
  DOCUMENT_AUDIT_TRAIL_ELASTIC_FLOORS,
  DOCUMENT_AUDIT_TRAIL_FIXED_WIDTHS,
} from "@/components/audit/DocumentAuditTrail";

/**
 * The settings screens off Ant Design's own Table (batch 2c): audit, companies,
 * company settings, the import tools, periods and the permission grid. Each is
 * a fitted DataTable now, so each row has to fit its box with its elastic
 * columns at their floors.
 */
const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);
/** A page table inside a default Card: 24px of padding and a 1px border each side. */
const INSIDE_A_CARD = TABLE_BOX_AT_1280 - 50;
/** What an opened row leaves for the table nested under it. */
const underTheEntry = (box: number) => box - EXPAND_COLUMN_WIDTH;

describe("the settings screens' fitted tables (batch 2c)", () => {
  it("fits the audit search at 1280 with Actor, Record and Changed at their floors", () => {
    expect(fitsBox(sum(AUDIT_FIXED_WIDTHS) + EXPAND_COLUMN_WIDTH, sum(AUDIT_ELASTIC_FLOORS))).toBe(true);
  });

  it("fits an audit entry's changed fields under the entry", () => {
    expect(
      fitsBox(sum(AUDIT_FIELD_CHANGES_FIXED_WIDTHS), COLUMN.TEXT_MIN * 2, underTheEntry(TABLE_BOX_AT_1280)),
    ).toBe(true);
  });

  it("fits a document's change history in the narrowest drawer it opens in", () => {
    expect(
      fitsBox(
        sum(DOCUMENT_AUDIT_TRAIL_FIXED_WIDTHS) + EXPAND_COLUMN_WIDTH,
        sum(DOCUMENT_AUDIT_TRAIL_ELASTIC_FLOORS),
        DOCUMENT_AUDIT_TRAIL_BOX,
      ),
    ).toBe(true);
  });

  it("fits a document's changed fields under an entry in that drawer", () => {
    expect(
      fitsBox(
        sum(DOCUMENT_AUDIT_FIELD_CHANGES_FIXED_WIDTHS),
        COLUMN.TEXT_MIN * 2,
        underTheEntry(DOCUMENT_AUDIT_TRAIL_BOX),
      ),
    ).toBe(true);
  });

  it("fits the company requests with Company and Detail at their floors", () => {
    expect(fitsBox(sum(COMPANY_REQUESTS_FIXED_WIDTHS), sum(COMPANY_REQUESTS_ELASTIC_FLOORS))).toBe(true);
  });

  it("fits the company list with Legal name at its floor", () => {
    expect(fitsBox(sum(COMPANIES_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the company settings' version history inside its card", () => {
    expect(fitsBox(sum(COMPANY_VERSIONS_FIXED_WIDTHS), COLUMN.TEXT_MIN, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the periods with Period at its floor", () => {
    expect(fitsBox(sum(PERIODS_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the permission grid at 1280 with its Control column showing", () => {
    expect(fitsBox(sum(PERMISSION_MATRIX_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
  });

  it("fits the account type review inside its card", () => {
    expect(fitsBox(sum(ACCOUNT_TYPE_REVIEW_FIXED_WIDTHS), COLUMN.TEXT_MIN, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the import's column mapping with both elastic columns at their floors", () => {
    expect(fitsBox(sum(IMPORT_COLUMNS_FIXED_WIDTHS), sum(IMPORT_COLUMNS_ELASTIC_FLOORS), INSIDE_A_CARD)).toBe(true);
  });

  it("fits the unresolved names inside the preflight card", () => {
    expect(fitsBox(sum(UNRESOLVED_ACCOUNTS_FIXED_WIDTHS), COLUMN.TEXT_MIN, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the accounts without a bank record inside the preflight card", () => {
    expect(fitsBox(sum(UNBANKED_FIXED_WIDTHS), COLUMN.TEXT_MIN, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the import preview with Name and Matched on at their floors", () => {
    expect(fitsBox(sum(IMPORT_PREVIEW_FIXED_WIDTHS), COLUMN.TEXT_MIN * 2, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the ledger sections inside their card", () => {
    expect(fitsBox(sum(LEDGER_SECTIONS_FIXED_WIDTHS), COLUMN.TEXT_MIN, INSIDE_A_CARD)).toBe(true);
  });

  it("fits the imported batches with File and Imported by at their floors", () => {
    expect(fitsBox(sum(LEDGER_BATCHES_FIXED_WIDTHS), sum(LEDGER_BATCHES_ELASTIC_FLOORS), INSIDE_A_CARD)).toBe(true);
  });
});
