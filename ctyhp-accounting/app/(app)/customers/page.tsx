import { createSupabaseServerClient } from "@/lib/db/server";
import { listCustomers } from "@/lib/services/invoicing";
import { listCustomerCredit } from "@/lib/services/credit";
import { listUsStates } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const sb = await createSupabaseServerClient();
  const [customers, credit, usStates, role] = await Promise.all([
    listCustomers(sb),
    listCustomerCredit(sb),
    listUsStates(sb),
    getUserRole(),
  ]);

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customers you invoice and receive payments from, with the credit each one is allowed and what they owe today."
      />
      <CustomersClient
        customers={customers}
        credit={credit}
        usStates={usStates}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
