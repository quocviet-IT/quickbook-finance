"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  FixedAssetError,
  disposeFixedAsset,
  importFixedAssets,
  listAssetSchedule,
  postAssetDepreciation,
  postAssetDepreciationBatch,
  registerFixedAsset,
  type DisposeFixedAssetInput,
  type ImportFixedAssetRow,
  type RegisterFixedAssetInput,
} from "@/lib/services/fixed-assets";
import type { AssetDepreciationScheduleRow } from "@/lib/db/types";
import { getBillLines } from "@/lib/services/payables";

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

export async function postAssetDepreciationBatchAction(
  assetIds: string[],
  throughDate: string,
): Promise<ActionResult<{ assetCount: number; periodCount: number; totalMinor: number }>> {
  if (!(await authorized("fixed_assets.post"))) {
    return { ok: false, error: "You do not have permission to post asset depreciation" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const result = await postAssetDepreciationBatch(sb, assetIds, throughDate);
    revalidatePath("/fixed-assets");
    revalidatePath("/reports/fixed-assets");
    revalidatePath("/journal");
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function importFixedAssetsAction(
  rows: ImportFixedAssetRow[],
  postOpeningEntries: boolean,
): Promise<ActionResult<{ importedCount: number; openingJournalCount: number }>> {
  if (!(await authorized("fixed_assets.import"))) {
    return { ok: false, error: "You do not have permission to import fixed assets" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const result = await importFixedAssets(sb, rows, postOpeningEntries);
    revalidatePath("/fixed-assets");
    revalidatePath("/reports/fixed-assets");
    revalidatePath("/journal");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function disposeFixedAssetAction(
  input: DisposeFixedAssetInput,
): Promise<ActionResult<{
  journalEntryId: string;
  netBookValueMinor: number;
  netProceedsMinor: number;
  gainLossMinor: number;
}>> {
  if (!(await authorized("fixed_assets.dispose"))) {
    return { ok: false, error: "You do not have permission to dispose fixed assets" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const result = await disposeFixedAsset(sb, input);
    revalidatePath("/fixed-assets");
    revalidatePath("/reports/fixed-assets");
    revalidatePath("/journal");
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function getBillAssetSourceAction(billId: string): Promise<ActionResult<{
  billDate: string;
  currencyCode: string;
  totalMinor: number;
  vendorId: string;
  lines: Array<{ expenseAccountId: string; amountMinor: number; description: string }>;
}>> {
  try {
    const sb = await createSupabaseServerClient();
    const [{ data: bill, error: billError }, lines] = await Promise.all([
      sb
        .from("acc_bill")
        .select("id,bill_date,currency_code,total_minor,vendor_id,status,journal_entry_id")
        .eq("id", billId)
        .single(),
      getBillLines(sb, billId),
    ]);
    if (billError) throw new FixedAssetError(billError.message);
    if ((bill as { status: string }).status === "draft" || !(bill as { journal_entry_id: string | null }).journal_entry_id) {
      return { ok: false, error: "Post the bill before registering it as a fixed asset" };
    }
    return {
      ok: true,
      data: {
        billDate: bill.bill_date as string,
        currencyCode: bill.currency_code as string,
        totalMinor: Number(bill.total_minor),
        vendorId: bill.vendor_id as string,
        lines: lines.map((line) => ({
          expenseAccountId: line.expense_account_id,
          amountMinor: Number(line.amount_minor),
          description: line.description,
        })),
      },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
