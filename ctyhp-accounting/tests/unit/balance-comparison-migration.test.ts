import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES, ORDER_COLUMNS, orderColumnsFor } from "@/lib/domain/company-export";

const DIR = join(process.cwd(), "supabase/migrations");

function read(file: string): string {
  return readFileSync(join(DIR, file), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, \r already gone. */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** The text of one `create or replace function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

const FILE = "0155_balance_comparison.sql";
const sql = strip(read(FILE));
const TABLES = ["acc_balance_comparison", "acc_balance_comparison_line"];

describe("0155 is additive", () => {
  it("is the next migration and the only one numbered 0155", () => {
    const names = readdirSync(DIR).filter((n) => /^\d{4}_/.test(n));
    expect(names.filter((n) => n.startsWith("0155_"))).toEqual([FILE]);
    expect(names).toContain("0154_cash_count.sql");
  });

  it("creates exactly two tables and one function, and no other kind of object", () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]);
    expect(tables).toEqual(TABLES);
    const functions = [...sql.matchAll(/create (?:or replace )?function (\w+)\(/gi)].map((m) => m[1]);
    expect(functions).toEqual(["acc_save_balance_comparison"]);
    expect(sql).not.toMatch(/create (?:or replace )?(?:view|type|extension|schema|sequence|materialized)/i);
  });

  it("never alters an existing table or type, only enables row level security on its own", () => {
    const alters = [...sql.matchAll(/alter (table|type|function|policy|index|sequence)\s+(\w+)\s+([^;]*);/gi)];
    expect(alters.map((m) => [m[1], m[2], m[3].trim()])).toEqual([
      ["table", "acc_balance_comparison", "enable row level security"],
      ["table", "acc_balance_comparison_line", "enable row level security"],
    ]);
  });

  it("drops only its own triggers and policies, if they exist", () => {
    const drops = [...sql.matchAll(/drop\s+[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " "));
    expect(drops).toEqual([
      "drop trigger if exists acc_balance_comparison_actor_stamp on acc_balance_comparison;",
      "drop trigger if exists acc_balance_comparison_atomic_audit on acc_balance_comparison;",
      "drop policy if exists acc_balance_comparison_read on acc_balance_comparison;",
      "drop policy if exists acc_balance_comparison_line_read on acc_balance_comparison_line;",
    ]);
    expect(sql).not.toMatch(/\btruncate table\b|\bdrop (table|function|column|constraint|type)\b/i);
  });

  it("writes data only through its own function, and only to its own tables", () => {
    // outside the function body there is no statement that reads or writes rows
    const fn = functionText(sql, "acc_save_balance_comparison");
    const outside = sql.replace(fn, "");
    expect(outside).not.toMatch(/^\s*(insert|update|delete)\b/im);
    for (const m of fn.matchAll(/(?<!do )\b(insert into|delete from|update)\s+(\w+)/gi)) {
      expect(TABLES, `${m[1]} ${m[2]}`).toContain(m[2]);
    }
  });

  it("changes no function that exists: the only definition is the new one, and no earlier migration defines it", () => {
    for (const name of readdirSync(DIR).filter((n) => /^\d{4}_/.test(n) && n !== FILE)) {
      expect(read(name), name).not.toMatch(/acc_save_balance_comparison|acc_balance_comparison/i);
    }
  });

  it("starts with the unqualified search_path every migration uses, and qualifies no name with public.", () => {
    expect(sql.trimStart().startsWith("set search_path = public;")).toBe(true);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });
});

describe("0155 the header table", () => {
  it("has the spec's columns, keyed on the date", () => {
    expect(sql).toMatch(/create table if not exists acc_balance_comparison \(/i);
    expect(sql).toMatch(/as_of\s+date primary key/i);
    expect(sql).toMatch(/compared_with\s+text not null check \(length\(compared_with\) between 1 and 80\)/i);
    expect(sql).toMatch(/note\s+text check \(note is null or length\(note\) <= 500\)/i);
    expect(sql).toMatch(/created_by\s+uuid references auth\.users \(id\)/i);
    expect(sql).toMatch(/created_at\s+timestamptz not null default now\(\)/i);
    expect(sql).toMatch(/updated_by\s+uuid references auth\.users \(id\)/i);
    expect(sql).toMatch(/updated_at\s+timestamptz not null default now\(\)/i);
  });

  it("stamps actors and audits every write, as 0139 and 0154 do", () => {
    expect(sql).toMatch(
      /create trigger acc_balance_comparison_actor_stamp\s+before insert or update on acc_balance_comparison\s+for each row execute function acc_stamp_actor\(\)/i,
    );
    expect(sql).toMatch(
      /create trigger acc_balance_comparison_atomic_audit\s+after insert or update or delete on acc_balance_comparison\s+for each row execute function acc_audit_row_change\(\)/i,
    );
  });

  it("keeps the audit trail on the header only, as 0139 does for its lines", () => {
    expect(sql).not.toMatch(/create trigger \w+\s+\w+ [^;]*on acc_balance_comparison_line/i);
  });
});

describe("0155 the line table", () => {
  it("has the spec's columns", () => {
    expect(sql).toMatch(/create table if not exists acc_balance_comparison_line \(/i);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/as_of\s+date not null references acc_balance_comparison \(as_of\) on delete cascade/i);
    expect(sql).toMatch(/account_id\s+uuid references acc_account \(id\)/i);
    expect(sql).toMatch(/external_code\s+text check/i);
    expect(sql).toMatch(/external_name\s+text check/i);
    expect(sql).toMatch(/other_balance_minor\s+bigint not null/i);
  });

  it("is unique per date and account, and per date and lower-cased external code", () => {
    expect(sql).toMatch(
      /create unique index if not exists acc_balance_comparison_line_account_uq\s+on acc_balance_comparison_line \(as_of, account_id\)\s+where account_id is not null;/i,
    );
    expect(sql).toMatch(
      /create unique index if not exists acc_balance_comparison_line_external_uq\s+on acc_balance_comparison_line \(as_of, lower\(external_code\)\)\s+where account_id is null;/i,
    );
  });

  it("needs an account, or both an external code and an external name", () => {
    expect(sql).toMatch(
      /constraint acc_balance_comparison_line_who_ck\s+check \(account_id is not null or \(external_code is not null and external_name is not null\)\)/i,
    );
  });
});

describe("0155 access", () => {
  it("enables row level security on both tables", () => {
    for (const t of TABLES) expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security`, "i"));
  });

  it("lets staff and viewers select, with one policy per table and no write policy", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(
        new RegExp(
          `create policy ${t}_read on ${t}\\s+for select using \\(acc_is_staff\\(\\) or coalesce\\(acc_current_role\\(\\) = 'viewer', false\\)\\)`,
          "i",
        ),
      );
    }
    expect([...sql.matchAll(/create policy/gi)]).toHaveLength(2);
    expect(sql).not.toMatch(/create policy[^;]*\bfor (insert|update|delete|all)\b/i);
  });

  it("grants read to signed-in users, everything to the service role, nothing to anon", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on ${t} from public, anon`, "i"));
      expect(sql).toMatch(new RegExp(`revoke insert, update, delete, truncate on ${t} from authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant select on ${t} to authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant all on ${t} to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]*on ${t} to`, "i"));
      // the revoke of the default write rights comes after the revoke from public and before the select grant
      const revokeAll = sql.indexOf(`revoke all on ${t} from public, anon`);
      const revokeWrite = sql.indexOf(`revoke insert, update, delete, truncate on ${t} from authenticated`);
      expect(revokeWrite).toBeGreaterThan(revokeAll);
      expect(sql.indexOf(`grant select on ${t} to authenticated`)).toBeGreaterThan(revokeWrite);
    }
  });
});

describe("0155 acc_save_balance_comparison", () => {
  const text = functionText(sql, "acc_save_balance_comparison");
  const header = text.slice(0, text.indexOf("$$"));

  it("is security definer with a fixed search_path and the spec's signature and return", () => {
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
    expect(header).toMatch(
      /acc_save_balance_comparison\(\s*p_as_of\s+date,\s*p_compared_with\s+text,\s*p_note\s+text,\s*p_lines\s+jsonb\s*\) returns integer/i,
    );
  });

  it("is staff only, and that is the first thing it checks", () => {
    expect(text).toMatch(/if not acc_is_staff\(\) then raise exception 'Not authorized to save a balance comparison'/i);
    const order = [
      "acc_is_staff()",
      "Choose the date to compare at",
      "Enter the name of the other system",
      "(80 characters at most)",
      "(500 characters at most)",
      "The figures must be a list",
      "insert into acc_balance_comparison (as_of",
      "delete from acc_balance_comparison_line where as_of = p_as_of",
      "insert into acc_balance_comparison_line",
      "return v_kept",
    ];
    let last = -1;
    for (const needle of order) {
      const at = text.indexOf(needle);
      expect(at, needle).toBeGreaterThan(last);
      last = at;
    }
  });

  it("upserts the header by date", () => {
    expect(text).toMatch(/on conflict \(as_of\) do update\s+set compared_with = excluded\.compared_with, note = excluded\.note/i);
  });

  it("replaces the lines of that date only", () => {
    const deletes = [...text.matchAll(/delete from (\w+)([^;]*);/gi)];
    expect(deletes.map((m) => [m[1], m[2].trim()])).toEqual([["acc_balance_comparison_line", "where as_of = p_as_of"]]);
    expect(text).not.toMatch(/delete from acc_balance_comparison\b(?!_line)/i);
  });

  it("stores no line without a figure", () => {
    expect(text).toMatch(/continue when v_figure is null or jsonb_typeof\(v_figure\) = 'null'/i);
    expect(text.indexOf("continue when")).toBeLessThan(text.indexOf("insert into acc_balance_comparison_line"));
  });

  it("refuses an unknown or inactive account", () => {
    expect(text).toMatch(/not exists \(select 1 from acc_account a where a\.id = v_acct and a\.status = 'active'\)/i);
    expect(text).toMatch(/Choose an active account for each figure/);
  });

  it("refuses a figure that is not a whole number, a line that names both kinds of account, and repeats", () => {
    expect(text).toMatch(/jsonb_typeof\(v_figure\) <> 'number'/i);
    expect(text).toMatch(/A figure must be a whole number of cents/);
    expect(text).toMatch(/not both/);
    expect(text).toMatch(/An account only the other system has needs a code and a name/);
    expect(text).toMatch(/An account appears twice/);
    expect(text).toMatch(/An account code appears twice/);
  });

  it("keeps an external-only line's code and name, and clears them for an account of this ledger", () => {
    expect(text).toMatch(/case when v_acct is null then v_code end,\s*case when v_acct is null then v_name end/i);
  });

  it("returns the number of lines kept", () => {
    expect(text).toMatch(/v_kept\s+integer := 0/i);
    expect(text).toMatch(/v_kept := v_kept \+ 1/i);
    expect(text).toMatch(/return v_kept;/i);
  });

  it("is callable by signed-in users and the service role, not by anon or the public", () => {
    expect(sql).toMatch(/revoke all on function acc_save_balance_comparison\(date, text, text, jsonb\) from public, anon/i);
    expect(sql).toMatch(
      /grant execute on function acc_save_balance_comparison\(date, text, text, jsonb\) to authenticated, service_role/i,
    );
  });
});

describe("0155 the company backup", () => {
  it("lists both tables, the header before its lines and both after the accounts they reference", () => {
    const at = (t: string) => EXPORT_TABLES.indexOf(t);
    expect(at("acc_balance_comparison")).toBeGreaterThan(-1);
    expect(at("acc_balance_comparison_line")).toBeGreaterThan(at("acc_balance_comparison"));
    expect(at("acc_balance_comparison")).toBeGreaterThan(at("acc_account"));
  });

  it("reads the header in date order, since it has no id column", () => {
    expect(ORDER_COLUMNS.acc_balance_comparison).toEqual(["as_of"]);
    expect(orderColumnsFor("acc_balance_comparison_line")).toEqual(["id"]);
  });
});
