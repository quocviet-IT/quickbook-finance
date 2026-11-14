import { createSupabaseServerClient } from "@/lib/db/server";
import { listPayments, listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { hasPermission, listActors } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
import PaymentsClient from "./PaymentsClient";
import { postingDefaultsOrNone } from "@/lib/services/posting-defaults";
import { defaultIn } from "@/lib/domain/posting-defaults";
import { pageMetadata } from "@/lib/domain/page-title";

export const metadata = pageMetadata("/payments");

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; customer?: string }>;
}) {
  const params = await searchParams;
  const initialCreateOpen = params.new === "1";
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
    postingDefaults,
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
    postingDefaultsOrNone(sb),
  ]);

  // `?customer=<id>`, from a customer's page. Any existing customer can pay,
  // inactive or not; an unknown id is ignored.
  const prefillCustomer =
    params.customer && customers.some((c) => c.id === params.customer) ? params.customer : null;

  const depositAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_code === "1210") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Payments" description="Record customer payments and apply them to open invoices." />
      <PaymentsClient
        initialCreateOpen={initialCreateOpen}
        initialCustomerId={prefillCustomer}
        payments={payments}
        customers={customers}
        depositAccounts={depositAccounts}
        defaultDepositAccountId={defaultIn(postingDefaults.depositAccountId, depositAccounts) ?? null}
        currencies={currencies}
        actors={actors}
        canWrite={canWrite(role)}
        canDelete={isAdmin(role)}
        canReadAudit={canReadAudit}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
      />
    </div>
  );
}
