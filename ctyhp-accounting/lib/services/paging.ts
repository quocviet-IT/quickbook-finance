/** The page size every reader below pages at — PostgREST's own row cap. */
export const PAGE_SIZE = 1000;

export type PageResult = { data: unknown; error: { message: string } | null };

/**
 * Read every page of a query or RPC past PostgREST's 1,000-row cap.
 *
 * `db-max-rows` caps rows fetched from "a view, table, or stored procedure"
 * alike, and PostgREST reports no error when it truncates — a call that never
 * asks for a range just gets the first page back, silently short past 1,000
 * rows. This pages with `.range()` until a page comes back shorter than the
 * page size.
 *
 * Only correct when the query or RPC orders its rows totally, so a row can
 * never straddle a page boundary and shift between two reads. Each caller
 * below carries its own proof of that by its own ordering; paging a new query
 * first needs the same proof.
 *
 * `fail` builds the error each caller throws, so a page's failure keeps that
 * caller's own error type and message instead of a generic one.
 */
export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
  fail: (message: string) => Error,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw fail(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    // A short page is the last page. Asking again would cost a round trip to
    // be told the same thing.
    if (page.length < PAGE_SIZE) return rows;
  }
}
