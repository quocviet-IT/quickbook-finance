"use server";
import { revalidatePath } from "next/cache";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import {
  savedReportArchiveSchema,
  savedReportRegisterSchema,
  SAVED_REPORT_BUCKET,
  type SavedReportRegisterInput,
} from "@/lib/domain/saved-reports";
import {
  archiveSavedReport,
  createSavedReportDownloadUrl,
  createSavedReportUploadTicket,
  readSavedReportText,
  registerSavedReport,
  SavedReportError,
} from "@/lib/services/saved-reports";

export interface SavedReportActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guardManage(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to save a report";
}

function msg(error: unknown): string {
  if (error instanceof SavedReportError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

export async function createSavedReportUploadTicketAction(
  mimeType: string,
): Promise<SavedReportActionResult<{ path: string; token: string; bucket: string }>> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const ticket = await createSavedReportUploadTicket(company.active.id, mimeType);
    return { ok: true, data: { ...ticket, bucket: SAVED_REPORT_BUCKET } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function registerSavedReportAction(
  input: SavedReportRegisterInput,
): Promise<SavedReportActionResult<{ id: string }>> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const parsed = savedReportRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report cannot be saved" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const id = await registerSavedReport(sb, parsed.data);
    revalidatePath("/reports/saved");
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function archiveSavedReportAction(
  id: string,
  reason: string,
): Promise<SavedReportActionResult> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const parsed = savedReportArchiveSchema.safeParse({ id, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report cannot be archived" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await archiveSavedReport(sb, parsed.data.id, parsed.data.reason);
    revalidatePath("/reports/saved");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

/**
 * No role guard on the two reads below.
 *
 * The session client is bound to one company's schema and filtered by the
 * `documents.read` policy, and the service refuses a row it cannot see. A role
 * check here would be a second, looser statement of the same rule — and the
 * looser one is the hole.
 */
export async function savedReportDownloadUrlAction(
  id: string,
): Promise<SavedReportActionResult<{ url: string; fileName: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await createSavedReportDownloadUrl(sb, id) };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function savedReportPreviewAction(
  id: string,
): Promise<SavedReportActionResult<{ text: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { text: await readSavedReportText(sb, id) } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
