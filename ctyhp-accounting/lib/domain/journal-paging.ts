/**
 * How the Journal screen pages (2.93). Pure, so the screen and the server read
 * the same numbers without the screen importing the service.
 */

/** The page sizes the Journal offers. */
export const JOURNAL_PAGE_SIZES = [10, 20, 50, 100] as const;

export const JOURNAL_DEFAULT_PAGE_SIZE = 20;

/** A page size the Journal offers: the one asked for, or the next above it, never more than the largest. */
export function journalPageSize(asked: number): number {
  if (!Number.isFinite(asked)) return JOURNAL_DEFAULT_PAGE_SIZE;
  return JOURNAL_PAGE_SIZES.find((size) => size >= asked) ?? JOURNAL_PAGE_SIZES[JOURNAL_PAGE_SIZES.length - 1];
}
