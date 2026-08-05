import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0096_payment_details_and_correction.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("payment details and correction migration", () => {
  it("exposes both functions with the agreed signatures", () => {
    expect(sql).toMatch(/create or replace function acc_update_payment_details\s*\(/i);
    expect(sql).toMatch(/create or replace function acc_correct_payment\s*\(/i);
    expect(sql).toMatch(
      /revoke all on function acc_update_payment_details\(uuid, text, text, text\) from public/i,
    );
    expect(sql).toMatch(
      /grant execute on function acc_update_payment_details\(uuid, text, text, text\)\s*\n?\s*to authenticated, service_role/i,
    );
    expect(sql).toMatch(/revoke all on function acc_correct_payment\(/i);
    expect(sql).toMatch(
      /grant execute on function acc_correct_payment\([^)]*\)\s*\n?\s*to authenticated, service_role/i,
    );
  });

  it("lets a description edit touch nothing that posts", () => {
    const fn = sql.slice(
      sql.indexOf("function acc_update_payment_details"),
      sql.indexOf("function acc_correct_payment"),
    );
    expect(fn).toContain("acc_is_staff()");
    expect(fn).toMatch(/update acc_payment\s+set method =/i);
    // Only the write itself is inspected: `status` legitimately appears in the
    // guard above it, so scanning the whole function would prove nothing.
    const update = fn.slice(fn.indexOf("update acc_payment"));
    for (const column of [
      "amount_minor",
      "payment_date",
      "customer_id",
      "deposit_account_id",
      "status",
      "updated_at",
      "updated_by",
      "voided_at",
    ]) {
      expect(update, column).not.toMatch(new RegExp(`${column}\\s*=`));
    }
    expect(fn).toMatch(/status = 'void'/); // refuses one, does not set one
    expect(fn).toMatch(/cannot be edited/i);
  });

  it("corrects by voiding and re-recording, in that order, in one function", () => {
    const fn = sql.slice(sql.indexOf("function acc_correct_payment"));
    expect(fn).toContain("acc_is_staff()");
    const voidAt = fn.indexOf("acc_void_payment");
    const recordAt = fn.indexOf("acc_record_payment");
    expect(voidAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(voidAt);
    expect(fn).not.toMatch(/delete\s+from\s+acc_payment/i);
    expect(fn).not.toMatch(/set status = 'applied'/i); // never revives the original
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
