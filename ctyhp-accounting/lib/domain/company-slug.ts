/**
 * A company's key, derived from its legal name.
 *
 * The key becomes a Postgres schema name (`co_<slug>`), so it has to satisfy
 * `^[a-z][a-z0-9_]{1,40}$` — the same check `onebook.company` enforces. The
 * derivation is a suggestion the user can overwrite; what it must never do is
 * suggest something the register will reject.
 */
export function companySlugFromName(name: string): string {
  const ascii = name
    .normalize("NFD")
    // Strip the combining marks NFD just separated, so "Übergem" becomes
    // "ubergem" rather than losing the letter entirely.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const base = ascii
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    // A key may not start with a digit, and dropping the digits would turn
    // "3M Metals" into "m_metals" — a leading letter keeps the name readable.
    .replace(/^(?=\d)/, "c");
  const trimmed = base.slice(0, 41).replace(/_+$/, "");
  return trimmed.length >= 2 ? trimmed : "";
}
