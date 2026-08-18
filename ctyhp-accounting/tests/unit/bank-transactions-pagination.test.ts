import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE,
  BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS,
  bankTransactionsPagination,
} from "@/app/(app)/banking/bank-transactions-pagination";

/**
 * RQ-04: choosing "100 / page" on Bank Transactions kept showing 25 rows.
 *
 * The cause was `pagination={{ pageSize: 25 }}` on BankTransactionsTable.tsx
 * — a literal. Ant Design treats a *defined* `pagination.pageSize` prop as
 * controlled, and a fresh literal object handed down on every render pins
 * the table back to that number no matter what the reader picks. The
 * dropdown updated its own display; the table did not.
 *
 * Neither test below can mount DataTable or antd's Table — the screen is
 * `.tsx` and importing Ant Design's runtime into a vitest `node`
 * environment costs about 55 seconds against this file's fraction of a
 * second (see the note atop tests/unit/data-table-contract.test.ts). So this
 * file pins what a `.ts` test actually can: that the pagination config is a
 * genuine pass-through of caller state (not a hardcoded number), that a
 * pager interaction is reported back out, and — by reading BankTransactionsTable.tsx
 * as text — that the call site wires that state instead of a literal.
 *
 * What this does NOT catch: whether Ant Design's Pagination actually
 * re-renders with the new number, whether the size changer's dropdown shows
 * 100 as selected, or whether picking 100 truly renders 100 `<tr>` rows in a
 * browser. That is real DOM behaviour this suite cannot drive without
 * paying the antd-runtime cost above, so it was checked by hand instead
 * (see the manual verification notes in the change's report).
 */
describe("bank transactions pagination (RQ-04)", () => {
  it("offers exactly the sizes the change request asked to be testable in sequence", () => {
    expect(BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS).toEqual([25, 50, 100]);
    expect(BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS).toContain(BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE);
  });

  it("defaults to 25 rows a page, matching what the video showed before the reader changed it", () => {
    expect(BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE).toBe(25);
  });

  it("hands DataTable whatever pageSize the caller is holding, not a fixed number", () => {
    // The whole bug in one assertion: the config's pageSize must move when
    // the caller's state moves. A hardcoded `{ pageSize: 25 }` would fail
    // the second and third of these.
    expect(bankTransactionsPagination(25, () => {}).pageSize).toBe(25);
    expect(bankTransactionsPagination(50, () => {}).pageSize).toBe(50);
    expect(bankTransactionsPagination(100, () => {}).pageSize).toBe(100);
  });

  it("reports the size the reader picked back to the caller's state setter", () => {
    const setPageSize = vi.fn();
    const config = bankTransactionsPagination(25, setPageSize);
    // Ant Design's Pagination calls pagination.onChange(page, pageSize) on
    // every pager interaction, including plain page navigation — this is
    // the shape the fix must round-trip correctly.
    config.onChange?.(1, 100);
    expect(setPageSize).toHaveBeenCalledWith(100);
  });

  it("leaves `current` out of the config, trusting Ant Design's own page-clamping", () => {
    // Ant Design's Pagination (@rc-component/pagination) always renders
    // `Math.max(1, Math.min(internalCurrent, calculatePage(pageSize, total)))`
    // and `changePageSize` recomputes the nearest valid page before it ever
    // calls `onChange` — confirmed by reading that package's source, not
    // assumed. Passing our own `current` here would compete with that
    // instead of deferring to it, so the config must not carry one.
    expect(bankTransactionsPagination(25, () => {})).not.toHaveProperty("current");
  });
});

describe("BankTransactionsTable wires pageSize to state, not a literal", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "(app)", "banking", "BankTransactionsTable.tsx"),
    "utf8",
  );

  it("does not hand DataTable a fixed pageSize (the exact shape of the RQ-04 regression)", () => {
    // Matches `pagination={{ pageSize: <number> }}` specifically — the
    // literal Ant Design pins the table to on every render. A broader
    // match on the word "pageSize" alone would also match the fixed
    // version below and could never fail.
    expect(source).not.toMatch(/pagination=\{\{\s*pageSize:\s*\d+/);
  });

  it("reads pageSize from component state and passes the setter back to Ant Design", () => {
    expect(source).toMatch(/useState<number>\(BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE\)/);
    expect(source).toContain("pagination={bankTransactionsPagination(pageSize, setPageSize)}");
  });
});
