import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getCurrentCompanySettings } from "@/lib/services/company";
import {
  listAssetDepreciationDetail,
  listFixedAssets,
} from "@/lib/services/fixed-assets";
import { listCurrencies } from "@/lib/services/reference";
import FixedAssetReportClient from "./FixedAssetReportClient";

export const dynamic = "force-dynamic";

export default async function FixedAssetReportPage() {
  const sb = await createSupabaseServerClient();
  const [assets, depreciation, currencies, company] = await Promise.all([
    listFixedAssets(sb),
    listAssetDepreciationDetail(sb),
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);
  const currency = currencies.find((row) => row.is_base) ?? currencies[0];

  return (
    <div>
      <PageHeader
        title="Fixed Asset Register & Depreciation"
        description="Reconcile asset cost, accumulated depreciation, net book value, monthly schedules, and disposals."
        breadcrumbItems={[
          { title: "Reports", href: "/reports" },
          { title: "Fixed Assets" },
        ]}
      />
      <FixedAssetReportClient
        assets={assets}
        depreciation={depreciation}
        companyName={company?.legal_name ?? company?.dba_name ?? "CTYHP Accounting"}
        currencyCode={currency?.code ?? "USD"}
        currencyDecimals={currency?.decimal_places ?? 2}
      />
    </div>
  );
}
