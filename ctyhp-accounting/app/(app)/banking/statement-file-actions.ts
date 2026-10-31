"use server";
/**
 * The statement file kept as evidence (1.83): preparing its upload, recording
 * it, and attaching it later to a reconciliation that has none. Viewing and
 * downloading go through Reports › Saved's own actions — a kept statement file
 * is a saved report of source "Bank".
 */
import { revalidatePath } from "next/cache";
import { getUserRole, canWrite, holdsPermission } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import {
  STATEMENT_FILE_MIME_TYPES,
  attachMismatch,
  statementFileAttachSchema,
  statementFileKeepSchema,
  type StatementFileMime,
} from "@/lib/domain/statement-evidence";
import { PROOF_REFUSAL, PROOF_TEXT, proofRefusal, proveStatementPayload, sentWithoutProof } from "@/lib/domain/statement-proof";
import { formatMoney } from "@/lib/format";
import { getReconciliationDetail, getReconciliationStatement } from "@/lib/services/bankrec";
import { createSavedReportUploadTicket } from "@/lib/services/saved-reports";
import {
  findKeptStatementFile,
  keepStatementFile,
  linkReconciliationStatementFile,
  removeUnkeptUpload,
} from "@/lib/services/statement-files";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string {
  return e instanceof Error ? e.message : "An unexpected error occurred";
}

export type PreparedStatementFile =
  | { keptId: string }
  | { ticket: { path: string; token: string; bucket: string } };

/**
 * The file already kept, when one with this SHA-256 is — nothing to upload —
 * or a one-time ticket to upload it to this company's own folder.
 *
 * The ticket is minted with the service role, so it asks for the permission
 * keeping the file needs (documents.manage, checked again by
 * acc_keep_statement_file): someone who could never keep a file must not be
 * able to fill the folder with uploads nothing will ever name.
 */
export async function prepareStatementFileAction(
  sha256: string,
  mimeType: string,
): Promise<ActionResult<PreparedStatementFile>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!(await holdsPermission("documents.manage"))) {
    return { ok: false, error: "Keeping the statement file needs Manage supporting documents" };
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "Expected a sha256 digest" };
  if (!(STATEMENT_FILE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { ok: false, error: "OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files" };
  }
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const sb = await createSupabaseServerClient();
    const keptId = await findKeptStatementFile(sb, sha256);
    if (keptId) return { ok: true, data: { keptId } };
    const ticket = await createSavedReportUploadTicket(company.active.schemaName, mimeType as StatementFileMime);
    return { ok: true, data: { ticket: { ...ticket, bucket: SAVED_REPORT_BUCKET } } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Records the uploaded file. When the same file was kept a moment ago by
 * someone else, that one is used and this upload removed; when recording
 * fails, the upload is removed too.
 */
export async function keepStatementFileAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = statementFileKeepSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  const sb = await createSupabaseServerClient();
  const cleanUp = () =>
    removeUnkeptUpload(sb, company.active!.schemaName, parsed.data.storage_path).catch((err) =>
      console.warn("removing an unkept statement upload failed:", msg(err)),
    );
  try {
    const kept = await keepStatementFile(sb, parsed.data);
    if (kept.reused) await cleanUp();
    revalidatePath("/reports/saved");
    return { ok: true, data: { id: kept.id } };
  } catch (e) {
    await cleanUp();
    return { ok: false, error: msg(e) };
  }
}

/**
 * Attach the statement: the file chosen is attached only when what was read
 * from it is this reconciliation's statement — checked here against the
 * reconciliation's own figures and kept lines, as the browser checked it — and,
 * since 2.04, only when it adds up: its opening plus the lines that count is its
 * closing. Nothing is imported, so there is nothing to import anyway: a file
 * that does not add up is never attached, override or not.
 */
export async function attachStatementFileAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (sentWithoutProof(raw)) return { ok: false, error: PROOF_REFUSAL.noProof };
  const parsed = statementFileAttachSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
  const aside = new Set(input.aside);
  const counted = input.lines.filter((_, index) => !aside.has(index));
  const refusal = proofRefusal(proveStatementPayload(counted, input.proof, money), null, PROOF_TEXT.attachBlocked);
  if (refusal) return { ok: false, error: refusal };
  try {
    const sb = await createSupabaseServerClient();
    const [statement, detail] = await Promise.all([
      getReconciliationStatement(sb, input.reconciliation_id),
      getReconciliationDetail(sb, input.reconciliation_id),
    ]);
    if (statement.statementFileId) return { ok: false, error: "This reconciliation already has its statement file" };
    const mismatch = attachMismatch(
      { to: input.to, closingMinor: input.closing_minor, lines: input.lines },
      input.aside,
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor, setAside: l.setAside })),
      },
      money,
    );
    if (mismatch) return { ok: false, error: mismatch };
    await linkReconciliationStatementFile(sb, input.reconciliation_id, input.file_id);
    revalidatePath(`/banking/reconcile/${input.reconciliation_id}`);
    revalidatePath(`/banking/reconcile/${input.reconciliation_id}/report`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
