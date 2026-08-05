import { createSupabaseServerClient } from "@/lib/db/server";
import { listPayments, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import { hasPermission, listActors } from "@/lib/services/access";
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";
import PageHeader from "@/components/PageHeader";
import PaymentsClient from "./PaymentsClient";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const sb = await createSupabaseServerClient();
  const [
    payments,
    customers,
    accounts,
    currencies,
    role,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
    canReadAudit,
    actors,
  ] = await Promise.all([
    listPayments(sb),
    listCustomers(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
    hasPermission(sb, "audit.read"),
    listActors(sb),
  ]);

  const depositAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_code === "1210") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Payments" description="Record customer payments and apply them to open invoices." />
      <PaymentsClient
        initialCreateOpen={initialCreateOpen}
        payments={payments}
        customers={customers}
        depositAccounts={depositAccounts}
        currencies={currencies}
        actors={actors}
        canWrite={canWrite(role)}
        canReadAudit={canReadAudit}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
        scannerConfigured={isDocumentScannerConfigured()}
      />
    </div>
  );
}
