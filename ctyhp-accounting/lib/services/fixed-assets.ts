import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssetDepreciationScheduleRow,
  FixedAssetMethod,
  FixedAssetRow,
} from "@/lib/db/types";

export class FixedAssetError extends Error {}

export interface FixedAssetView extends FixedAssetRow {
  asset_account_name: string;
  accumulated_depreciation_account_name: string | null;
  depreciation_expense_account_name: string | null;
  vendor_name: string | null;
  accumulated_depreciation_minor: number;
  net_book_value_minor: number;
  due_depreciation_minor: number;
  next_depreciation_date: string | null;
  posted_periods: number;
  total_periods: number;
}

export async function listFixedAssets(sb: SupabaseClient): Promise<FixedAssetView[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [
    { data: assets, error: assetError },
    { data: schedules, error: scheduleError },
    { data: accounts, error: accountError },
    { data: vendors, error: vendorError },
  ] = await Promise.all([
    sb.from("acc_fixed_asset").select("*").order("asset_number"),
    sb.from("acc_asset_depreciation_schedule").select("*").order("sequence_number"),
    sb.from("acc_account").select("id,account_code,name"),
    sb.from("acc_vendor").select("id,name"),
  ]);
  if (assetError) throw new FixedAssetError(assetError.message);
  if (scheduleError) throw new FixedAssetError(scheduleError.message);
  if (accountError) throw new FixedAssetError(accountError.message);
  if (vendorError) throw new FixedAssetError(vendorError.message);

  const accountNames = new Map(
    (accounts ?? []).map((account) => [
      account.id as string,
      `${account.account_code as string} — ${account.name as string}`,
    ]),
  );
  const vendorNames = new Map((vendors ?? []).map((vendor) => [vendor.id as string, vendor.name as string]));
  const allSchedules = (schedules ?? []) as unknown as AssetDepreciationScheduleRow[];

  return ((assets ?? []) as unknown as FixedAssetRow[]).map((asset) => {
    const assetSchedules = allSchedules.filter((schedule) => schedule.asset_id === asset.id);
    const posted = assetSchedules.filter((schedule) => schedule.status === "posted");
    const planned = assetSchedules.filter((schedule) => schedule.status === "planned");
    const accumulated = posted.reduce((sum, schedule) => sum + Number(schedule.posted_amount_minor), 0);
    return {
      ...asset,
      asset_account_name: accountNames.get(asset.asset_account_id) ?? "Unknown account",
      accumulated_depreciation_account_name: asset.accumulated_depreciation_account_id
        ? accountNames.get(asset.accumulated_depreciation_account_id) ?? "Unknown account"
        : null,
      depreciation_expense_account_name: asset.depreciation_expense_account_id
        ? accountNames.get(asset.depreciation_expense_account_id) ?? "Unknown account"
        : null,
      vendor_name: asset.vendor_id ? vendorNames.get(asset.vendor_id) ?? "Unknown vendor" : null,
      accumulated_depreciation_minor: accumulated,
      net_book_value_minor: Number(asset.cost_minor) - accumulated,
      due_depreciation_minor: planned
        .filter((schedule) => schedule.period_end <= today)
        .reduce((sum, schedule) => sum + Number(schedule.planned_amount_minor), 0),
      next_depreciation_date: planned[0]?.period_end ?? null,
      posted_periods: posted.length,
      total_periods: assetSchedules.length,
    };
  });
}

export async function listAssetSchedule(
  sb: SupabaseClient,
  assetId: string,
): Promise<AssetDepreciationScheduleRow[]> {
  const { data, error } = await sb
    .from("acc_asset_depreciation_schedule")
    .select("*")
    .eq("asset_id", assetId)
    .order("sequence_number");
  if (error) throw new FixedAssetError(error.message);
  return (data ?? []) as unknown as AssetDepreciationScheduleRow[];
}

export interface RegisterFixedAssetInput {
  name: string;
  description?: string | null;
  category: string;
  serial_number?: string | null;
  location?: string | null;
  acquisition_date: string;
  in_service_date: string;
  currency_code: string;
  cost_minor: number;
  salvage_value_minor: number;
  useful_life_months?: number | null;
  depreciation_method: FixedAssetMethod;
  asset_account_id: string;
  accumulated_depreciation_account_id?: string | null;
  depreciation_expense_account_id?: string | null;
  vendor_id?: string | null;
  source_bill_id?: string | null;
  notes?: string | null;
}

export async function registerFixedAsset(
  sb: SupabaseClient,
  input: RegisterFixedAssetInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_register_fixed_asset", {
    p_name: input.name,
    p_description: input.description ?? null,
    p_category: input.category,
    p_serial_number: input.serial_number ?? null,
    p_location: input.location ?? null,
    p_acquisition_date: input.acquisition_date,
    p_in_service_date: input.in_service_date,
    p_currency_code: input.currency_code,
    p_cost_minor: input.cost_minor,
    p_salvage_value_minor: input.salvage_value_minor,
    p_useful_life_months: input.useful_life_months ?? null,
    p_depreciation_method: input.depreciation_method,
    p_asset_account_id: input.asset_account_id,
    p_accumulated_depreciation_account_id: input.accumulated_depreciation_account_id ?? null,
    p_depreciation_expense_account_id: input.depreciation_expense_account_id ?? null,
    p_vendor_id: input.vendor_id ?? null,
    p_source_bill_id: input.source_bill_id ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new FixedAssetError(error.message);
  return data as string;
}

export async function postAssetDepreciation(
  sb: SupabaseClient,
  assetId: string,
  throughDate: string,
): Promise<{ postedCount: number; postedTotalMinor: number }> {
  const { data, error } = await sb.rpc("acc_post_asset_depreciation", {
    p_asset_id: assetId,
    p_through_date: throughDate,
  });
  if (error) throw new FixedAssetError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    postedCount: Number((row as { posted_count?: number } | null)?.posted_count ?? 0),
    postedTotalMinor: Number((row as { posted_total_minor?: number } | null)?.posted_total_minor ?? 0),
  };
}
