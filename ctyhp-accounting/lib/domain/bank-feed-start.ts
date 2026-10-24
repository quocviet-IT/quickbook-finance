/**
 * Where a bank feed starts, and what it skipped (2.48).
 *
 * Connecting a bank fetches about six months of its history. A company that
 * had imported its statements for those months would have had every line
 * twice in Bank Transactions. The guards are in the database (0161): a line
 * dated before the account's start date is skipped, and from then on a posted
 * line is skipped when the account already holds a line of the same amount
 * dated within FEED_TWIN_DAYS of it from somewhere else. These are the defaults
 * and the words the screen puts around them.
 */
import { formatDate, plural } from "@/lib/format";

/** How far either side of a feed line's date a line already here may be dated (0161). */
export const FEED_TWIN_DAYS = 2;

/** What one sync, or one connection's first sync, skipped. */
export interface FeedSkips {
  /** Dated before the account's start date. */
  beforeStart: number;
  /** The same amount, dated within FEED_TWIN_DAYS, already in OneBook from somewhere else. */
  alreadyHere: number;
}

export const NO_SKIPS: FeedSkips = { beforeStart: 0, alreadyHere: 0 };

/**
 * The date Connect bank offers for an account: the date of its last line
 * already in OneBook, so the feed picks up where the statements stopped. That
 * day itself is fetched, and its lines already here are recognized: a
 * statement downloaded mid-morning holds only part of its last day. None when
 * the account holds no line yet: then the feed brings in all it is sent.
 */
export function defaultFeedStart(lastLineOn: string | null | undefined): string | null {
  return lastLineOn ?? null;
}

/** The sentence under an account's start date in Connect bank. */
export function feedStartNote(startsOn: string | null, lastLineOn: string | null): string {
  const twins = `A line already in OneBook (the same amount, dated within ${FEED_TWIN_DAYS} days) is skipped`;
  const last = lastLineOn ? ` This account's last line in OneBook is dated ${formatDate(lastLineOn)}.` : "";
  if (startsOn) {
    return `Lines dated before ${formatDate(startsOn)} are skipped. ${twins} too.${last}`;
  }
  if (lastLineOn) {
    return `All the history the bank sends is brought in, about the last 6 months. ${twins}.${last}`;
  }
  return "Nothing is in OneBook for this account yet, so all the history the bank sends is brought in, about the last 6 months.";
}

/** "12 lines already in OneBook and 40 dated before the feed's start", or null when nothing was skipped. */
export function skippedPhrase(skips: FeedSkips): string | null {
  const parts: string[] = [];
  if (skips.alreadyHere > 0) parts.push(`${plural(skips.alreadyHere, "line")} already in OneBook`);
  if (skips.beforeStart > 0) {
    parts.push(
      skips.alreadyHere > 0
        ? `${skips.beforeStart} dated before the feed's start`
        : `${plural(skips.beforeStart, "line")} dated before the feed's start`,
    );
  }
  return parts.length ? parts.join(" and ") : null;
}

/** The message after Connect and synchronize. */
export function connectedMessage(result: { added: number; suggestions: number } & FeedSkips): string {
  const skipped = skippedPhrase(result);
  const imported = `Imported ${plural(result.added, "transaction")}`;
  const suggested = `created ${plural(result.suggestions, "match suggestion")}`;
  return skipped
    ? `Bank connected. ${imported}, skipped ${skipped}, and ${suggested}.`
    : `Bank connected. ${imported} and ${suggested}.`;
}

/** The message after Sync now. */
export function syncedMessage(
  result: { added: number; modified: number; removed: number; suggestions: number } & FeedSkips,
): string {
  const skipped = skippedPhrase(result);
  return (
    `Synchronized: ${result.added} new, ${result.modified} updated, ${result.removed} removed` +
    (skipped ? `, skipped ${skipped}` : "") +
    `, ${plural(result.suggestions, "match suggestion")}.`
  );
}

/** A date OneBook can store as where a feed starts: an ISO calendar date, or none. */
export function validFeedStart(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("The date a bank feed starts must be a calendar date");
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error("The date a bank feed starts must be a calendar date");
  }
  return value;
}
