import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { isPlatformAdmin } from "@/lib/db/company";
import PageHeader from "@/components/PageHeader";
import CompaniesClient, { type CompanyRow } from "./CompaniesClient";
import type { CompanyRequestView } from "./actions";

export const dynamic = "force-dynamic";
// `after` keeps provisioning running past the response this page's action
// returns, so the invocation needs room for it.
export const maxDuration = 300;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const control = await createSupabaseServerClientForSchema("onebook");
  const [canCreate, companies, requests] = await Promise.all([
    isPlatformAdmin(),
    control
      .from("company")
      .select("id,slug,schema_name,legal_name,is_sample,status,display_order")
      .order("display_order")
      .order("legal_name"),
    control
      .from("company_request")
      .select("id,slug,legal_name,status,attempts,error,created_at,finished_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every set of books this system holds, and how to start another one."
      />
      <CompaniesClient
        initialCreateOpen={initialCreateOpen}
        canCreate={canCreate}
        companies={(companies.data ?? []) as unknown as CompanyRow[]}
        requests={(requests.data ?? []) as unknown as CompanyRequestView[]}
      />
    </div>
  );
}
