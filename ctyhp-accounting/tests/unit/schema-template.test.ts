import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planCompanySchema,
  retargetToSchema,
  scopeOf,
  splitSqlStatements,
} from "@/lib/domain/schema-template";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

describe("splitSqlStatements", () => {
  it("splits plain statements", () => {
    expect(splitSqlStatements("select 1; select 2;")).toEqual(["select 1", "select 2"]);
  });

  it("does not tear a function body in half", () => {
    const sql = `create function f() returns int language plpgsql as $$
begin
  perform 1;
  return 2;
end;
$$;
select 1;`;
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("perform 1;");
    expect(parts[0]).toContain("return 2;");
    expect(parts[1]).toBe("select 1");
  });

  it("respects a tagged dollar quote", () => {
    const sql = `do $body$ begin raise notice 'a; b'; end $body$; select 1;`;
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("raise notice 'a; b'");
  });

  it("leaves semicolons inside string literals alone", () => {
    const parts = splitSqlStatements(`insert into t values ('a;b'); select 1;`);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("'a;b'");
  });

  it("understands the doubled quote escape", () => {
    const parts = splitSqlStatements(`select 'it''s here; really'; select 2;`);
    expect(parts).toHaveLength(2);
  });

  it("ignores a semicolon inside a comment", () => {
    const parts = splitSqlStatements(`-- a; comment\nselect 1;\n/* another; one */\nselect 2;`);
    expect(parts).toHaveLength(2);
  });

  it("drops statements that are nothing but comments", () => {
    expect(splitSqlStatements("-- just a note\n\n/* and another */")).toEqual([]);
  });

  it("keeps a trailing statement with no semicolon", () => {
    expect(splitSqlStatements("select 1")).toEqual(["select 1"]);
  });
});

describe("scopeOf", () => {
  it("treats ordinary accounting objects as belonging to a company", () => {
    expect(scopeOf("create table acc_invoice (id uuid)").scope).toBe("company");
    expect(scopeOf("create policy p on acc_invoice for select using (true)").scope).toBe("company");
    expect(scopeOf("create or replace function acc_post_entry() returns uuid").scope).toBe("company");
  });

  it("holds back anything touching global storage", () => {
    const policy = scopeOf(
      `create policy read on storage.objects for select using (public.acc_has_permission('documents.read'))`,
    );
    expect(policy.scope).toBe("global");
    expect(policy.reason).toContain("storage policies are global");
  });

  it("holds back role settings and extensions", () => {
    expect(scopeOf("alter role authenticator set pgrst.db_schemas = 'public'").scope).toBe("global");
    expect(scopeOf("create extension if not exists pgcrypto").scope).toBe("global");
  });

  it("never copies the company register into a company", () => {
    expect(scopeOf("insert into onebook.company (slug) values ('x')").scope).toBe("global");
  });

  it("is not fooled by the word storage inside a comment", () => {
    const statement = "-- storage.objects is handled elsewhere\ncreate table acc_thing (id uuid)";
    expect(scopeOf(statement).scope).toBe("company");
  });
});

describe("retargetToSchema", () => {
  it("repoints a pinned search path — the whole reason this exists", () => {
    expect(
      retargetToSchema(
        "create function f() returns int language sql security definer set search_path = public as $$ select 1 $$",
        "co_north",
      ),
    ).toContain("set search_path = co_north");
  });

  it("repoints an explicit qualifier", () => {
    expect(retargetToSchema("revoke all on public.acc_invoice from anon", "co_north")).toBe(
      "revoke all on co_north.acc_invoice from anon",
    );
  });

  it("repoints default privileges", () => {
    expect(
      retargetToSchema("alter default privileges in schema public revoke all on tables from anon", "co_north"),
    ).toContain("in schema co_north");
  });

  it("leaves the shared schemas alone", () => {
    const sql = "select auth.uid(), storage.filename(name)";
    expect(retargetToSchema(sql, "co_north")).toBe(sql);
  });

  it("does not maul a word that merely contains public", () => {
    const sql = "comment on table acc_thing is 'republication rules'";
    expect(retargetToSchema(sql, "co_north")).toBe(sql);
  });
});

describe("planCompanySchema against the real migrations", () => {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("0081_"))
    .sort();
  const sources = files.map((file) => ({
    file,
    sql: readFileSync(join(MIGRATIONS, file), "utf8"),
  }));
  const plan = planCompanySchema(sources, "co_probe");

  it("produces a substantial plan from the whole migration set", () => {
    expect(files.length).toBeGreaterThan(70);
    expect(plan.statements.length).toBeGreaterThan(500);
  });

  it("leaves no statement pinned to public — the leak this guards against", () => {
    const pinned = plan.statements.filter((s) => /set\s+search_path\s*=\s*public\b/i.test(s));
    expect(pinned, "a function reading public's tables from another company's schema").toEqual([]);
  });

  it("leaves no explicit public. qualifier in what a company will run", () => {
    const qualified = plan.statements.filter((s) => /\bpublic\.[a-z_]/i.test(stripComments(s)));
    expect(qualified).toEqual([]);
  });

  it("holds back the global storage policies rather than rewriting them per company", () => {
    const storage = plan.skipped.filter((s) => s.reason.includes("storage"));
    expect(storage.length).toBeGreaterThan(0);
    expect(plan.statements.some((s) => /storage\.objects/i.test(s))).toBe(false);
  });

  it("reports everything it held back instead of dropping it silently", () => {
    for (const skipped of plan.skipped) {
      expect(skipped.reason.length).toBeGreaterThan(10);
      expect(skipped.sql).toContain(".sql:");
    }
  });

  it("still carries the tables a company needs", () => {
    const joined = plan.statements.join("\n").toLowerCase();
    for (const table of [
      "acc_journal_entry",
      "acc_journal_line",
      "acc_invoice",
      "acc_bill",
      "acc_account",
      "acc_app_user",
      "acc_sequence",
    ]) {
      expect(joined, `${table} must exist in a new company`).toContain(`create table ${table}`);
    }
  });
});

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("retargetToSchema and catalog lookups", () => {
  it("repoints a schema named as a string, which no qualifier rewrite would catch", () => {
    expect(
      retargetToSchema(
        "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'acc_bill'",
        "co_north",
      ),
    ).toContain("table_schema = 'co_north'");
    expect(retargetToSchema("where n.nspname = 'public'", "co_north")).toBe(
      "where n.nspname = 'co_north'",
    );
    expect(retargetToSchema("where schemaname = 'public'", "co_north")).toBe(
      "where schemaname = 'co_north'",
    );
  });

  it("makes a type-existence guard look in the company's own schema", () => {
    const guard = retargetToSchema(
      "if not exists (select 1 from pg_type where typname = 'acc_feedback_kind') then",
      "co_north",
    );
    expect(guard).toContain("typnamespace = current_schema()::regnamespace");
    expect(guard).toContain("typname = 'acc_feedback_kind'");
  });

  it("leaves a string that merely says public alone", () => {
    const sql = "insert into acc_thing (note) values ('published to public')";
    expect(retargetToSchema(sql, "co_north")).toBe(sql);
  });
});
