/**
 * Turning the migrations into a company template.
 *
 * A new company is a new schema holding the same tables, functions and policies
 * as the books that already exist. The way to build one is to replay the
 * migrations into it — but they were written for a single schema and say so in
 * two places that matter:
 *
 *   * 168 functions carry `set search_path = public`. Created in another schema
 *     with that line intact, a function would read *public's* tables. That is
 *     not a cosmetic problem: it is a company reading another company's ledger.
 *   * A handful of statements act on objects that are global to the database —
 *     storage policies, role settings, the register itself. Replaying those per
 *     company would not duplicate them; it would repeatedly *rewrite* the one
 *     copy, leaving it pointing at whichever company was provisioned last.
 *
 * So this module does two things and nothing else: split SQL into statements
 * without breaking function bodies, and decide for each statement whether it
 * belongs to a company or to the database as a whole. Both are pure, and both
 * are tested, because a mistake here is silent and expensive.
 */

/**
 * Split SQL into statements, respecting the quoting rules Postgres actually
 * uses. Naively splitting on `;` tears every function body in half — the
 * bodies are full of semicolons.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    // Dollar quoting: $$ ... $$ or $tag$ ... $tag$. Everything inside is
    // opaque, including semicolons and anything that looks like a comment.
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    const ch = sql[i];

    if (ch === "'") {
      // A single-quoted literal, where '' is an escaped quote.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        j += 1;
      }
      current += sql.slice(i, Math.min(j + 1, sql.length));
      i = j + 1;
      continue;
    }

    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === ";") {
      statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim() !== "") statements.push(current.trim());
  return statements.filter((s) => s !== "" && !isOnlyComment(s));
}

function isOnlyComment(statement: string): boolean {
  const withoutComments = statement
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .trim();
  return withoutComments === "";
}

/** Strip comments so a decision is made on the code, not on the prose. */
function code(statement: string): string {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type StatementScope =
  /** Belongs to one company; replay it into that company's schema. */
  | "company"
  /** Belongs to the database as a whole; a company must not touch it. */
  | "global";

/**
 * Objects that exist once for the whole database. Replaying any of these per
 * company would not give each company its own — it would keep overwriting the
 * single shared copy.
 */
const GLOBAL_MARKERS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bstorage\.objects\b/, why: "storage policies are global; one table serves every company" },
  { pattern: /\bstorage\.buckets\b/, why: "buckets are global" },
  { pattern: /^alter role\b/, why: "role settings are database-wide" },
  { pattern: /^create extension\b/, why: "extensions are installed once" },
  { pattern: /^create schema\b/, why: "the provisioner creates the schema itself" },
  { pattern: /\bonebook\./, why: "the company register must not be copied into a company" },
  { pattern: /^grant usage on schema\b/, why: "the provisioner grants its own schema" },
  { pattern: /^notify\b/, why: "a database-wide signal" },
];

export interface ScopedStatement {
  sql: string;
  scope: StatementScope;
  /** Why it was held back, when it was. */
  reason?: string;
}

export function scopeOf(statement: string): ScopedStatement {
  const text = code(statement);
  for (const { pattern, why } of GLOBAL_MARKERS) {
    if (pattern.test(text)) return { sql: statement, scope: "global", reason: why };
  }
  return { sql: statement, scope: "company" };
}

/**
 * Rewrite a statement so it builds inside `schema` instead of `public`.
 *
 * Four kinds of reference have to move, and the last two are the ones that
 * catch people out, because no amount of qualifier rewriting touches them:
 * the schema named as a *string* inside a catalog lookup, and an existence
 * guard that asks whether a type exists anywhere at all.
 *
 * `auth.` and `storage.` are left alone — those schemas really are shared.
 */
export function retargetToSchema(statement: string, schema: string): string {
  return (
    statement
      .replace(/\bset\s+search_path\s*=\s*public\b/gi, `set search_path = ${schema}`)
      .replace(/\bin\s+schema\s+public\b/gi, `in schema ${schema}`)
      .replace(/\bpublic\.([a-z_][a-z0-9_]*)/gi, `${schema}.$1`)
      // A catalog lookup written for one schema names it as a string. Left
      // alone, a migration provisioning one company reads — and in one case
      // re-grants against — the catalog of another.
      .replace(
        /\b(table_schema|nspname|schemaname|sequence_schema|routine_schema|specific_schema)(\s*=\s*)'public'/gi,
        `$1$2'${schema}'`,
      )
      // An existence guard on a type name alone finds the type in whichever
      // schema happens to have one, concludes the work is done, and leaves the
      // new company without it. The failure surfaces much later and far away,
      // as a table that cannot be created.
      .replace(
        /\bfrom\s+pg_type\s+where\s+typname\s*=/gi,
        "from pg_type where typnamespace = current_schema()::regnamespace and typname =",
      )
  );
}

export interface TemplatePlan {
  /** Statements to run inside the company's schema, in order. */
  statements: string[];
  /** What was held back, and why — reported rather than silently dropped. */
  skipped: { sql: string; reason: string }[];
}

/**
 * Everything needed to build one company's schema from the migration set.
 *
 * `sources` is the migration files in order. The register migration is excluded
 * by the caller; anything else global is caught here.
 */
export function planCompanySchema(
  sources: readonly { file: string; sql: string }[],
  schema: string,
): TemplatePlan {
  const statements: string[] = [];
  const skipped: { sql: string; reason: string }[] = [];

  for (const source of sources) {
    for (const raw of splitSqlStatements(source.sql)) {
      const scoped = scopeOf(raw);
      if (scoped.scope === "global") {
        skipped.push({ sql: `${source.file}: ${firstLine(raw)}`, reason: scoped.reason! });
        continue;
      }
      statements.push(retargetToSchema(raw, schema));
    }
  }

  return { statements, skipped };
}

function firstLine(statement: string): string {
  const line = code(statement);
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}
