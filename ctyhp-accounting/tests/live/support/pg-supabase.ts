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

/** An embedded relation: how its rows meet the base row, and whether `!inner` asks that one exists. */
interface Relation {
  table: string;
  join: string;
  inner: boolean;
}

async function selectList(run: Run, table: string, columns: string): Promise<{ list: string; relations: Map<string, Relation> }> {
  const out: string[] = [];
  const relations = new Map<string, Relation>();
  for (const part of selectParts(columns)) {
    if (part === "*") {
      out.push("t.*");
      continue;
    }
    const embed = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:!([a-z_]+))?\(([^()]*)\)$/.exec(part);
    if (!embed) {
      out.push(`t.${name(part)}`);
      continue;
    }
    const [, alias, other, hint, inner] = embed;
    if (hint && hint !== "inner") throw new Error(`pg-supabase: the embed hint !${hint} is not answered`);
    const fields = inner.split(",").map((c) => `'${c.trim()}', e.${name(c)}`).join(", ");
    const key = await foreignKey(run, table, other);
    const join = key.manyToOne
      ? `e.${name(key.refColumn)} = t.${name(key.column)}`
      : `e.${name(key.column)} = t.${name(key.refColumn)}`;
    relations.set(alias ?? other, { table: other, join, inner: hint === "inner" });
    out.push(
      key.manyToOne
        ? `(select json_build_object(${fields}) from ${name(other)} e where ${join}) as ${name(alias ?? other)}`
        : `(select coalesce(json_agg(json_build_object(${fields})), '[]'::json) from ${name(other)} e where ${join}) as ${name(alias ?? other)}`,
    );
  }
  return { list: out.join(", "), relations };
}

/** A value as an argument of the type the function declares: json goes as text, cast. */
function argument(value: unknown, type: string, params: unknown[]): string {
  const json = type === "json" || type === "jsonb";
  params.push(json && value !== null && value !== undefined ? JSON.stringify(value) : (value ?? null));
  return `$${params.length}::${type}`;
}

class Query implements PromiseLike<Answer> {
  private filters: string[] = [];
  /** Filters on an embedded relation's column ("acc_journal_entry.status"): they keep only the rows it has a match for. */
  private embedFilters: { relation: string; condition: string }[] = [];
  private params: unknown[] = [];
  private orders: string[] = [];
  private window: { offset: number; limit: number | null } = { offset: 0, limit: null };
  private one: "single" | "maybe" | null = null;
  private columns = "*";

  constructor(
    private readonly run: Run,
    private readonly source: { table: string } | { rpc: string; args: Record<string, unknown> },
  ) {}

  /** A write: the row(s) to insert, or the columns to set on the rows the filters keep. */
  private write: { kind: "insert"; rows: Record<string, unknown>[] } | { kind: "update"; values: Record<string, unknown> } | null = null;

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.write = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  update(values: Record<string, unknown>) {
    this.write = { kind: "update", values };
    return this;
  }
  private filter(column: string, op: string, value: unknown) {
    this.params.push(value);
    const [relation, field] = column.includes(".") ? column.split(".") : [null, column];
    if (relation) this.embedFilters.push({ relation, condition: `e.${name(field)} ${op} $${this.params.length}` });
    else this.filters.push(`t.${name(column)} ${op} $${this.params.length}`);
    return this;
  }
  not(column: string, op: string, value: unknown) {
    if (op !== "is" || value !== null) throw new Error(`pg-supabase: not(${column}, ${op}) is not answered`);
    this.filters.push(`t.${name(column)} is not null`);
    return this;
  }
  eq(column: string, value: unknown) {
    return this.filter(column, "=", value);
  }
  /** PostgREST's `neq`: a null never matches, as in SQL. */
  neq(column: string, value: unknown) {
    return this.filter(column, "<>", value);
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
      if (this.write) return await this.answerWrite(this.source.table, this.write);
      const from = `${name(this.source.table)} t`;
      const { list, relations } = await selectList(this.run, this.source.table, this.columns);
      // An `!inner` embed, or one a filter names, keeps only the rows it has a match for.
      const exists = [...relations].flatMap(([key, relation]) => {
        const conditions = this.embedFilters.filter((f) => f.relation === key).map((f) => f.condition);
        if (!relation.inner && conditions.length === 0) return [];
        return [`exists (select 1 from ${name(relation.table)} e where ${[relation.join, ...conditions].join(" and ")})`];
      });
      const unknown = this.embedFilters.find((f) => !relations.has(f.relation));
      if (unknown) throw new Error(`pg-supabase: a filter names ${unknown.relation}, which is not embedded`);
      const where = [...this.filters, ...exists];
      const sql =
        `select ${list} from ${from}` +
        (where.length ? ` where ${where.join(" and ")}` : "") +
        (this.orders.length ? ` order by ${this.orders.join(", ")}` : "") +
        (this.window.limit !== null ? ` limit ${this.window.limit}` : "") +
        (this.window.offset ? ` offset ${this.window.offset}` : "");
      const { rows } = await this.run(sql, this.params);
      return this.shaped(rows);
    } catch (e) {
      // PostgREST hands the SQLSTATE on as `code` (23505, P0002, 42501), and
      // services branch on it, so the shim does too.
      const code = (e as { code?: unknown }).code;
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : String(e), ...(typeof code === "string" ? { code } : {}) },
      };
    }
  }

  /** An insert of plain columns, or an update of the rows the plain filters keep; returns what `select` named. */
  private async answerWrite(
    table: string,
    write: { kind: "insert"; rows: Record<string, unknown>[] } | { kind: "update"; values: Record<string, unknown> },
  ): Promise<Answer> {
    if (this.embedFilters.length) throw new Error("pg-supabase: a write cannot filter on an embedded relation");
    const returning = this.columns === "*" ? "*" : selectParts(this.columns).map(name).join(", ");
    const params = [...this.params];
    const value = (v: unknown) => {
      params.push(v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
      return `$${params.length}`;
    };
    let sql: string;
    if (write.kind === "insert") {
      const columns = Object.keys(write.rows[0] ?? {});
      if (!columns.length) throw new Error("pg-supabase: nothing to insert");
      const tuples = write.rows.map((row) => `(${columns.map((c) => value(row[c] ?? null)).join(", ")})`).join(", ");
      sql = `insert into ${name(table)} (${columns.map(name).join(", ")}) values ${tuples} returning ${returning}`;
    } else {
      const sets = Object.entries(write.values).map(([c, v]) => `${name(c)} = ${value(v)}`).join(", ");
      sql = `update ${name(table)} as t set ${sets}${this.filters.length ? ` where ${this.filters.join(" and ")}` : ""} returning ${returning}`;
    }
    const { rows } = await this.run(sql, params);
    return this.shaped(rows);
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
