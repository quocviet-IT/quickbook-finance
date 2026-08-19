"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { restoreBackupIntoNewCompany, type RestoreOutcome } from "@/lib/services/backup-restore";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * Restore one stored snapshot into a brand-new company.
 *
 * Gated on the permission, not the role: `company.restore` is what migration
 * 0114 defined for exactly this act, and checking the role instead would make
 * the permissions screen a lie the moment an administrator edited the matrix.
 * The page carries the same gate; this check is the one that counts, because
 * a server action is callable without the page.
 */
export async function restoreBackupAction(
  backupId: string,
  name: string,
): Promise<ActionResult<RestoreOutcome>> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };

  const [restoreAllowed, exportAllowed] = await Promise.all([
    sb.rpc("acc_has_permission", { p_key: "company.restore" }),
    sb.rpc("acc_has_permission", { p_key: "company.export" }),
  ]);
  // A permission lookup that failed is not a permission granted.
  if (restoreAllowed.error || restoreAllowed.data !== true) {
    return { ok: false, error: "You do not have permission to restore a backup" };
  }
  // Reading the acc_backup register is admitted by company.export (its RLS
  // policy, migration 0114), so restore-without-export makes that read come
  // back empty and the service would answer "That snapshot does not exist in
  // this company's register" — the wrong explanation for what is actually a
  // permission refusal. Refuse here, naming the permission that is missing.
  if (exportAllowed.error || exportAllowed.data !== true) {
    return {
      ok: false,
      error:
        "Restoring a backup also needs the company.export permission, which is what grants reading the snapshot register.",
    };
  }

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 160) {
    return { ok: false, error: "The new company needs a name of up to 160 characters." };
  }

  try {
    const outcome = await restoreBackupIntoNewCompany(sb, backupId, trimmed);
    // The company switcher in the shell must show the copy without a reload.
    revalidatePath("/", "layout");
    return { ok: true, data: outcome };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The restore failed before it could finish.",
    };
  }
}
