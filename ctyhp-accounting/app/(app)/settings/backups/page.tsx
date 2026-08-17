import PageHeader from "@/components/PageHeader";
import { requireSettingsAccess, currentAccess } from "@/lib/db/settings-access";
import { listBackupsAction } from "./actions";
import BackupsClient from "./BackupsClient";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  await requireSettingsAccess("/settings/backups");
  const [result, access] = await Promise.all([listBackupsAction(), currentAccess()]);
  return (
    <div>
      <PageHeader
        title="Backups"
        description="A snapshot of this company's books, taken on a schedule. Download one, or restore it into a new company to compare the two side by side."
      />
      <BackupsClient
        backups={result.ok ? (result.data ?? []) : []}
        loadError={result.ok ? null : (result.error ?? "Could not read the backups")}
        canRestore={(access.permissionKeys ?? []).includes("company.restore")}
      />
    </div>
  );
}
