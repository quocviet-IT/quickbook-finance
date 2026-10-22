/**
 * The Reconcile start screen's statement alerts: the parts that are not
 * drawing.
 *
 * Which bank account the screen shows, the two clicks and the reason that
 * remove a flagged group, and the small pieces of wording the cards share.
 * The detectors and the cards' sentences are in `statement-alerts.ts`; this
 * module only decides what the screen does with them. It reads nothing and
 * imports no service, so the screen's behaviour is tested without a browser.
 */

import { payeeKeyOf } from "@/lib/domain/statement-alerts";

/** The longest reason the server takes (`balanceGroupRemoveSchema`). */
export const REASON_MAX = 300;

/** The same words the server answers with, so the screen and the action never disagree. */
export const REASON_REQUIRED = "A reason is required";
export const REASON_TOO_LONG = `Keep the reason to ${REASON_MAX} characters or fewer`;

/** What the panel says, quietly, when the checks could not be read. */
export const CHECKS_FAILED = "Checks could not be run";

/** The heading over the entries that stop a flagged group being removed here. */
export const BLOCKERS_HEADING = "These cannot be removed here:";

/**
 * The bank account the screen shows: the one in the address when it is one of
 * this company's, otherwise the first. An id that is not one of them — a link
 * from another company, a typo, an account since removed — falls back without
 * saying anything, because the screen still works.
 */
export function chosenBankId(
  banks: readonly { id: string }[],
  requested: string | null | undefined,
): string | undefined {
  if (requested && banks.some((b) => b.id === requested)) return requested;
  return banks[0]?.id;
}

/**
 * The reconciliations to list: the ones read for the account now chosen, or
 * none while that account's read is still on its way.
 *
 * The list used to keep whatever it read last. Switching accounts left the
 * previous account's reconciliations on screen for the five to ten seconds the
 * new read took, under the new account's name: "never been reconciled" above
 * five rows marked Completed that belonged to the other account (feature
 * check, 2026-10-20).
 */
export function rowsForAccount<Row>(
  bankId: string | undefined,
  loadedFor: string | null,
  rows: readonly Row[],
): readonly Row[] {
  return bankId !== undefined && loadedFor === bankId ? rows : [];
}

/**
 * Whether the reconcile list is still reading: its reconciliations, or its
 * standing when it has none yet. With no account there is nothing to read, so
 * nothing to wait for; the screen says there is no account instead. Without
 * that, a company with no bank account spun for ever.
 */
export function reconcileTableLoading(input: {
  bankId: string | undefined;
  loading: boolean;
  rowCount: number;
  standingSettled: boolean;
}): boolean {
  if (!input.bankId) return false;
  return input.loading || (input.rowCount === 0 && !input.standingSettled);
}

/** Where an entry opens in full. */
export function entryHref(entryId: string): string {
  return `/journal?entry=${encodeURIComponent(entryId)}`;
}

/** The other accounts on an entry, as one line; an em dash when it has none. */
export function codedToText(codedTo: readonly string[]): string {
  return codedTo.length > 0 ? codedTo.join(", ") : "—";
}

/** Why a reason cannot be sent, or null when it can. Trimmed, as the server trims it. */
export function reasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") return REASON_REQUIRED;
  if (trimmed.length > REASON_MAX) return REASON_TOO_LONG;
  return null;
}

/** Whether a person is offered the button at all: they can write, and nothing in the group stands in the way. */
export function canOfferRemoval(canWrite: boolean, blockers: readonly unknown[]): boolean {
  return canWrite && blockers.length === 0;
}

/* ----------------------------------------------------- the two-click removal */

/**
 * Where a removal stands.
 *
 * `idle`: the button reads "Remove these N entries".
 * `confirm`: it reads "Confirm — remove all N", and a reason is asked for.
 *   `problem` is the reason's fault after a click that could not send;
 *   `error` is what the server said when it refused.
 * `removing`: the request is out. Nothing else is sent until it answers.
 */
export type RemovalState =
  | { step: "idle" }
  | { step: "confirm"; reason: string; problem: string | null; error: string | null }
  | { step: "removing"; reason: string };

export type RemovalEvent =
  /** The first click. */
  | { type: "ask" }
  | { type: "type"; reason: string }
  | { type: "cancel" }
  /** The second click. */
  | { type: "confirm" }
  /** The server refused; its words are shown in the card. */
  | { type: "failed"; error: string }
  | { type: "done" };

export const REMOVAL_IDLE: RemovalState = { step: "idle" };

/**
 * The next state of a removal.
 *
 * A second click while a request is out does nothing, which is what stops a
 * double submit; so does a click in any state that does not expect it. A
 * click with no reason stays where it is and says why. A refusal keeps the
 * reason typed, so trying again does not mean typing it again.
 */
export function removalStep(state: RemovalState, event: RemovalEvent): RemovalState {
  switch (event.type) {
    case "ask":
      return state.step === "idle" ? { step: "confirm", reason: "", problem: null, error: null } : state;
    case "type":
      return state.step === "confirm" ? { ...state, reason: event.reason, problem: null } : state;
    case "cancel":
      return state.step === "confirm" ? REMOVAL_IDLE : state;
    case "confirm": {
      if (state.step !== "confirm") return state;
      const problem = reasonProblem(state.reason);
      if (problem) return { ...state, problem };
      return { step: "removing", reason: state.reason.trim() };
    }
    case "failed":
      return state.step === "removing"
        ? { step: "confirm", reason: state.reason, problem: null, error: event.error }
        : state;
    case "done":
      return state.step === "removing" ? REMOVAL_IDLE : state;
  }
}

/** The removal button's words: "Remove these N entries" until the first click, then "Confirm — remove all N". */
export function removalLabel(state: RemovalState, labels: { removeLabel: string; confirmLabel: string }): string {
  return state.step === "idle" ? labels.removeLabel : labels.confirmLabel;
}

/** A view without one group, by payee as the server matches it: what the card shows the moment a removal succeeds. */
export function withoutGroup<G extends { payee: string }>(ghosts: readonly G[], payee: string): G[] {
  const key = payeeKeyOf(payee);
  return ghosts.filter((g) => payeeKeyOf(g.payee) !== key);
}
