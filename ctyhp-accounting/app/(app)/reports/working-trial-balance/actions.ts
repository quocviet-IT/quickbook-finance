"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { WorkingTrialBalance } from "@/lib/domain/working-trial-balance";
import { getWorkingTrialBalance } from "@/lib/services/working-trial-balance";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The only verb this screen has. It reads; nothing here changes a figure. */
export async function workingTrialBalanceAction(from: string, to: string): Promise<ActionResult<WorkingTrialBalance>> {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { ok: false, error: "Choose a start and an end date." };
  if (from > to) return { ok: false, error: "The start date is after the end date." };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getWorkingTrialBalance(sb, from, to) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The report could not be produced." };
  }
}
