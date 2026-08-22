/**
 * Ask the same question once per request.
 *
 * Two sections both want the ledger as of today: the controls, to say whether
 * the books balance, and the insights, to compare against last month. They are
 * deliberately independent — that independence is what stops one failing
 * section taking the page down — and the price of it was the same query twice.
 *
 * **This is a memo, not a cache**, and the distinction is the whole reason it
 * is safe. A cache outlives the request and must therefore answer two hard
 * questions: whose books are these, and how old is too old. Get either wrong in
 * a system where every company is its own schema and you serve one company's
 * figures to another. This map is created when a dashboard render begins and
 * dropped when it ends, so it never spans a request, a user, or a company, and
 * neither question arises. Section 10.5 of the design record governs anything
 * that does outlive a request; nothing here needs to.
 *
 * A rejected promise is stored like any other: two sections asking the same
 * failing question should both see the failure, not have the second one retry
 * a query that has just timed out. Each section's envelope handles its own
 * failure, which is the behaviour that was already there.
 */
export interface RequestMemo {
  <T>(key: string, load: () => Promise<T>): Promise<T>;
}

export function createRequestMemo(): RequestMemo {
  const pending = new Map<string, Promise<unknown>>();
  return function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const promise = load();
    pending.set(key, promise);
    return promise;
  };
}

/**
 * A memo that memoises nothing, for callers that have no request to scope one
 * to — a verification script, a test of one section on its own.
 *
 * Deliberately explicit rather than an optional parameter defaulting to
 * undefined: a section that silently ran unmemoised because a caller forgot to
 * pass one would be the old behaviour wearing the new interface.
 */
export const NO_MEMO: RequestMemo = (_key, load) => load();
