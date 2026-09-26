"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { ExceptionsError, getExceptionReport } from "@/lib/services/exceptions";
import type { ExceptionReport } from "@/lib/domain/exceptions";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function messageFrom(e: unknown): string {
  return e instanceof ExceptionsError || e instanceof Error
    ? e.message
    : "An unexpected error occurred";
}

/**
 * The only verb this screen has. It reads and returns; there is nothing here
 * that changes a figure, and nothing should ever be added that does.
 */
export async function exceptionReportAction(
  from: string,
  to: string,
): Promise<ActionResult<ExceptionReport>> {
  try {
    const sb = await createSupabaseServerClient();
    const today = new Date().toISOString().slice(0, 10);
    return { ok: true, data: await getExceptionReport(sb, from, to, today) };
  } catch (e) {
    return { ok: false, error: messageFrom(e) };
  }
}
