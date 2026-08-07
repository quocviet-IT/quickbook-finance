"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { companySettingsSchema } from "@/lib/domain/schemas";
import {
  saveCompanySettings,
  syncCompanyRegisterName,
  listCompanySettingVersions,
  CompanyError,
} from "@/lib/services/company";
import { activeSchema } from "@/lib/db/company";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import type { CompanySettingRow } from "@/lib/db/types";
import { strToU8, zipSync } from "fflate";
import {
  archivePathFor,
  buildManifest,
  exportFileName,
  sha256Hex,
  toCsv,
} from "@/lib/domain/company-export";
import {
  collectExportDatasets,
  readControlTotals,
  readSchemaVersion,
} from "@/lib/services/company-export";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
function msg(e: unknown): string { return e instanceof CompanyError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function saveCompanySettingsAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; registerProblem?: string }>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can change company settings" };
  const parsed = companySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await saveCompanySettings(sb, parsed.data);

    // The switcher and the Companies list read the register, not these
    // settings, so a name corrected here has to be carried across or the two
    // disagree on screen. The register admits no application session, hence the
    // service-role client; the admin check above is what authorises it.
    let registerProblem: string | undefined;
    try {
      await syncCompanyRegisterName(
        createSupabaseAutomationClient("onebook"),
        await activeSchema(),
        parsed.data.legal_name,
        parsed.data.dba_name || null,
      );
    } catch (e) {
      registerProblem = msg(e);
    }

    // The company name is in the shell on every page, so the whole layout is
    // stale until it is rebuilt — not just this screen.
    revalidatePath("/", "layout");
    revalidatePath("/settings/company");
    return { ok: true, data: { id, registerProblem } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
export async function listCompanySettingVersionsAction(): Promise<ActionResult<CompanySettingRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listCompanySettingVersions(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export interface CompanyExportResult {
  fileName: string;
  zipBase64: string;
  manifestSha256: string;
  totalRows: number;
}

export async function exportCompanyDataAction(): Promise<ActionResult<CompanyExportResult>> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };

  const { data: allowed, error: permissionError } = await sb.rpc("acc_has_permission", {
    p_key: "company.export",
  });
  if (permissionError || allowed !== true) {
    return { ok: false, error: "You do not have permission to export company data" };
  }

  try {
    const generatedAt = new Date().toISOString();
    const asOf = generatedAt.slice(0, 10);
    const [datasets, totals, schemaVersion, versions] = await Promise.all([
      collectExportDatasets(sb),
      readControlTotals(sb, asOf),
      readSchemaVersion(sb),
      listCompanySettingVersions(sb),
    ]);
    const legalName = versions[0]?.legal_name ?? "company";

    const entries: Record<string, Uint8Array> = {};
    const files: Array<{ path: string; sha256: string; rowCount: number }> = [];
    let totalRows = 0;

    for (const dataset of datasets) {
      const path = archivePathFor(dataset.table);
      const csv = toCsv(dataset.rows, dataset.columns);
      entries[path] = strToU8(csv);
      files.push({ path, sha256: await sha256Hex(csv), rowCount: dataset.rows.length });
      totalRows += dataset.rows.length;
    }

    const manifest = buildManifest({
      datasets,
      files,
      totals,
      controlTotalsAsOf: asOf,
      schemaVersion,
      generatedAt,
      actorEmail: user.email ?? "unknown",
    });
    const manifestSha256 = await sha256Hex(manifest);
    entries["manifest.json"] = strToU8(manifest);
    entries["README.txt"] = strToU8(
      [
        "One Book — company data export",
        "",
        `Generated ${generatedAt} under schema ${schemaVersion}.`,
        "",
        "data/        one CSV per table, header row = column names",
        "sensitive/   vendor tax profiles, including taxpayer identification numbers",
        "attachments.csv  the attachment inventory — file bytes are NOT included;",
        "             each row carries the storage path, size, sha256 and scan status",
        "             so a restore of object storage can be verified against it",
        "manifest.json carries row counts, per-file sha256 and the control totals",
        "             a restored database must reproduce.",
        "",
        "Restore procedure: docs/operations/backup-and-restore.md",
      ].join("\n"),
    );

    const zip = zipSync(entries, { level: 6 });

    const { error: auditError } = await sb.rpc("acc_log_company_export", {
      p_summary: {
        generated_at: generatedAt,
        schema_version: schemaVersion,
        manifest_sha256: manifestSha256,
        table_count: datasets.length,
        total_rows: totalRows,
        included_sensitive: datasets.some((dataset) => dataset.sensitive),
      },
    });
    // An unrecorded export of taxpayer data is exactly what US-FR-013 forbids,
    // so the archive is withheld when the audit write fails.
    if (auditError) {
      return { ok: false, error: `The export was not recorded: ${auditError.message}` };
    }

    return {
      ok: true,
      data: {
        fileName: exportFileName(legalName, generatedAt),
        zipBase64: Buffer.from(zip).toString("base64"),
        manifestSha256,
        totalRows,
      },
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
