import { createSupabaseServerClient } from "@/lib/db/server";
import { listCustomers } from "@/lib/services/invoicing";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import CustomersClient from "./CustomersClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const sb = await createSupabaseServerClient();
  const [customers, role] = await Promise.all([listCustomers(sb), getUserRole()]);

  return (
    <div>
      <PageHeader title="Customers" description="Customers you invoice and receive payments from." />
      <CustomersClient customers={customers} canWrite={canWrite(role)} />
    </div>
  );
}
