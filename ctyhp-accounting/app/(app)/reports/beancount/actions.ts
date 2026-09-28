"use server";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/db/server";
import { beancountFileName, buildBeancountFile, buildBeancountLines, type BeancountTextLine } from "@/lib/domain/beancount";
import { BEANCOUNT_SOURCES, readBeancountInput } from "@/lib/services/beancount";
import { readSchemaVersion } from "@/lib/services/company-export";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface BeancountExportResult {
  fileName: string;
  text: string;
  entryCount: number;
}

export interface BeancountPreviewResult {
  fileName: string;
  lines: BeancountTextLine[];
}

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Signed in and allowed to export company data, or the reason not. */
async function exportAllowed(sb: Session): Promise<string | null> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return "Your session has expired. Sign in again.";
  const { data: allowed, error } = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  if (error || allowed !== true) return "Seeing or saving the ledger file needs the Export company data permission.";
  return null;
}

/**
 * The file, line by line, for the page to show.
 *
 * Showing the ledger is not handing it over, so this writes no audit row — the
 * same entries are on the Journal screen. Copy and Save file are the hand-over,
 * and they go through `beancountExportAction`, which records each one. The
 * permission is the export's own all the same: this is the file.
 */
export async function beancountPreviewAction(): Promise<ActionResult<BeancountPreviewResult>> {
  const sb = await createSupabaseServerClient();
  const refused = await exportAllowed(sb);
  if (refused) return { ok: false, error: refused };
  try {
    const input = await readBeancountInput(sb, new Date().toISOString());
    return { ok: true, data: { fileName: beancountFileName(input.company.legalName), lines: buildBeancountLines(input) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}

/**
 * The whole ledger as a Beancount file.
 *
 * Follows the company ZIP export (`app/(app)/settings/company/actions.ts`): the
 * same permission, the same audit record, and the same rule that an export the
 * audit log did not record is not handed over (US-FR-013). The audit row is the
 * only write; nothing here touches the books.
 */
export async function beancountExportAction(): Promise<ActionResult<BeancountExportResult>> {
  const sb = await createSupabaseServerClient();
  const refused = await exportAllowed(sb);
  if (refused) return { ok: false, error: refused };

  try {
    const generatedAt = new Date().toISOString();
    const [input, schemaVersion] = await Promise.all([readBeancountInput(sb, generatedAt), readSchemaVersion(sb)]);
    const text = buildBeancountFile(input);
    const lineCount = input.entries.reduce((n, e) => n + e.lines.length, 0);

    // The audit RPC takes a fixed set of keys; each is filled truthfully. It has
    // no field for the format, so this row looks like a ZIP export's and is told
    // apart by the hash — a limitation the design records and accepts.
    const { error: auditError } = await sb.rpc("acc_log_company_export", {
      p_summary: {
        generated_at: generatedAt,
        schema_version: schemaVersion,
        manifest_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
        table_count: BEANCOUNT_SOURCES.length,
        total_rows: input.entries.length + lineCount,
        included_sensitive: false,
      },
    });
    if (auditError) return { ok: false, error: `The export was not recorded: ${auditError.message}` };

    return {
      ok: true,
      data: { fileName: beancountFileName(input.company.legalName), text, entryCount: input.entries.length },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
