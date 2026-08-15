import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The mistake this test exists to catch: 0114_backups.sql created acc_backup
// with no grant or revoke statement at all. 0080 had already made every
// future table unreachable by default (see findFailClosedBoundary below), so
// the table shipped readable by nobody but its owner — in every company that
// already existed, silently, because a brand-new company gets a blanket grant
// sweep (lib/services/company-provisioning.ts) that papered over the gap for
// itself alone. Four green gates and the provisioning self-check all passed
// over it. This test reads the migrations themselves and would not have.

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/**
 * Comments stripped the same way tests/unit/backup-migration.test.ts strips
 * them, and for the same reason: a Windows checkout ends lines with \r\n, `.`
 * does not match \r, and a stripper written as /--.*$/ over the raw file
 * removes nothing on this checkout — every assertion below would then pass on
 * a sentence sitting in a comment instead of a real statement. This has
 * bitten this repository twice. Block comments are stripped too: several
 * migrations document a function with a JSDoc-style block-comment header (see
 * 0102, 0114), and that prose can contain the same words a `--` comment can.
 */
function stripComments(raw: string): string {
  const withoutBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function readBody(file: string): string {
  return stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

/**
 * Every table created in this migration's body, in the order it appears.
 *
 * Matches `create table` and `create table if not exists`, schema-qualified
 * or not (`onebook.company`, `acc_backup`). Verified once, by hand, against
 * all 115 migrations at the time this test was written: this codebase has no
 * temporary table and no `create table ... as select`, so every match here is
 * a table the application can query, not a scratch object local to one
 * statement.
 */
function tablesCreatedIn(body: string): string[] {
  const re =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\(/gi;
  const tables: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) tables.push(match[1]);
  return tables;
}

/**
 * The role list after a grant statement's `to`, with `public` and `anon` set
 * aside.
 *
 * Those two are never a legitimate holder of access to one of these tables:
 * every table in scope sits behind RLS keyed to a signed-in company member
 * (0080's whole reason for existing is to make that the default, not an
 * opt-in), so a grant naming only `public`/`anon` is not a developer
 * connecting the table to its consumers — it is the same missing-grant defect
 * wearing grant-shaped SQL. Deliberately not pinned to `authenticated` and
 * `service_role` by name: those are the two roles every table in this
 * codebase happens to use today (checked against 0081, 0098, 0101, 0102,
 * 0114), but enumerating them here would make this test start failing the
 * day a legitimate third role — a read-only reporting role, say — is
 * introduced. "Not public, not anon" is the invariant this test can actually
 * defend without being rewritten each time a new table's access pattern
 * varies.
 */
function grantsUsableRole(statement: string): boolean {
  const match = /\bto\s+([\s\S]+)$/i.exec(statement);
  if (!match) return false;
  return match[1]
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .some((role) => role.length > 0 && role !== "public" && role !== "anon");
}

/**
 * Whether some `grant` statement in this file gives `table` to a role that
 * can actually reach it.
 *
 * A `revoke` naming the table is not evidence of anything: 0080 already
 * revokes everything from every future table by default, so a migration that
 * only revokes leaves the table exactly as unreachable as one that says
 * nothing at all — and a table that ships with `revoke all ... from public,
 * anon` reads, at a glance, like the developer handled grants, when nothing
 * was actually granted to a role that can use it. Only a `grant` counts, and
 * only when grantsUsableRole says the role list is more than `public`/`anon`.
 *
 * A table grant in this codebase is always a top-level `grant`/`revoke`
 * statement, one per line, never assembled inside a `do $$ ... $$` block —
 * that dynamic-SQL shape is used here only for function grants (0080), which
 * this excludes anyway. Splitting on `;` is therefore safe for the statements
 * this test looks at, even though it would mis-split a dollar-quoted body.
 *
 * `grant execute on function f(text)` and `grant usage on sequence s` both
 * read "grant" without granting anything on the table itself, so both are
 * excluded rather than counted as evidence. Table names are matched on a word
 * boundary so `acc_import_batch`'s grant cannot be mistaken for covering
 * `acc_import_batch_entry` — a different table, with its own grant line right
 * next to it in 0102.
 */
function grantsName(body: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namesTable = new RegExp(`\\b${escaped}\\b`, "i");
  return body
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => /^grant\s/i.test(statement))
    .filter((statement) => !/\bfunction\b/i.test(statement) && !/\bsequence\b/i.test(statement))
    .filter((statement) => namesTable.test(statement))
    .some((statement) => grantsUsableRole(statement));
}

/**
 * The migration that made a bare `create table` insufficient on its own.
 *
 * 0080 revoked default privileges from `public` and `anon` for future objects
 * in schema `public`; 0081 did the same for schema `onebook` the moment that
 * schema was born. A table created before whichever of those statements
 * covers its schema inherited the platform's normal default — Supabase's
 * `public` schema was reachable by `anon`/`authenticated` out of the box
 * before 0080 narrowed it, which is the very thing 0080 says it is for. A
 * table created after it starts owning nothing until its own migration says
 * otherwise, and a new company's blanket grant sweep at creation
 * (lib/services/company-provisioning.ts) covers a table like that only for
 * companies provisioned after the table shipped — never for one already
 * running, which has no such sweep to fall back on
 * (scripts/migrate.mjs:migrateCompany applies each migration's own SQL and
 * nothing more).
 *
 * Found by content, not by number, so renumbering this migration does not
 * silently stop finding it — and the first test below fails loudly if the
 * wording it looks for is ever reworded instead of just moved.
 */
function findFailClosedBoundary(files: readonly string[]): string {
  const marksBoundary =
    /alter\s+default\s+privileges\s+in\s+schema\s+\w+\s+revoke\s+all\s+on\s+tables\s+from\s+public/i;
  const boundary = files.find((file) => marksBoundary.test(readBody(file)));
  if (!boundary) {
    throw new Error(
      "No migration sets default privileges to revoke all on tables from public. " +
        "The fail-closed boundary this test relies on is gone or was reworded — fix this " +
        "test's pattern, do not delete it: without that boundary a table can ship unreachable " +
        "again with nothing here to catch it.",
    );
  }
  return boundary;
}

/**
 * Whether `body` (a table-creating migration's own text) contains a
 * `security definer` function whose body names `table`.
 *
 * This is the one category EXEMPT_TABLES actually uses: a table nothing but
 * a security-definer function ever touches needs no grant of its own,
 * because that function runs with its owner's privileges, not the caller's —
 * a grant-checked path never reaches the table at all. That is a checkable
 * claim, so this checks it instead of trusting the prose next to it.
 *
 * Matches `create [or replace] function ... security definer ... as $$
 * ...body... $$` and requires `security definer` in the header (the part
 * before `as $$`) and `table` inside the body (the part between `$$`s) —
 * not just anywhere in the whole statement, so a function merely named after
 * the table, or one whose only mention is in a comment already stripped by
 * stripComments, does not count. This codebase's functions after the
 * fail-closed boundary are always `$$`-quoted (checked against every
 * migration after 0080, 2026-08-15); the `$tag$` form used for dynamic SQL
 * elsewhere in this repository appears only before that boundary, a shape
 * this check does not need to understand.
 */
function hasSecurityDefinerFunctionNaming(body: string, table: string): boolean {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namesTable = new RegExp(`\\b${escaped}\\b`, "i");
  const functionRe = /create\s+(?:or\s+replace\s+)?function\s+([\s\S]*?)\bas\s+\$\$([\s\S]*?)\$\$/gi;
  let match: RegExpExecArray | null;
  while ((match = functionRe.exec(body))) {
    const [, header, functionBody] = match;
    if (/\bsecurity\s+definer\b/i.test(header) && namesTable.test(functionBody)) return true;
  }
  return false;
}

/**
 * The one exemption reason this test knows how to check for itself. Adding a
 * second requires writing its own verification function alongside a new
 * member of this union — a developer cannot get a new category of exemption
 * past this test by editing a string; the type only accepts the kind this
 * file already knows how to verify, so any other claim is rejected by the
 * compiler before the test even runs.
 */
type Exemption = {
  kind: "security-definer-only";
  reason: string;
};

/**
 * Whether `exemption`'s claim actually holds for the migration that created
 * `table`. A reason long enough to read as considered is necessary but not
 * sufficient — see the false-claim case in the describe block below, which
 * this line alone used to let through.
 */
function exemptionIsVerified(body: string, table: string, exemption: Exemption): boolean {
  if (exemption.reason.length <= 20) return false;
  switch (exemption.kind) {
    case "security-definer-only":
      return hasSecurityDefinerFunctionNaming(body, table);
    default: {
      // Exhaustiveness guard: a new `kind` added to the Exemption union
      // without a matching case here fails to compile, not silently passes.
      const unreachable: never = exemption.kind;
      throw new Error(`no verification wired up for exemption kind ${String(unreachable)}`);
    }
  }
}

/**
 * Tables created after the boundary that legitimately carry no grant of their
 * own in the same migration.
 *
 * Keep this short, and name the reason for every entry. An exemption list
 * that only ever grows is worse than no test at all: it becomes the place a
 * real miss gets buried instead of caught, which is exactly the failure mode
 * this test exists to close off.
 */
const EXEMPT_TABLES: Readonly<Record<string, Exemption>> = {
  acc_afda_rate: {
    kind: "security-definer-only",
    reason:
      "Read and written only inside acc_afda_evaluation, acc_afda_balance and " +
      'acc_post_afda_adjustment (0093), all `security definer` — those run with the function ' +
      "owner's privileges, not the caller's, so no application code ever reaches this table " +
      'through a grant-checked path. Confirmed: no `.from("acc_afda_rate")` anywhere under ' +
      "app/ or lib/ (grep, 2026-08-15). Its own two RLS policies (acc_afda_rate_read, " +
      "acc_afda_rate_write) are consequently unreachable through PostgREST too, which is a " +
      "separate, smaller finding — not one this test is scoped to fix.",
  },
};

describe("a table-creating migration carries its own grants", () => {
  const files = migrationFiles();
  const boundary = findFailClosedBoundary(files);

  it("finds the migration that made new tables fail closed", () => {
    // A boundary that silently stopped matching would make every case below
    // vacuously pass instead of failing loudly — the one outcome worse than
    // not having this test at all.
    expect(boundary).toBe("0080_production_security_hardening.sql");
  });

  const inScope = files.filter((file) => file > boundary);
  const cases: Array<{ file: string; table: string }> = [];
  for (const file of inScope) {
    for (const table of tablesCreatedIn(readBody(file))) cases.push({ file, table });
  }

  it("found tables to check, including the one this test was written for", () => {
    // A sanity check on the scan itself: an empty list here means the glob or
    // the regex broke, and every "no violation" below would be a false pass
    // rather than a real one.
    const tables = cases.map((c) => c.table);
    expect(tables).toContain("acc_backup");
    expect(tables).toContain("acc_import_batch");
    expect(tables).toContain("acc_import_batch_entry");
  });

  it.each(cases)("$table ($file) grants a role, or is explicitly exempted", ({ file, table }) => {
    const exemption = EXEMPT_TABLES[table];
    if (exemption !== undefined) {
      const body = readBody(file);
      expect(
        exemptionIsVerified(body, table, exemption),
        `the exemption for ${table} (kind "${exemption.kind}") does not hold up against ` +
          `${file} — either the claim was never true, or the migration changed under it. ` +
          "A long reason is not enough; this test checks the claim itself.",
      ).toBe(true);
      return;
    }
    const body = readBody(file);
    expect(
      grantsName(body, table),
      `${file} creates ${table} but no grant/revoke statement in the same file names it. ` +
        `Every table created after ${boundary} inherits its schema's fail-closed default and ` +
        "is unreachable by authenticated and service_role until its own migration grants a " +
        "role — see the migration this repository shipped that in.",
    ).toBe(true);
  });

  it("exempts no table that isn't actually in scope", () => {
    // An orphaned entry stops meaning anything the day the table it names is
    // renamed or dropped, and nothing would say so without this.
    const known = new Set(cases.map((c) => c.table));
    for (const table of Object.keys(EXEMPT_TABLES)) {
      expect(known.has(table), `${table} is exempted but no in-scope migration creates it`).toBe(
        true,
      );
    }
  });
});

// RED CHECKPOINT (hole 1): with grantsName unchanged, both cases below fail —
// a revoke-only statement and a grant to anon/public alone both read as
// "names the table" under the presence-only check, which is exactly the
// mistake acc_backup shipped with. Left in as a permanent regression test.
describe("grantsName requires real evidence of access, not just a mention", () => {
  it("does not count a table named only in a revoke statement", () => {
    const body = "create table acc_foo (id uuid primary key); " +
      "revoke all on table acc_foo from public, anon;";
    expect(grantsName(body, "acc_foo")).toBe(false);
  });

  it("does not count a grant naming only anon", () => {
    const body = "grant select on table acc_foo to anon;";
    expect(grantsName(body, "acc_foo")).toBe(false);
  });

  it("does not count a grant naming only public and anon together", () => {
    const body = "grant select on table acc_foo to public, anon;";
    expect(grantsName(body, "acc_foo")).toBe(false);
  });

  it("counts a grant naming a role that can actually use the table", () => {
    const body = "revoke all on table acc_foo from public, anon; " +
      "grant select on table acc_foo to authenticated;";
    expect(grantsName(body, "acc_foo")).toBe(true);
  });

  it("still excludes a function grant that happens to share the table's name", () => {
    const body = "grant execute on function acc_foo(text) to authenticated;";
    expect(grantsName(body, "acc_foo")).toBe(false);
  });
});

// RED CHECKPOINT (hole 2): a reason gate that only measures string length
// lets this false claim through — the migration below never mentions
// `security definer` at all, so the exemption is simply wrong, and nothing
// caught that before exemptionIsVerified checked the claim itself. Left in
// as a permanent regression test.
describe("an exemption's reason is checked against the migration, not just present", () => {
  it("rejects a security-definer-only claim the migration does not back up", () => {
    const body = "create table acc_foo (id uuid primary key);";
    const falseExemption: Exemption = {
      kind: "security-definer-only",
      reason: "Only ever touched by a security definer function, nothing to worry about here.",
    };
    expect(exemptionIsVerified(body, "acc_foo", falseExemption)).toBe(false);
  });

  it("rejects a security definer function that never actually mentions the table", () => {
    const body = `
      create table acc_foo (id uuid primary key);
      create or replace function unrelated() returns void
      language sql security definer as $$
        select 1;
      $$;
    `;
    const falseExemption: Exemption = {
      kind: "security-definer-only",
      reason: "Only ever touched by a security definer function, nothing to worry about here.",
    };
    expect(exemptionIsVerified(body, "acc_foo", falseExemption)).toBe(false);
  });

  it("rejects a function that names the table but is not security definer", () => {
    const body = `
      create table acc_foo (id uuid primary key);
      create or replace function reads_foo() returns void
      language sql as $$
        select 1 from acc_foo;
      $$;
    `;
    const falseExemption: Exemption = {
      kind: "security-definer-only",
      reason: "Only ever touched by a security definer function, nothing to worry about here.",
    };
    expect(exemptionIsVerified(body, "acc_foo", falseExemption)).toBe(false);
  });

  it("rejects a reason too short to count as considered, even if it happened to be true", () => {
    const body = `
      create table acc_foo (id uuid primary key);
      create or replace function reads_foo() returns void
      language sql security definer as $$
        select 1 from acc_foo;
      $$;
    `;
    const tooShort: Exemption = { kind: "security-definer-only", reason: "trust me" };
    expect(exemptionIsVerified(body, "acc_foo", tooShort)).toBe(false);
  });

  it("accepts a security-definer-only claim the migration actually backs up", () => {
    const body = `
      create table acc_foo (id uuid primary key);
      create or replace function touches_foo() returns void
      language sql security definer as $$
        select 1 from acc_foo;
      $$;
    `;
    const trueExemption: Exemption = {
      kind: "security-definer-only",
      reason: "Only touched by touches_foo(), which is security definer and reads this table directly.",
    };
    expect(exemptionIsVerified(body, "acc_foo", trueExemption)).toBe(true);
  });
});
