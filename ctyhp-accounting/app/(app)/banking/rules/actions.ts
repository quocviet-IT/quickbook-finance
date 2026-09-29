"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { bankRuleInputSchema, rulePreviewInputSchema } from "@/lib/domain/schemas";
import {
  deleteBankRule,
  previewBankRule,
  reorderBankRules,
  saveBankRule,
  type RulePreview,
} from "@/lib/services/coding";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  return canWrite(await getUserRole()) ? null : "You do not have permission to change bank rules";
}
const messageOf = (err: unknown) => (err instanceof Error ? err.message : "An unexpected error occurred");
const refresh = () => {
  revalidatePath("/banking/rules");
  revalidatePath("/banking");
};

export async function previewBankRuleAction(raw: unknown): Promise<ActionResult<RulePreview>> {
  const parsed = rulePreviewInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewBankRule(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function saveBankRuleAction(id: string | null, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = bankRuleInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveBankRule(sb, id, parsed.data);
    refresh();
    return { ok: true, data: { id: saved } };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function deleteBankRuleAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await deleteBankRule(sb, id);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function reorderBankRulesAction(ids: string[]): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await reorderBankRules(sb, ids);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}
