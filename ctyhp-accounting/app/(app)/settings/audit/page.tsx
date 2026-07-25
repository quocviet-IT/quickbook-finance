import PageHeader from "@/components/PageHeader";
import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";

/**
 * The tables worth filtering by — the ones the application writes audit rows for.
 * Kept as a list rather than a query so the filter stays useful even before any
 * row exists for a given table.
 */
const AUDITED_TABLES = [
  "acc_account",
  "acc_app_user",
  "acc_approval_policy",
  "acc_approval_request",
  "acc_accounting_period",
  "acc_bill",
  "acc_company_setting_version",
  "acc_credit_memo",
  "acc_customer",
  "acc_goods_receipt",
  "acc_inventory_txn",
  "acc_invoice",
  "acc_item",
  "acc_journal_entry",
  "acc_purchase_order",
  "acc_purchasing_config",
  "acc_role_permission",
  "acc_statement_reconciliation",
  "acc_tax_code",
  "acc_vendor",
  "acc_vendor_credit",
  "acc_write_off",
];

export default async function AuditPage() {
  return (
    <div>
      <PageHeader
        title="Audit History"
        description="Who changed what, when, and what it looked like before and after."
      />
      <AuditClient tables={AUDITED_TABLES} />
    </div>
  );
}
