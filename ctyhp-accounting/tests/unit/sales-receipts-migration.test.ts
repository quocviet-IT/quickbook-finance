import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8").replace(/\r\n/g, "\n");
const source = read("0163_sales_receipt_source.sql");
const sql = read("0164_sales_receipts.sql");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");
const body = (fn: string) => {
  const start = code.indexOf(`create or replace function ${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

describe("0163_sales_receipt_source", () => {
  it("adds the journal source alone, as Postgres needs before the value is used", () => {
    expect(source.replace(/--[^\n]*/g, "").trim()).toBe("alter type acc_journal_source add value if not exists 'sales_receipt';");
  });
});

describe("0164_sales_receipts", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^[\s\S]*?\nset search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/i);
  });

  it("can be run twice", () => {
    expect(code).not.toMatch(/create table (?!if not exists)/i);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(code).not.toMatch(/\bcreate function\b/i);
    for (const trigger of [...code.matchAll(/create trigger (\w+)/g)].map((m) => m[1])) {
      expect(code, trigger).toMatch(new RegExp(`drop trigger if exists ${trigger} on`));
    }
    for (const policy of [...code.matchAll(/create policy (\w+)/g)].map((m) => m[1])) {
      expect(code, policy).toMatch(new RegExp(`drop policy if exists ${policy} on`));
    }
    expect(code).toMatch(/values \('sales_receipt', 'SR-', 1\)\s+on conflict \(key\) do nothing/);
  });

  it("is in USD under the named check every currency column carries, and its totals add up", () => {
    expect(code).toMatch(/constraint acc_usd_currency_check check \(currency_code = 'USD'\)/);
    expect(code).toMatch(/total_minor = subtotal_minor \+ tax_minor and total_minor > 0/);
  });

  it("keeps the reason with a void receipt", () => {
    expect(code).toMatch(/check \(status in \('posted', 'void'\) and \(status = 'void'\) = \(voided_at is not null\)\)/);
    expect(code).toMatch(/check \(status <> 'void' or char_length\(btrim\(coalesce\(void_reason, ''\)\)\) >= 3\)/);
  });

  it("is read by the company and written only by its two functions", () => {
    for (const table of ["acc_sales_receipt", "acc_sales_receipt_line"]) {
      expect(code).toMatch(new RegExp(`revoke insert, update, delete, truncate on ${table} from authenticated;`));
      expect(code).toMatch(new RegExp(`grant select on ${table} to authenticated;`));
      expect(code).not.toMatch(new RegExp(`create policy \\w+ on ${table}\\s+for (insert|update|delete|all)`));
    }
    for (const fn of ["acc_create_sales_receipt", "acc_void_sales_receipt"]) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon;`));
      expect(body(fn), fn).toMatch(/if not acc_is_staff\(\) then raise exception/);
    }
  });

  it("refuses a deposit to anything but a bank, cash or Undeposited Funds, null detail types included", () => {
    const create = body("acc_create_sales_receipt");
    expect(create).toMatch(/coalesce\(v_deposit\.detail_type, ''\) = 'undeposited_funds'/);
    expect(create).not.toMatch(/or v_deposit\.detail_type = 'undeposited_funds'/);
  });

  it("posts through acc_post_entry as a sales receipt, and its cost of sales as inventory, never touching receivables", () => {
    const create = body("acc_create_sales_receipt");
    expect(create).toMatch(/acc_post_entry\(v_date, 'Sales receipt ' \|\| v_number \|\| ' · ' \|\| v_customer,\s+'sales_receipt', v_receipt/);
    expect(create).toMatch(/acc_post_entry\(v_date, 'Cost of sales for sales receipt ' \|\| v_number,\s+'inventory', v_receipt/);
    expect(create).not.toMatch(/accounts_receivable|balance_due/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("voids both entries and puts the goods back", () => {
    const voidFn = body("acc_void_sales_receipt");
    expect(voidFn).toMatch(/acc_reverse_inventory_for_entry\(v_cost_entry/);
    expect(voidFn).toMatch(/update acc_journal_entry set status = 'void', voided_at = now\(\) where id = v_receipt\.journal_entry_id/);
    expect(voidFn).toMatch(/This sales receipt is already void/);
  });

  it("counts a posted receipt's tax wherever invoice tax is counted", () => {
    expect(body("acc_sales_tax_collected")).toMatch(/from acc_sales_receipt_line rl\s+join acc_sales_receipt r on r\.id = rl\.receipt_id\s+where r\.status = 'posted'/);
    expect(body("acc_control_reconciliation")).toMatch(
      /\+ coalesce\(\(select sum\(sr\.tax_minor\) from acc_sales_receipt sr\s+where sr\.status = 'posted' and sr\.receipt_date <= p_as_of\), 0\)/,
    );
    expect(body("acc_gl_posting_report")).toMatch(/select 'sales_receipt', sr\.id, sr\.receipt_number/);
  });

  it("changes nothing else in the functions it redefines from 0073", () => {
    const original = read("0073_gl_posting_verification.sql").replace(/--[^\n]*/g, "");
    const of = (text: string, fn: string) => {
      const start = text.indexOf(`create or replace function ${fn}(`);
      return text.slice(start, text.indexOf("$$;", start));
    };
    const strip = (text: string) =>
      text
        .replace(/\s+union all\s+select 'sales_receipt'[\s\S]*?between p_from and p_to/, "")
        .replace(/\s+\+ coalesce\(\(select sum\(sr\.tax_minor\)[\s\S]*?<= p_as_of\), 0\)/, "")
        .replace(/\s+/g, " ");
    for (const fn of ["acc_gl_posting_report", "acc_control_reconciliation"]) {
      expect(strip(body(fn)), fn).toBe(of(original, fn).replace(/\s+/g, " "));
    }
  });
});
