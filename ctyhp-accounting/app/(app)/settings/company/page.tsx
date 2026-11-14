import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { holdsPermission } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readCompanySetupFacts } from "@/lib/services/company-setup";
import { companySetupSteps } from "@/lib/domain/company-setup";
import { listAccounts } from "@/lib/services/accounts";
import { postingDefaultsOrNone } from "@/lib/services/posting-defaults";
import PageHeader from "@/components/PageHeader";
import CompanySettingsClient from "./CompanySettingsClient";
import { pageMetadata } from "@/lib/domain/page-title";

export const metadata = pageMetadata("/settings/company");

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  await requireSettingsAccess("/settings/company");
  const sb = await createSupabaseServerClient();
  const [canEdit, current, setupFacts, accounts, postingDefaults] = await Promise.all([
    holdsPermission("settings.manage"),
    getCurrentCompanySettings(sb),
    // The checklist is help, not the page: if it cannot be read, the settings still
    // open. Read on every render, the one after a save included, so a step ticks
    // itself off the moment its work is saved.
    readCompanySetupFacts(sb).catch(() => null),
    listAccounts(sb),
    postingDefaultsOrNone(sb),
  ]);
  return (
    <div>
      <PageHeader
        title="Company Settings"
        description="Legal profile, fiscal year, and accounting basis. Changes are versioned. This workspace holds one company's books — a second company needs its own workspace, so its statements can never mix with these."
      />
      <CompanySettingsClient
        canEdit={canEdit}
        current={current}
        setupSteps={setupFacts ? companySetupSteps(setupFacts) : null}
        accounts={accounts}
        postingDefaults={postingDefaults}
      />
    </div>
  );
}
