import type { SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

/**
 * A stand-in for supabase-js over one pg connection, so a live check can run
 * OneBook's own services and server actions inside a transaction it rolls
 * back: everything they write is seen by their next read and gone afterwards.
 *
 * It answers only the shapes those services use — a table read with eq, in,
 * is, gte, lte, order, limit, range, single and maybeSingle, its columns
 * plain or one level of embedded relation (`alias:table(cols)`, either way
 * round a foreign key); and an RPC, a set-returning one paged with order and
 * range, any other returning its value as PostgREST does. Anything else
 * throws, so a service that starts asking for more fails loudly rather than
 * being answered wrongly. It runs as the connection's current role and JWT
 * claims, so row-level security applies as it does for a signed-in user.
 */

// PostgREST sends days and times as text and whole numbers as numbers.
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1700, (value: string) => Number(value));

type Answer = { data: unknown; error: { message: string } | null };
type Run = (sql: string, params: unknown[]) => Promise<pg.QueryResult>;

const name = (text: string): string => {
  const trimmed = text.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(trimmed)) throw new Error(`pg-supabase: not a plain name: ${text}`);
  return `"${trimmed}"`;
};

/** Splits a select list on its top-level commas. */
function selectParts(columns: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of columns) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The foreign key between two tables, and which of them holds it. */
async function foreignKey(run: Run, base: string, other: string): Promise<{ manyToOne: boolean; column: string; refColumn: string }> {
  const { rows } = await run(
    `select c.conrelid = to_regclass($1) as base_holds, a.attname as col, fa.attname as ref
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
      where c.contype = 'f'
        and ((c.conrelid = to_regclass($1) and c.confrelid = to_regclass($2))
          or (c.conrelid = to_regclass($2) and c.confrelid = to_regclass($1)))`,
    [base, other],
  );
  if (rows.length !== 1) throw new Error(`pg-supabase: ${rows.length} foreign keys between ${base} and ${other}`);
  return { manyToOne: Boolean(rows[0].base_holds), column: rows[0].col as string, refColumn: rows[0].ref as string };
}

async function selectList(run: Run, table: string, columns: string): Promise<string> {
  const out: string[] = [];
  for (const part of selectParts(columns)) {
    if (part === "*") {
      out.push("t.*");
      continue;
    }
    const embed = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)\(([^()]*)\)$/.exec(part);
    if (!embed) {
      out.push(`t.${name(part)}`);
      continue;
    }
    const [, alias, other, inner] = embed;
    const fields = inner.split(",").map((c) => `'${c.trim()}', e.${name(c)}`).join(", ");
    const key = await foreignKey(run, table, other);
    out.push(
      key.manyToOne
        ? `(select json_build_object(${fields}) from ${name(other)} e where e.${name(key.refColumn)} = t.${name(key.column)}) as ${name(alias ?? other)}`
        : `(select coalesce(json_agg(json_build_object(${fields})), '[]'::json) from ${name(other)} e where e.${name(key.column)} = t.${name(key.refColumn)}) as ${name(alias ?? other)}`,
    );
  }
  return out.join(", ");
}

/** A value as an argument of the type the function declares: json goes as text, cast. */
function argument(value: unknown, type: string, params: unknown[]): string {
  const json = type === "json" || type === "jsonb";
  params.push(json && value !== null && value !== undefined ? JSON.stringify(value) : (value ?? null));
  return `$${params.length}::${type}`;
}

class Query implements PromiseLike<Answer> {
  private filters: string[] = [];
  private params: unknown[] = [];
  private orders: string[] = [];
  private window: { offset: number; limit: number | null } = { offset: 0, limit: null };
  private one: "single" | "maybe" | null = null;
  private columns = "*";

