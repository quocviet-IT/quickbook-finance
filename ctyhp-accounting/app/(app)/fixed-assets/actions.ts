"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  FixedAssetError,
  listAssetSchedule,
  postAssetDepreciation,
  registerFixedAsset,
  type RegisterFixedAssetInput,
} from "@/lib/services/fixed-assets";
import type { AssetDepreciationScheduleRow } from "@/lib/db/types";

interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function authorized(permission: string): Promise<boolean> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("acc_has_permission", { p_key: permission });
  return !error && data === true;
}

function errorMessage(error: unknown): string {
  if (error instanceof FixedAssetError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

export async function registerFixedAssetAction(
  input: RegisterFixedAssetInput,
): Promise<ActionResult<{ id: string }>> {
  if (!(await authorized("fixed_assets.manage"))) {
    return { ok: false, error: "You do not have permission to manage fixed assets" };
  }
  if (!input.name?.trim() || !input.category?.trim()) {
    return { ok: false, error: "Asset name and category are required" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const id = await registerFixedAsset(sb, input);
    revalidatePath("/fixed-assets");
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function getAssetScheduleAction(
  assetId: string,
): Promise<ActionResult<AssetDepreciationScheduleRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listAssetSchedule(sb, assetId) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function postAssetDepreciationAction(
  assetId: string,
  throughDate: string,
): Promise<ActionResult<{ postedCount: number; postedTotalMinor: number }>> {
  if (!(await authorized("fixed_assets.post"))) {
    return { ok: false, error: "You do not have permission to post asset depreciation" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const result = await postAssetDepreciation(sb, assetId, throughDate);
    revalidatePath("/fixed-assets");
    revalidatePath("/journal");
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
