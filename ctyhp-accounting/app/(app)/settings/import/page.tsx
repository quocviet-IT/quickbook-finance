import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, { active }] = await Promise.all([listCurrencies(sb), resolveActiveCompany()]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="Import from QuickBooks or Wave"
        description="Bring a company's chart of accounts, contacts, products and opening balances across. Nothing is written until you have seen what will happen."
      />
      <ImportClient
        companyName={active?.legalName ?? "this company"}
        isSampleCompany={active?.isSample ?? false}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
