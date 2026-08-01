import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import GlPostingClient from "./GlPostingClient";

export const dynamic = "force-dynamic";

export default async function GlPostingPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, company] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title="General Ledger Posting"
        description="Every document beside the journal entry it produced, and every control account against the subledger behind it."
      />
      <GlPostingClient
        companyName={company?.legal_name ?? "Company name not set"}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
