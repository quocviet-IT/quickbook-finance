/**
 * Renaming an account in place (3.0.26, item B of the defect report of
 * 11 Nov 2026). An account's name is its label, not its identity: every
 * journal line, report and reconciliation is tied to its id, so a new name
 * moves no balance and restates nothing. It changes at any time, on an account
 * with postings too. Its type and its code do not, once it has postings
 * (acc_account_shape_guard, 0195): those move balances between lines of the
 * statements.
 *
 * Pure, so the chart's words are tested where they are written.
 */

/** The name rule the save schema holds (lib/domain/schemas.ts): not blank, 120 characters at most. */
export function accountNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name";
  if (trimmed.length > 120) return "Keep the name to 120 characters";
  return null;
}

export const ACCOUNT_RENAME = {
  button: (name: string) => `Rename ${name}`,
  inputLabel: (code: string) => `New name for account ${code}`,
  save: "Save the name",
  cancel: "Keep the name",
  renamed: (code: string, name: string) => `${code} is now ${name}. Reports, the journal and exports show the new name.`,
} as const;

/** Under Account type in Edit account, for an account with postings. */
export function typeLockedNote(typeLabel: string): string {
  return `This account has postings, so its type stays ${typeLabel}: changing it would move its balance to another line of the statements. Its name can be changed at any time.`;
}
