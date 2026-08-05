"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { companyCreateSchema } from "@/lib/domain/schemas";
import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface CompanyRequestView {
  id: string;
  slug: string;
  legal_name: string;
  status: "pending" | "running" | "ready" | "failed";
  attempts: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const REQUEST_COLUMNS = "id,slug,legal_name,status,attempts,error,created_at,finished_at";

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

/**
 * Work the queue once the response has gone out.
 *
 * `after` keeps the invocation alive past the response, so the browser is not
 * holding a connection open for the twenty seconds it takes to build 75 tables.
 * A failure here is recorded on the request row by the worker itself — it must
 * never turn a successfully queued ask into an error the user sees.
 */
function startProvisioning(): void {
  after(async () => {
    try {
      await runPendingCompanyProvisioning();
    } catch {
      // The worker records its own failures on the request row; a throw here
      // means it could not even start, and the row stays pending for the cron.
    }
  });
}

export async function requestCompanyAction(
  raw: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = companyCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };

  try {
    // Authorization is the register's: `request_company` refuses anyone who is
    // not a platform administrator, whatever the screen decided to show.
    const control = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await control.rpc("request_company", {
      p_slug: parsed.data.slug,
      p_legal_name: parsed.data.legal_name,
      p_is_sample: parsed.data.is_sample,
      p_display_order: parsed.data.display_order,
    });
    if (error) return { ok: false, error: error.message };

    startProvisioning();
    revalidatePath("/settings/companies");
    return { ok: true, data: { requestId: data as string } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getCompanyRequestAction(
  id: string,
): Promise<ActionResult<CompanyRequestView | null>> {
  try {
    const control = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await control
      .from("company_request")
      .select(REQUEST_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data as CompanyRequestView | null) ?? null };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function retryCompanyRequestAction(id: string): Promise<ActionResult> {
  try {
    const control = await createSupabaseServerClientForSchema("onebook");
    const { error } = await control.rpc("retry_company_request", { p_id: id });
    if (error) return { ok: false, error: error.message };
    startProvisioning();
    revalidatePath("/settings/companies");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
