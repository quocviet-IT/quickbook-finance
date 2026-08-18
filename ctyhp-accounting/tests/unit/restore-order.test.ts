import { describe, expect, it } from "vitest";
import {
  restoreOrder,
  RestoreOrderError,
  type ForeignKeyConstraint,
} from "@/lib/domain/restore-order";

/**
 * The restore used to delete in EXPORT_TABLES reversed and insert in
 * EXPORT_TABLES forward, trusting a hand-maintained list to encode a
 * 232-edge foreign-key graph. It did not: acc_account (listed 24th)
 * references acc_tax_code (listed 32nd), so the reversed list deleted
 * acc_tax_code while acc_account rows still pointed at it — the first of
 * twelve such contradictions in the live schema. These tests pin the
 * replacement: an order computed from the constraints themselves.
 */

function fk(
  fromTable: string,
  toTable: string,
  overrides: Partial<ForeignKeyConstraint> = {},
): ForeignKeyConstraint {
  return {
    constraintName: `${fromTable}_${toTable}_fk`,
    fromTable,
    toTable,
    columns: [`${toTable}_id`],
    allNullable: false,
    ...overrides,
  };
}

/** Asserts `first` comes before `second`, with a message naming both. */
function expectBefore(order: string[], first: string, second: string) {
  const a = order.indexOf(first);
  const b = order.indexOf(second);
  expect(a, `${first} is missing from the order`).toBeGreaterThanOrEqual(0);
  expect(b, `${second} is missing from the order`).toBeGreaterThanOrEqual(0);
  expect(a, `${first} must come before ${second}, got ${order.join(", ")}`).toBeLessThan(b);
}

describe("ordering tables by their foreign keys", () => {
  it("places every referenced table before the table that references it", () => {
    // The live regression, in miniature: the input list says account first,
    // the foreign key says tax_code must exist first. The constraint wins.
    const result = restoreOrder(
      ["account", "journal_entry", "journal_line", "tax_code"],
      [
        fk("account", "tax_code"),
        fk("journal_line", "journal_entry"),
        fk("journal_line", "account"),
      ],
    );
    expectBefore(result.order, "tax_code", "account");
    expectBefore(result.order, "account", "journal_line");
    expectBefore(result.order, "journal_entry", "journal_line");
    expect(result.order).toHaveLength(4);
    expect(result.suspended).toEqual([]);
  });

  it("keeps the input order wherever the constraints are silent", () => {
    // Determinism: two runs over the same schema must load the same way, and
    // unconstrained tables should stay where the export list put them.
    const result = restoreOrder(["c", "a", "b"], []);
    expect(result.order).toEqual(["c", "a", "b"]);
  });

  it("does not deadlock on a self-reference, and keeps the table in place", () => {
    // acc_account references itself (parent accounts). Order between tables
    // cannot say anything about rows inside one table — the single-statement
    // insert handles that, because foreign keys are checked at end of
    // statement. A sort that counted the self-edge would wait forever.
    const result = restoreOrder(
      ["currency", "account"],
      [fk("account", "account", { columns: ["parent_account_id"], allNullable: true })],
    );
    expect(result.order).toEqual(["currency", "account"]);
    expect(result.suspended).toEqual([]);
  });

  it("ignores constraints that reach outside the set of tables being restored", () => {
    // Every schema table references auth.users, and restored tables reference
    // kept ones (acc_tax_code -> acc_us_state). Rows outside the set are never
    // cleared or loaded, so those edges cannot constrain this order.
    const result = restoreOrder(
      ["audit_log", "account"],
      [
        fk("audit_log", "users"),
        fk("account", "users"),
        fk("account", "us_state"),
        fk("role_permission", "permission"),
      ],
    );
    expect(result.order).toEqual(["audit_log", "account"]);
    expect(result.suspended).toEqual([]);
  });

  it("breaks a cycle at a fully nullable constraint and reports which one", () => {
    // The live schema's one real cycle: acc_account.default_tax_code_id ->
    // acc_tax_code, acc_tax_code.tax_account_id -> acc_account. Both columns
    // are nullable, so the loader can insert with one side null and write the
    // values back afterwards — but only if the sort tells it which side.
    const accountToTax = fk("account", "tax_code", {
      constraintName: "acc_account_default_tax_fk",
      columns: ["default_tax_code_id"],
      allNullable: true,
    });
    const taxToAccount = fk("tax_code", "account", {
      constraintName: "acc_tax_code_tax_account_id_fkey",
      columns: ["tax_account_id"],
      allNullable: true,
    });
    const result = restoreOrder(["account", "tax_code"], [accountToTax, taxToAccount]);
    // The first table in input order whose blockers are all nullable is the
    // one suspended — account here — after which tax_code loads against it.
    expect(result.order).toEqual(["account", "tax_code"]);
    expect(result.suspended).toEqual([accountToTax]);
  });

  it("suspends only what the cycle forces, honouring nullable edges that an order can satisfy", () => {
    // journal_line -> tax_code is nullable, but no cycle passes through it,
    // so it must be honoured by ordering — suspending it would null and
    // rewrite every journal line's tax code for nothing.
    const result = restoreOrder(
      ["account", "journal_line", "tax_code"],
      [
        fk("account", "tax_code", { columns: ["default_tax_code_id"], allNullable: true }),
        fk("tax_code", "account", { columns: ["tax_account_id"], allNullable: true }),
        fk("journal_line", "account"),
        fk("journal_line", "tax_code", { columns: ["tax_code_id"], allNullable: true }),
      ],
    );
    expect(result.order).toEqual(["account", "tax_code", "journal_line"]);
    expect(result.suspended.map((c) => c.constraintName)).toEqual(["account_tax_code_fk"]);
  });

  it("refuses a cycle that crosses a NOT NULL column, naming the tables", () => {
    // No order satisfies it and no column can be nulled to break it — loading
    // anyway would fail half-way through with the schema in an odd state, so
    // the sort refuses up front.
    expect(() =>
      restoreOrder(["a", "b"], [fk("a", "b"), fk("b", "a")]),
    ).toThrowError(RestoreOrderError);
    expect(() => restoreOrder(["a", "b"], [fk("a", "b"), fk("b", "a")])).toThrowError(/a, b/);
  });

  it("orders a realistic diamond so that every constraint is satisfied", () => {
    // bill_line references bill, purchase_order_line and goods_receipt_line;
    // both of those reference purchase_order — the shape the reversed export
    // list also got wrong (acc_bill is listed before acc_purchase_order).
    const constraints = [
      fk("bill", "purchase_order", { allNullable: true }),
      fk("bill_line", "bill"),
      fk("bill_line", "purchase_order_line", { allNullable: true }),
      fk("bill_line", "goods_receipt_line", { allNullable: true }),
      fk("purchase_order_line", "purchase_order"),
      fk("goods_receipt_line", "goods_receipt"),
      fk("goods_receipt", "purchase_order"),
    ];
    const tables = [
      "bill",
      "bill_line",
      "purchase_order",
      "purchase_order_line",
      "goods_receipt",
      "goods_receipt_line",
    ];
    const { order, suspended } = restoreOrder(tables, constraints);
    expect(suspended).toEqual([]);
    for (const constraint of constraints) {
      expectBefore(order, constraint.toTable, constraint.fromTable);
    }
  });
});
