/**
 * Finding one contact in a register of many.
 *
 * The convention every professional bookkeeping product converged on —
 * QuickBooks' "Find a customer or company", Xero's contact search — is one
 * text box that just works: it looks in every field a person might remember a
 * contact by, ignores case, and sits beside an active/inactive narrowing.
 * That is precisely what this implements, for the Customers and Vendors
 * registers, both of which shipped with no way to search at all.
 *
 * Pure and shared: one definition of "matches", so the two registers cannot
 * drift apart on what a search finds. Screen-specific narrowings — the
 * customers' credit state, say — compose on top at the call site rather than
 * being wedged in here, because vendors have no credit state to filter by.
 */

export interface FilterableContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  city?: string | null;
  region?: string | null;
  is_active: boolean;
}

export type ActiveFilter = "all" | "active" | "inactive";

/** The fields a person remembers a contact by, in the order they tend to. */
const SEARCHED_FIELDS = ["name", "contact_name", "email", "phone", "city", "region"] as const;

export function filterContacts<T extends FilterableContact>(
  rows: readonly T[],
  keyword: string,
  active: ActiveFilter,
): T[] {
  const needle = keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (active === "active" && !row.is_active) return false;
    if (active === "inactive" && row.is_active) return false;
    if (!needle) return true;
    return SEARCHED_FIELDS.some((field) => {
      const value = row[field];
      // Null is a record predating the field, not a match for anything.
      return typeof value === "string" && value.toLowerCase().includes(needle);
    });
  });
}