  constructor(
    private readonly run: Run,
    private readonly source: { table: string } | { rpc: string; args: Record<string, unknown> },
  ) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  private filter(column: string, op: string, value: unknown) {
    this.params.push(value);
    this.filters.push(`t.${name(column)} ${op} $${this.params.length}`);
    return this;
  }
  eq(column: string, value: unknown) {
    return this.filter(column, "=", value);
  }
  gte(column: string, value: unknown) {
    return this.filter(column, ">=", value);
  }
  lte(column: string, value: unknown) {
    return this.filter(column, "<=", value);
  }
  in(column: string, values: unknown[]) {
    this.params.push(values);
    this.filters.push(`t.${name(column)} = any($${this.params.length})`);
    return this;
  }
  is(column: string, value: null | boolean) {
    this.filters.push(`t.${name(column)} is ${value === null ? "null" : value ? "true" : "false"}`);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push(`t.${name(column)} ${options.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(n: number) {
    this.window.limit = n;
    return this;
  }
  range(from: number, to: number) {
    this.window = { offset: from, limit: to - from + 1 };
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  private async answer(): Promise<Answer> {
    try {
      if ("rpc" in this.source) return await this.callRpc(this.source.rpc, this.source.args);
      const from = `${name(this.source.table)} t`;
      const sql =
        `select ${await selectList(this.run, this.source.table, this.columns)} from ${from}` +
        (this.filters.length ? ` where ${this.filters.join(" and ")}` : "") +
        (this.orders.length ? ` order by ${this.orders.join(", ")}` : "") +
        (this.window.limit !== null ? ` limit ${this.window.limit}` : "") +
        (this.window.offset ? ` offset ${this.window.offset}` : "");
      const { rows } = await this.run(sql, this.params);
      return this.shaped(rows);
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  private shaped(rows: unknown[]): Answer {
    if (this.one === null) return { data: rows, error: null };
    if (rows.length > 1 || (this.one === "single" && rows.length === 0)) {
      return { data: null, error: { message: `pg-supabase: ${rows.length} rows where one was asked for` } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  private async callRpc(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const { rows: kinds } = await this.run(
      `select p.proretset as set, t.typtype as type, t.typname as type_name,
              coalesce(p.proargnames, '{}') as arg_names, coalesce(p.proargmodes::text[], '{}') as arg_modes,
              array(select format_type(a, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) a) as arg_types
         from pg_proc p join pg_type t on t.oid = p.prorettype
        where p.proname = $1 and p.pronamespace = any (select oid from pg_namespace where nspname = any (current_schemas(false)))`,
      [fn],
    );
    if (kinds.length !== 1) throw new Error(`pg-supabase: ${kinds.length} functions named ${fn}`);
    const { set, type, type_name: typeName, arg_names: argNames, arg_modes: argModes, arg_types: argTypes } = kinds[0] as {
      set: boolean;
      type: string;
      type_name: string;
      arg_names: string[];
      arg_modes: string[];
      arg_types: string[];
    };
    const inputs = new Map(argNames.flatMap((n, i) => (argModes.length === 0 || argModes[i] === "i" || argModes[i] === "b" ? [[n, argTypes[i]]] : [])));
    const params: unknown[] = [];
    const call = `${name(fn)}(${Object.entries(args)
      .map(([k, v]) => {
        const declared = inputs.get(k);
        if (!declared) throw new Error(`pg-supabase: ${fn} has no argument ${k}`);
        return `${name(k)} => ${argument(v, declared, params)}`;
      })
      .join(", ")})`;
    if (set || type === "c" || typeName === "record") {
      const sql =
        `select * from ${call} t` +
        (this.orders.length ? ` order by ${this.orders.join(", ")}` : "") +
        (this.window.limit !== null ? ` limit ${this.window.limit}` : "") +
        (this.window.offset ? ` offset ${this.window.offset}` : "");
      const { rows } = await this.run(sql, params);
      return set ? this.shaped(rows) : { data: rows[0] ?? null, error: null };
    }
    if (this.orders.length || this.window.limit !== null) throw new Error(`pg-supabase: ${fn} returns one value; it cannot be paged`);
    const { rows } = await this.run(`select ${call} as value`, params);
    return { data: typeName === "void" ? null : rows[0]?.value ?? null, error: null };
  }

  then<A = Answer, B = never>(onFulfilled?: ((value: Answer) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.answer().then(onFulfilled, onRejected);
  }
}

/** A supabase-js client that is really one pg connection, mid-transaction. */
export function pgSupabase(client: pg.Client): SupabaseClient {
  // One connection answers one query at a time: the services' parallel reads queue here.
  let queue: Promise<unknown> = Promise.resolve();
  const run: Run = (sql, params) => {
    const next = queue.then(() => client.query(sql, params));
    queue = next.catch(() => undefined);
    return next;
  };
  const sb = {
    from: (table: string) => new Query(run, { table }),
    rpc: (fn: string, args: Record<string, unknown> = {}) => new Query(run, { rpc: fn, args }),
  };
  return sb as unknown as SupabaseClient;
}
