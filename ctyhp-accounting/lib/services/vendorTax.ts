import type { SupabaseClient } from "@supabase/supabase-js";
import type { Box1099Row, Vendor1099SummaryRow, VendorTaxProfileRow } from "@/lib/db/types";
import type { VendorTaxProfileInput } from "@/lib/domain/schemas";
import { assess1099, sum1099Reportable, ties, type Vendor1099Row } from "@/lib/domain/vendorTax";

export class VendorTaxError extends Error {}

const PROFILE_COLS =
  "id,vendor_id,version,w9_status,w9_received_date,w9_expires_date,classification," +
  "reporting_name,tin_ref,tin_type,address_line1,address_line2,city,region,postal_code," +
  "country,is_1099_eligible,box_code,eligibility_override,override_reason,change_reason,created_at";

export async function list1099Boxes(sb: SupabaseClient): Promise<Box1099Row[]> {
  const { data, error } = await sb
    .from("acc_1099_box")
    .select("code,form,box_label,threshold_minor,is_active")
    .eq("is_active", true)
    .order("code");
  if (error) throw new VendorTaxError(error.message);
  return (data ?? []) as unknown as Box1099Row[];
}

/** Every version, newest first — the history of a sensitive field is the table. */
export async function listVendorTaxProfileVersions(
  sb: SupabaseClient,
  vendorId: string,
): Promise<VendorTaxProfileRow[]> {
  const { data, error } = await sb
    .from("acc_vendor_tax_profile")
    .select(PROFILE_COLS)
    .eq("vendor_id", vendorId)
    .order("version", { ascending: false });
  if (error) throw new VendorTaxError(error.message);
  return (data ?? []) as unknown as VendorTaxProfileRow[];
}

export async function getVendorTaxProfile(
  sb: SupabaseClient,
  vendorId: string,
): Promise<VendorTaxProfileRow | null> {
  const versions = await listVendorTaxProfileVersions(sb, vendorId);
  return versions[0] ?? null;
}

/** Saving writes a new version; the RPC enforces permission, reason, and approval. */
export async function saveVendorTaxProfile(
  sb: SupabaseClient,
  vendorId: string,
  input: VendorTaxProfileInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_save_vendor_tax_profile", {
    p_vendor_id: vendorId,
    p_w9_status: input.w9_status,
    p_w9_received_date: input.w9_received_date || null,
    p_w9_expires_date: input.w9_expires_date || null,
    p_classification: input.classification || null,
    p_reporting_name: input.reporting_name || null,
    p_tin_ref: input.tin_ref || null,
    p_tin_type: input.tin_type || null,
    p_address_line1: input.address_line1 || null,
    p_address_line2: input.address_line2 || null,
    p_city: input.city || null,
    p_region: input.region || null,
    p_postal_code: input.postal_code || null,
    p_country: input.country || "US",
    p_is_1099_eligible: input.is_1099_eligible,
    p_box_code: input.box_code || null,
    p_eligibility_override: input.eligibility_override,
    p_override_reason: input.override_reason || null,
    p_reason: input.reason,
  });
  if (error) throw new VendorTaxError(error.message);
  return String(data);
}

export interface Vendor1099Assessed extends Vendor1099SummaryRow {
  reportable: boolean;
  exceptions: { code: string; severity: "blocker" | "warning"; message: string }[];
}

export interface Report1099 {
  year: number;
  asOf: string;
  rows: Vendor1099Assessed[];
  reportableCount: number;
  reportableTotalMinor: number;
  blockerCount: number;
  /** Sum of every row's paid amount — must equal the control total. */
  rowsTotalMinor: number;
  controlTotalMinor: number;
  tiesOut: boolean;
}

/**
 * The 1099 review dataset. The database supplies facts; reportability and the
 * exception queue come from the domain module, and the control total proves the
 * rows add up to what the payment documents say.
 */
export async function get1099Summary(
  sb: SupabaseClient,
  year: number,
): Promise<Report1099> {
  const [summary, control] = await Promise.all([
    sb.rpc("acc_1099_summary", { p_year: year }),
    sb.rpc("acc_1099_control_total", { p_year: year }),
  ]);
  if (summary.error) throw new VendorTaxError(summary.error.message);
  if (control.error) throw new VendorTaxError(control.error.message);

  const raw = ((summary.data ?? []) as Record<string, unknown>[]).map((r) => ({
    vendor_id: r.vendor_id as string,
    vendor_name: r.vendor_name as string,
    reporting_name: (r.reporting_name as string | null) ?? null,
    classification: (r.classification as Vendor1099SummaryRow["classification"]) ?? null,
    w9_status: r.w9_status as Vendor1099SummaryRow["w9_status"],
    w9_expires_date: (r.w9_expires_date as string | null) ?? null,
    tin_on_file: Boolean(r.tin_on_file),
    address_complete: Boolean(r.address_complete),
    is_1099_eligible: Boolean(r.is_1099_eligible),
    box_code: (r.box_code as string | null) ?? null,
    box_label: (r.box_label as string | null) ?? null,
    threshold_minor: Number(r.threshold_minor),
    paid_minor: Number(r.paid_minor),
    eligibility_override: Boolean(r.eligibility_override),
  }));

  // Assess as of the end of the tax year, so an expiry inside the year counts.
  const asOf = `${year}-12-31`;
  const toDomain = (r: Vendor1099SummaryRow): Vendor1099Row => ({
    vendorName: r.vendor_name,
    reportingName: r.reporting_name,
    classification: r.classification,
    w9Status: r.w9_status,
    w9ExpiresDate: r.w9_expires_date,
    tinOnFile: r.tin_on_file,
    addressComplete: r.address_complete,
    is1099Eligible: r.is_1099_eligible,
    boxCode: r.box_code,
    thresholdMinor: r.threshold_minor,
    paidMinor: r.paid_minor,
    eligibilityOverride: r.eligibility_override,
  });

  const rows: Vendor1099Assessed[] = raw.map((r) => {
    const a = assess1099(toDomain(r), asOf);
    return { ...r, reportable: a.reportable, exceptions: a.exceptions };
  });

  const rowsTotalMinor = raw.reduce((s, r) => s + r.paid_minor, 0);
  const controlTotalMinor = Number(control.data ?? 0);

  return {
    year,
    asOf,
    rows,
    reportableCount: rows.filter((r) => r.reportable).length,
    reportableTotalMinor: sum1099Reportable(raw.map(toDomain), asOf),
    blockerCount: rows.filter((r) => r.exceptions.some((e) => e.severity === "blocker")).length,
    rowsTotalMinor,
    controlTotalMinor,
    tiesOut: ties(rowsTotalMinor, controlTotalMinor),
  };
}
