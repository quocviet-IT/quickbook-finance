import "server-only";
import { headers } from "next/headers";

/**
 * Whether this render is the answer to a Server Action.
 *
 * After an action calls `revalidatePath`, Next renders the page again inside
 * the action's own response. The screen is already on the reader's display
 * and keeps its own state, so a read that only its first paint uses (the
 * opening lines on Bank Transactions, the opening account on Reconcile)
 * would be paid for on every save and thrown away. A page skips such reads
 * when this says yes.
 */
export async function isServerActionRender(): Promise<boolean> {
  // `next-action` is the header Next sends with every Server Action
  // (ACTION_HEADER in next/dist/client/components/app-router-headers).
  return (await headers()).has("next-action");
}
