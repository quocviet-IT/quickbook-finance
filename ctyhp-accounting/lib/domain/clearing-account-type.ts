/**
 * Which accounts can be marked as a clearing account, and what the form says
 * about it.
 *
 * Kept apart from `clearing-accounts.ts`, and importing nothing: the shared
 * form schemas (`schemas.ts`) read this, and every page with a form loads
 * those schemas, so anything imported here is carried into all of them.
 */

/** Only these account types can be marked as a clearing account; the database guard (0145) agrees. */
export const CLEARING_TYPE_MESSAGE = "Only a current asset or a current liability can be a clearing account.";

export const CLEARING_FORM_HELP =
  "It should empty: money received waits here until it is banked, wages until they are paid.";

export function canBeClearing(type: string | null | undefined): boolean {
  return type === "current_asset" || type === "current_liability";
}
