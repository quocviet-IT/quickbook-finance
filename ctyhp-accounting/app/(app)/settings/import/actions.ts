"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin, canWrite } from "@/lib/auth";
import {
  previewImport,
  runImport,
  DataImportError,
  type ImportOutcome,
  type ImportPreview,
} from "@/lib/services/data-import";
import type { ImportTarget } from "@/lib/domain/import-mapping";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  return err instanceof DataImportError || err instanceof Error
    ? err.message
    : "An unexpected error occurred";
}

/**
 * The chart of accounts is an administrator's to change; the rest is ordinary
 * bookkeeping. Both are checked again in the database, which is where the rule
 * actually lives.
 */
async function guard(target: ImportTarget): Promise<string | null> {
  const role = await getUserRole();
  if (target === "chart_of_accounts") {
    return isAdmin(role) ? null : "Only an administrator can import a chart of accounts";
  }
  return canWrite(role) ? null : "You do not have permission to import data";
}

/** What the import would do. Writes nothing. */
export async function previewImportAction(
  target: ImportTarget,
  rows: string[][],
  mapping: Record<string, number | null>,
): Promise<ActionResult<ImportPreview>> {
  const denied = await guard(target);
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewImport(sb, target, rows, mapping) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Do it, into whichever company is currently open. */
export async function runImportAction(
  target: ImportTarget,
  rows: string[][],
  mapping: Record<string, number | null>,
  openingBalancesAsOf: string | null,
): Promise<ActionResult<ImportOutcome>> {
  const denied = await guard(target);
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await runImport(sb, target, rows, mapping, { openingBalancesAsOf });
    for (const path of ["/accounts", "/customers", "/vendors", "/items", "/reports"]) {
      revalidatePath(path);
    }
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
