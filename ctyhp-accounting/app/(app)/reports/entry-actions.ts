"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { EntryDetail } from "@/lib/domain/entry-detail";
import { getEntryDetail } from "@/lib/services/entry-detail";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One entry, for the detail sheet a report opens when a line is clicked.
 *
 * A read and nothing else. Row-level security decides whether the signed-in
 * user may see the entry; this only refuses an id that is not one.
 */
export async function entryDetailAction(entryId: string): Promise<ActionResult<EntryDetail>> {
  if (!UUID.test(entryId)) return { ok: false, error: "That is not an entry." };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getEntryDetail(sb, entryId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The entry could not be read." };
  }
}
