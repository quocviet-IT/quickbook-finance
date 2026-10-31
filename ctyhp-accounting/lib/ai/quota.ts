import "server-only";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";

/** How many questions one person may put to the model in an hour (onebook.take_ai_turn, 0183). */
export const AI_TURNS_PER_HOUR = 60;

export type AiAllowance = "granted" | "limit" | "unavailable";

/** What the person is told when a question is not sent, by why it was not. */
export const AI_TURN_REFUSAL: Record<Exclude<AiAllowance, "granted">, string> = {
  limit: `You have asked the assistant ${AI_TURNS_PER_HOUR} questions in the past hour. Try again a little later.`,
  unavailable: "The assistant could not check how many questions you have asked. Try again in a minute.",
};

/**
 * Counts one question against the person's hourly allowance, or refuses it.
 *
 * Every question to the model is paid for, and a signed-in session — or a
 * stolen one — could otherwise ask in a loop. The count is kept in the
 * database, so it holds across every server instance, and the database decides
 * who is asking from the session itself. A count that cannot be taken does not
 * send the question: the model is a convenience, the bill is not.
 */
export async function takeAiTurn(): Promise<AiAllowance> {
  try {
    const control = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await control.rpc("take_ai_turn");
    if (error) {
      console.error("counting a question to the model failed:", error.message);
      return "unavailable";
    }
    return data === true ? "granted" : "limit";
  } catch (err) {
    console.error("counting a question to the model failed:", err instanceof Error ? err.message : err);
    return "unavailable";
  }
}
