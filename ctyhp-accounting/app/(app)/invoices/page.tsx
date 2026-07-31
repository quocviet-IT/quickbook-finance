import { createSupabaseServerClient } from "@/lib/db/server";
import { listInvoices, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies, listTaxCodes, listUsStates } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { getUserRole, canWrite } from "@/lib/auth";
import { hasPermission, listActors } from "@/lib/services/access";
import { listGapNotes, listSequenceCatalog, listSequenceDocuments } from "@/lib/services/sequence";
import { auditSequence, describeSequenceIntegrity } from "@/lib/domain/sequence";
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";
import PageHeader from "@/components/PageHeader";
import InvoicesClient from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    queue?: string;
    asOf?: string;
    focus?: string;
  }>;
}) {
  const params = await searchParams;
  const initialCreateOpen = params.new === "1";
  const initialQueue =
    params.queue === "overdue" && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "")
      ? { asOf: params.asOf!, focusId: params.focus ?? null }
      : null;
  const sb = await createSupabaseServerClient();
  const [
    invoices,
    customers,
    accounts,
    currencies,
    taxCodes,
    items,
    role,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
    canReadAudit,
    actors,
    sequenceCatalog,
    sequenceDocuments,
    sequenceNotes,
    usStates,
  ] = await Promise.all([
    listInvoices(sb),
    listCustomers(sb),
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    listItems(sb),
    getUserRole(),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
    hasPermission(sb, "audit.read"),
    listActors(sb),
    listSequenceCatalog(sb),
    listSequenceDocuments(sb, "invoice"),
    listGapNotes(sb, "invoice"),
    listUsStates(sb),
  ]);

  // A number the sequence issued that no invoice holds is the sign of a removed
  // sale, so the warning belongs where invoices are worked on — not only in the
  // report somebody has to remember to open.
  const invoiceSequence = sequenceCatalog.find((row) => row.sequence_key === "invoice");
  const sequenceWarning = invoiceSequence
    ? describeSequenceIntegrity(
        auditSequence({
          definition: invoiceSequence,
          documents: sequenceDocuments,
          notes: sequenceNotes,
        }),
      )
    : null;

  const incomeAccounts = accounts.filter(
    (a) =>
      (a.account_type === "income" || a.account_type === "other_income") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  const salesItems = items.filter((i) => i.is_sold && i.is_active);

  return (
    <div>
      <PageHeader title="Invoices" description="Create invoices, issue them to the ledger, and track balances due." />
      <InvoicesClient
        initialCreateOpen={initialCreateOpen}
        initialQueue={initialQueue}
        invoices={invoices}
        customers={customers}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        taxCodes={taxCodes}
        currencies={currencies}
        items={salesItems}
        canWrite={canWrite(role)}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
        canReadAudit={canReadAudit}
        actors={actors}
        usStates={usStates}
        sequenceWarning={sequenceWarning}
        scannerConfigured={isDocumentScannerConfigured()}
      />
    </div>
  );
}
