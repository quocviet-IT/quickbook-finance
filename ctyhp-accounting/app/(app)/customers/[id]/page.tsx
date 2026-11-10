import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getCustomerDetail } from "@/lib/services/customer-detail";
import { listCurrencies, listUsStates } from "@/lib/services/reference";
import { hasPermission, listActors } from "@/lib/services/access";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { getUserRole, canWrite } from "@/lib/auth";
import { customerIdSchema } from "@/lib/domain/schemas";
import PageHeader from "@/components/PageHeader";
import CustomerDetailClient from "./CustomerDetailClient";

export const dynamic = "force-dynamic";

/**
 * One customer's page (3.0.12): what they owe first, then everything else
 * about them. The transactions and the change history are read by the tabs
 * that show them, when those are opened.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // An id that is not one names no customer; asking the database would only
  // turn a wrong link into an error page.
  if (!customerIdSchema.safeParse(id).success) notFound();
  const sb = await createSupabaseServerClient();
  const [detail, role, currencies, usStates, actors, canReadAudit, settings] = await Promise.all([
    getCustomerDetail(sb, id),
    getUserRole(),
    listCurrencies(sb),
    listUsStates(sb),
    listActors(sb),
    hasPermission(sb, "audit.read"),
    getCurrentCompanySettings(sb),
  ]);
  if (!detail) notFound();
  const { customer } = detail;

  return (
    <div>
      <PageHeader
        title={customer.name}
        breadcrumbItems={[{ title: "Customers", href: "/customers" }, { title: customer.name }]}
      />
      <CustomerDetailClient
        // Another customer is another page: nothing read for this one carries over.
        key={customer.id}
        customer={customer}
        credit={detail.credit}
        openInvoices={detail.openInvoices}
        defaultTermsDays={settings?.default_payment_terms_days ?? 30}
        currencies={currencies}
        usStates={usStates}
        actors={actors}
        canWrite={canWrite(role)}
        canReadAudit={canReadAudit}
      />
    </div>
  );
}
