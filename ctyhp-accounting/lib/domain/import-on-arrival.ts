/**
 * What Banking does when it is opened to import a statement (`?import=1`, from
 * the New menu).
 *
 * A statement belongs to one bank account, and Import statement imports into
 * the account on screen. Opening the dialog straight away is right only when
 * there is no doubt which account that is: the company has one, or the link
 * named it. With several and none named, the first in the list is a guess, and
 * a statement imported into the wrong account has to be undone — so the page
 * asks for the account instead. Somebody who cannot write is offered nothing.
 */
export type ImportOnArrival = "open" | "choose-account" | "none";

export function importOnArrival({
  requested,
  canWrite,
  bankAccountIds,
  requestedAccountId,
}: {
  requested: boolean;
  canWrite: boolean;
  bankAccountIds: readonly string[];
  requestedAccountId: string | null;
}): ImportOnArrival {
  if (!requested || !canWrite || bankAccountIds.length === 0) return "none";
  if (bankAccountIds.length === 1) return "open";
  if (requestedAccountId && bankAccountIds.includes(requestedAccountId)) return "open";
  return "choose-account";
}
