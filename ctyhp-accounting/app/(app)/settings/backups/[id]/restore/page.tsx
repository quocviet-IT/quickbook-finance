import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { requireSettingsPermission } from "@/lib/db/settings-access";
import RestoreClient, { type RestoreSnapshot } from "./RestoreClient";

export const dynamic = "force-dynamic";
// Provisioning alone builds 75 tables in ~20 seconds, and the load and the
// control-total check follow it — the same ceiling the other long-running
// routes (the nightly backup run) already ask for.
export const maxDuration = 300;

export default async function RestoreBackupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // The guard runs before params is even read: a refusal must not depend on
  // anything about the request. The denied marker names the parent screen —
  // that is the card the person can actually be sent back to. Two gates, not
  // one, because this screen genuinely needs both: company.restore for the
  // act itself, and company.export because that is what acc_backup's RLS
  // policy (migration 0114) admits for reading the register — without it the
  // read below comes back empty and the page would claim the snapshot does
  // not exist, the wrong explanation for a permission refusal.
  await requireSettingsPermission(["company.restore"], "/settings/backups");
  await requireSettingsPermission(["company.export"], "/settings/backups");
  const { id } = await params;

  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_at,status,size_bytes,schema_version,content_hash,control_totals")
    .eq("id", id)
    .maybeSingle();

  const snapshot: RestoreSnapshot | null = data
    ? {
        id: data.id as string,
        takenAt: data.taken_at as string,
        status: data.status as string,
        // bigint arrives from PostgREST as a string, same as the backups list.
        sizeBytes: data.size_bytes === null ? null : Number(data.size_bytes as string | number),
        schemaVersion: data.schema_version as string,
        contentHash: data.content_hash as string,
        journalLineCount:
          (data.control_totals as { journalLineCount?: number } | null)?.journalLineCount ?? null,
      }
    : null;

  return (
    <div>
      <PageHeader
        title="Restore as new company"
        description="Load this snapshot into a brand-new company beside the running books, then check the restored figures against the snapshot's own."
      />
      <RestoreClient
        snapshot={snapshot}
        loadError={error ? error.message : snapshot ? null : "That snapshot does not exist in this company's register."}
      />
    </div>
  );
}
