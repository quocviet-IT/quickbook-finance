/**
 * Pure vendor rules shared by the screens that can create one mid-document.
 */
import type { VendorRow } from "@/lib/db/types";

/** What a screen collects when it creates a vendor without leaving a document. */
export interface NewVendorInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  currency_code?: string | null;
  payment_terms?: string | null;
  payment_terms_days?: number | null;
  discount_percent?: number | null;
  discount_days?: number | null;
}

/**
 * The row a picker should show for a vendor that was just created.
 *
 * A screen creating a vendor inline cannot wait for the page to reload — the
 * person is halfway through a purchase order — so it adds the vendor to its own
 * list. Assembling that row by hand is where this goes wrong: `is_active`
 * defaulted to false drops the vendor straight back out of every picker that
 * filters on it, and it gets created a second time.
 *
 * `created_at` and `updated_at` are left empty because the trigger owns them and
 * no picker reads them; the next load brings the real values.
 */
export function createdVendorRow(id: string, input: NewVendorInput): VendorRow {
  return {
    id,
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    currency_code: input.currency_code || null,
    ap_account_id: null,
    default_expense_account_id: null,
    payment_terms: input.payment_terms || null,
    is_active: true,
    created_at: "",
    updated_at: "",
    payment_terms_days: input.payment_terms_days ?? null,
    discount_percent: input.discount_percent ?? null,
    discount_days: input.discount_days ?? null,
  };
}

/** A vendor list with a newly created one folded in, still ordered by name. */
export function withVendor(vendors: readonly VendorRow[], added: VendorRow): VendorRow[] {
  return [...vendors, added].sort((a, b) => a.name.localeCompare(b.name));
}
