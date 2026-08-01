"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  getControlReconciliation,
  getPostingReport,
  GlPostingError,
} from "@/lib/services/gl-posting";
import type { ControlReconciliation, PostingReport } from "@/lib/domain/gl-posting";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function messageFrom(e: unknown): string {
  return e instanceof GlPostingError || e instanceof Error
    ? e.message
    : "An unexpected error occurred";
}

export async function postingReportAction(
  from: string,
  to: string,
): Promise<ActionResult<PostingReport>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getPostingReport(sb, from, to) };
  } catch (e) {
    return { ok: false, error: messageFrom(e) };
  }
}

export async function controlReconciliationAction(
  asOf: string,
): Promise<ActionResult<ControlReconciliation>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getControlReconciliation(sb, asOf) };
  } catch (e) {
    return { ok: false, error: messageFrom(e) };
  }
}
