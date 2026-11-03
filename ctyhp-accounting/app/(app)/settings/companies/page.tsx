import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { isPlatformAdmin, resolveActiveCompany } from "@/lib/db/company";
import { readCompanySetupFacts, readCompanySummary } from "@/lib/services/company-setup";
import { companySetupSteps, setupProgress } from "@/lib/domain/company-setup";
import PageHeader from "@/components/PageHeader";
import CompaniesClient, { type CompanyBooks, type CompanyRow } from "./CompaniesClient";
import type { CompanyRequestView } from "./actions";
import { requireSettingsAccess } from "@/lib/db/settings-access";

export const dynamic = "force-dynamic";
// `after` keeps provisioning running past the response this page's action
// returns, so the invocation needs room for it.
export const maxDuration = 300;

/**
 * How big each company's books are, and how far they are set up (3.00), for
 * every company this person may open. Each is read through a client bound to
 * that company, so Row Level Security answers exactly as it would inside it;
 * a company they cannot open is not read at all. One that fails to read shows
 * nothing rather than taking the list down with it.
 */
async function readBooks(): Promise<Record<string, CompanyBooks>> {
  const { options } = await resolveActiveCompany();
  const entries = await Promise.all(
    options.map(async (company) => {
      try {
        const sb = await createSupabaseServerClientForSchema(company.schemaName);
        const [summary, facts] = await Promise.all([readCompanySummary(sb), readCompanySetupFacts(sb)]);
        return [company.schemaName, { ...summary, setup: setupProgress(companySetupSteps(facts)) }] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  await requireSettingsAccess("/settings/companies");
  const initialCreateOpen = (await searchParams).new === "1";
  const control = await createSupabaseServerClientForSchema("onebook");
  const [canCreate, books, companies, requests] = await Promise.all([
    isPlatformAdmin(),
    readBooks(),
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
        books={books}
      />
    </div>
  );
}
