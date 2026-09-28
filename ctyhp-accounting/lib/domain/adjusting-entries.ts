import { z } from "zod";

/**
 * Marking a journal entry adjusting: the checkbox and note of the client's
 * prototype ("adj-toggle", "adj-note"). The mark is written by the database
 * (migration 0124); this is what the screen sends and what it gets back.
 */

export const ADJUSTING_NOTE_MAX = 500;

export const markAdjustingSchema = z.object({
  entryId: z.uuid(),
  note: z
    .string()
    .trim()
    .max(ADJUSTING_NOTE_MAX, `A note can be at most ${ADJUSTING_NOTE_MAX} characters`)
    .nullable(),
  confirmClosed: z.boolean(),
});

export const unmarkAdjustingSchema = z.object({
  entryId: z.uuid(),
  confirmClosed: z.boolean(),
});

/** An entry in a closed period, and where the closed period ends. */
export interface ClosedPeriodAsk {
  entryDate: string;
  closedThrough: string;
}

/** Done, or the prototype's question: this alters a closed period — go ahead? */
export type AdjustingResult = { kind: "done" } | { kind: "closed_period"; ask: ClosedPeriodAsk };

/** The database's closed-period refusal (`closed_period:<date>:<period end>`), or null for any other message. */
export function parseClosedPeriod(message: string): ClosedPeriodAsk | null {
  const m = /closed_period:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})/.exec(message);
  return m ? { entryDate: m[1], closedThrough: m[2] } : null;
}
