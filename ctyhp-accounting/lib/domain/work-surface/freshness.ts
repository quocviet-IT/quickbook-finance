import type { SectionDataState } from "./types";

/**
 * When a figure on the screen has been there long enough to stop trusting.
 *
 * A rule, so it lives with the other rules rather than inside the component
 * that happens to draw it. It was in DataStateNote.tsx, which meant the one
 * question worth asking about staleness — where exactly is the line, and what
 * happens either side of it — could only be answered by reading a client
 * component, and could not be tested without one.
 */

/** A section older than this is worth flagging; the figures may have moved. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Judged against the *reader's* clock, which is why `now` is a parameter and
 * why the caller is in the browser. A page rendered on the server and left
 * open for an hour is stale even though nothing about the payload changed, and
 * the server has no way to know that.
 */
export function freshnessOf(generatedAt: string, now: number = Date.now()): SectionDataState {
  return now - Date.parse(generatedAt) > STALE_AFTER_MS ? "stale" : "fresh";
}
