import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A PostgREST client that answers from the test's handlers and counts every
 * request it sends: one per awaited query or RPC, one per page of a paged read.
 */
export type Answer = { data?: unknown; count?: number | null; error?: { message: string } | null };

export interface Query {
  table: string;
  select: string;
  head: boolean;
  filters: [string, string, unknown][];
  order: [string, boolean][];
  limit: number | null;
  range: [number, number] | null;
}

export interface FakeHandlers {
  rpc?: Record<string, (args: Record<string, unknown>) => Answer>;
  tables?: Record<string, (query: Query) => Answer>;
}

export function filterValue(query: Query, op: string, column: string): unknown {
  return query.filters.find(([o, c]) => o === op && c === column)?.[2];
}

export function fakeSupabase(handlers: FakeHandlers) {
  const requests: string[] = [];

  const settle = (label: string, answer: Answer | undefined, range: [number, number] | null) => {
    requests.push(label);
    const value = answer ?? { data: [] };
    if (value.error) return { data: null, count: null, error: value.error };
    const rows = value.data;
    const data = Array.isArray(rows) && range ? rows.slice(range[0], range[1] + 1) : rows ?? null;
    return { data, count: value.count ?? (Array.isArray(rows) ? rows.length : null), error: null };
  };

  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {
      order: () => builder,
      range: (from: number, to: number) => ((range = [from, to]), builder),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(settle(`rpc:${name}`, handlers.rpc?.[name]?.(args), range)));
        } catch (cause) {
          return reject ? Promise.resolve(reject(cause)) : Promise.reject(cause);
        }
      },
    };
    return builder;
  };

  const from = (table: string) => {
    const query: Query = { table, select: "", head: false, filters: [], order: [], limit: null, range: null };
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string, options?: { head?: boolean }) => {
      query.select = columns;
      query.head = Boolean(options?.head);
      return builder;
    };
    for (const op of ["eq", "neq", "gt", "gte", "lt", "lte", "is", "in"]) {
      builder[op] = (column: string, value: unknown) => (query.filters.push([op, column, value]), builder);
    }
    builder.order = (column: string, options?: { ascending?: boolean }) => (query.order.push([column, options?.ascending ?? true]), builder);
    builder.limit = (n: number) => ((query.limit = n), builder);
    builder.range = (a: number, b: number) => ((query.range = [a, b]), builder);
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      try {
        const answer = handlers.tables?.[table]?.(query);
        const result = settle(`from:${table}`, answer, query.range);
        return Promise.resolve(resolve(query.head ? { ...result, data: null } : result));
      } catch (cause) {
        return reject ? Promise.resolve(reject(cause)) : Promise.reject(cause);
      }
    };
    return builder;
  };

  const sb = { rpc, from } as unknown as SupabaseClient;
  return { sb, requests };
}
