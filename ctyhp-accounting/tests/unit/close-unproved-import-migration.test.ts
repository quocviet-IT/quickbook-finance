import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0146_close_unproved_statement_import.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Line comments removed, so naming a thing in prose never reads as doing it. */
const strip = (raw: string) =>
  raw
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const sql = strip(read(`supabase/migrations/${FILE}`));

describe("0146 closes the way round the statement proof", () => {
  it("only revokes the older import from the roles a person signs in with", () => {
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual([
      "set search_path = public",
      "revoke all on function acc_import_bank_statement(uuid, text, jsonb) from public, anon, authenticated",
    ]);
  });

  it("leaves the proved import, which calls the older one as its owner, granted and definer", () => {
    const proof = read("supabase/migrations/0143_statement_proof.sql");
    expect(proof).toMatch(/function acc_import_bank_statement_proved\([\s\S]*?security definer/i);
    expect(proof).toMatch(/from acc_import_bank_statement\(p_bank_account_id, p_filename, v_import\)/);
    expect(sql).not.toMatch(/acc_import_bank_statement_proved/);
  });

  it("is not called by the app, only through the proved import", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name) && /"acc_import_bank_statement"/.test(read(path))) {
          callers.push(path);
        }
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(dir);
    expect(callers).toEqual([]);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: read(`supabase/migrations/${FILE}`) }], "co_example");
    expect(plan.skipped).toEqual([]);
  });
});
