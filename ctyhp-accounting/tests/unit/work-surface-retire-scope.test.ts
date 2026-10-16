import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCOUNTING_WORK_KEY_PREFIXES,
  overduePeriodItem,
  recurringFailureItem,
  controlFailureItems,
} from "@/lib/domain/accounting-dashboard/queue-items";
import {
  BANKING_WORK_KEY_PREFIXES,
  brokenFeedItem,
  duplicateChargeItem,
  openReconciliationItem,
  unmatchedBankItem,
} from "@/lib/domain/banking-surface/queue-items";
import {
  overdueInvoiceItem,
  SALES_WORK_KEY_PREFIXES,
  staleDraftItem,
  unappliedReceiptItem,
} from "@/lib/domain/sales-surface/queue-items";
import {
  billDueItem,
  PURCHASES_WORK_KEY_PREFIXES,
  receivedNotBilledItem,
  unappliedPaymentItem,
} from "@/lib/domain/purchases-surface/rules";
import {
  depreciationDueItem,
  INVENTORY_WORK_KEY_PREFIXES,
  negativeStockItem,
  valuationVarianceItem,
} from "@/lib/domain/inventory-surface/rules";
import type { DuplicateCharge } from "@/lib/domain/duplicate-charges";
import type { AccountingControl } from "@/lib/domain/accounting-dashboard/types";
import { EMPTY_WORK_POLICY } from "@/lib/domain/work-policy";
import { retireWorkItems as retireWorkItemsForSurfaces } from "@/lib/services/work-surface/work-item-state";
import { retireWorkItems as retireWorkItemsForAccounting } from "@/lib/services/accounting-dashboard/work-item-state";
import { getBankingSurface } from "@/lib/services/banking-surface";
import { getSalesSurface } from "@/lib/services/sales-surface";
import { getPurchasesSurface } from "@/lib/services/purchases-surface";
import { getInventorySurface } from "@/lib/services/inventory-surface";

const AT = "2026-08-22T09:00:00.000Z";
const SB = {} as SupabaseClient;
const CONTEXT = { asOf: "2026-08-22", currencyCode: "USD", currencyDecimals: 2, timeZone: "America/New_York" };

const startsWithOne = (key: string, prefixes: readonly string[]) => prefixes.some((p) => key.startsWith(p));

const CHARGE: DuplicateCharge = {
  earlier: { lineId: "l1", entryId: "e1", entryNumber: "JE-1", date: "2026-08-10", amountMinor: 4_995, payee: "Harbor Supplies", text: "POS", cleared: false },
  later: { lineId: "l2", entryId: "e2", entryNumber: "JE-2", date: "2026-08-12", amountMinor: 4_995, payee: "Harbor Supplies", text: "POS", cleared: false },
  accountName: "Operating",
  amountMinor: 4_995,
  reviewLineId: "l2",
  reviewSide: "later",
  daysApart: 2,
  outlier: false,
  otherPayeeLines: 0,
} as unknown as DuplicateCharge;

describe("work key prefixes: every key a builder produces starts with its area's prefix", () => {
  it("Accounting", () => {
    const control = { key: "ar-to-gl", status: "failing", title: "T", detail: "D", differenceMinor: 5 } as unknown as AccountingControl;
    const keys = [
      ...controlFailureItems([control], AT).map((i) => i.key),
      overduePeriodItem({ id: "p1", label: "Aug", periodEnd: "2026-08-01" }, "2026-08-22", AT).key,
      recurringFailureItem({ id: "r1", templateName: "Rent", runDate: "2026-08-01" }, "2026-08-22", AT).key,
    ];
    expect(keys).toHaveLength(3);
    for (const key of keys) expect(startsWithOne(key, ACCOUNTING_WORK_KEY_PREFIXES), key).toBe(true);
  });

  it("Banking", () => {
    const keys = [
      unmatchedBankItem({ id: "b1", txnDate: "2026-08-01", description: "X", amountMinor: 100, accountName: "Op" }, { ageDays: 3, ageLimitDays: null, confirmedAt: AT }).key,
      brokenFeedItem({ id: "f1", institutionName: "Bank", status: "error", lastError: null }, { ageDays: 1, confirmedAt: AT }).key,
      openReconciliationItem({ id: "s1", accountName: "Op", statementEndingDate: "2026-07-31" }, { ageDays: 4, confirmedAt: AT }).key,
      duplicateChargeItem(CHARGE, { confirmedAt: AT, money: String, entryHref: (id) => `/e/${id}`, ageDays: 2 }).key,
    ];
    for (const key of keys) expect(startsWithOne(key, BANKING_WORK_KEY_PREFIXES), key).toBe(true);
    expect(new Set(keys.map((k) => k.split(":")[0])).size).toBe(BANKING_WORK_KEY_PREFIXES.length);
  });

  it("Sales", () => {
    const keys = [
      overdueInvoiceItem({ docType: "invoice", docNumber: "INV-1", customerName: "Acme", dueDate: "2026-08-01", balanceMinor: 100 }, { daysPastDue: 5, materialityMinor: null, confirmedAt: AT }).key,
      unappliedReceiptItem({ id: "pay1", number: "R-1", customerName: "Acme", paymentDate: "2026-08-01", unappliedMinor: 100 }, { ageDays: 5, confirmedAt: AT }).key,
      staleDraftItem({ id: "d1", customerName: "Acme", issueDate: "2026-08-01", totalMinor: 100 }, { ageDays: 9, confirmedAt: AT }).key,
    ];
    for (const key of keys) expect(startsWithOne(key, SALES_WORK_KEY_PREFIXES), key).toBe(true);
  });

  it("Purchases", () => {
    const keys = [
      billDueItem({ id: "bill1", number: "B-1", vendorName: "Vend", dueDate: "2026-08-01", balanceMinor: 100 }, { daysPastDue: 3, materialityMinor: null, confirmedAt: AT }).key,
      receivedNotBilledItem({ lineId: "ln1", poNumber: "PO-1", vendorName: "Vend", description: "Widgets", qtyOutstanding: 2, valueMinor: 100, orderDate: "2026-08-01" }, { ageDays: 5, confirmedAt: AT }).key,
      unappliedPaymentItem({ id: "bp1", number: "P-1", vendorName: "Vend", paymentDate: "2026-08-01", unappliedMinor: 100 }, { ageDays: 5, confirmedAt: AT }).key,
    ];
    for (const key of keys) expect(startsWithOne(key, PURCHASES_WORK_KEY_PREFIXES), key).toBe(true);
  });

  it("Inventory", () => {
    const keys = [
      negativeStockItem({ id: "i1", code: "W-1", name: "Widget", qtyOnHand: -3, valueMinor: 100 }, AT).key,
      valuationVarianceItem({ differenceMinor: 100, detail: "Off", confirmedAt: AT }).key,
      depreciationDueItem({ id: "a1", assetNumber: "FA-1", name: "Press", dueMinor: 100, nextDate: "2026-08-01" }, { ageDays: 5, confirmedAt: AT }).key,
    ];
    for (const key of keys) expect(startsWithOne(key, INVENTORY_WORK_KEY_PREFIXES), key).toBe(true);
  });

  it("the five lists do not overlap, except the one documented case", () => {
    const areas = {
      accounting: ACCOUNTING_WORK_KEY_PREFIXES,
      banking: BANKING_WORK_KEY_PREFIXES,
      sales: SALES_WORK_KEY_PREFIXES,
      purchases: PURCHASES_WORK_KEY_PREFIXES,
      inventory: INVENTORY_WORK_KEY_PREFIXES,
    } as const;
    const overlaps: string[] = [];
    for (const [a, as] of Object.entries(areas)) {
      for (const [b, bs] of Object.entries(areas)) {
        if (a === b) continue;
        for (const p of as) for (const q of bs) if (q.startsWith(p)) overlaps.push(`${a}:${p} covers ${b}:${q}`);
      }
    }
    // Inventory's valuation variance item keeps its stored key, "control:inventory-ties-out".
    expect(overlaps).toEqual(["accounting:control: covers inventory:control:inventory-ties-out"]);
  });
});

describe("retireWorkItems sends the prefixes", () => {
  for (const [name, fn] of [
    ["work-surface", retireWorkItemsForSurfaces],
    ["accounting-dashboard", retireWorkItemsForAccounting],
  ] as const) {
    it(`${name}: calls the two-argument RPC`, async () => {
      const rpc = vi.fn(async () => ({ data: 2, error: null }));
      const n = await fn({ rpc } as unknown as SupabaseClient, ["ar-draft:1"], ["ar-draft:", "ar-overdue:"]);
      expect(n).toBe(2);
      expect(rpc).toHaveBeenCalledWith("acc_retire_work_items", {
        p_live_keys: ["ar-draft:1"],
        p_prefixes: ["ar-draft:", "ar-overdue:"],
      });
    });

    it(`${name}: reports and swallows an error`, async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
      expect(await fn({ rpc } as unknown as SupabaseClient, [], ["x:"])).toBe(0);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  }
});

describe("each surface retires with its own prefixes", () => {
  const base = { context: async () => CONTEXT, workState: async () => new Map(), policy: async () => EMPTY_WORK_POLICY };

  it("Banking", async () => {
    const retire = vi.fn(async () => 0);
    await getBankingSurface(SB, {
      ...base,
      facts: async () => ({ accounts: [], feeds: [], transactions: [], sessions: [] }),
      duplicates: async () => [],
      retire,
    } as never);
    expect(retire).toHaveBeenCalledWith(SB, [], BANKING_WORK_KEY_PREFIXES);
  });

  it("Sales", async () => {
    const retire = vi.fn(async () => 0);
    await getSalesSurface(SB, {
      ...base,
      facts: async () => ({ overdue: [], overdueMinor: 0, unapplied: [], unappliedMinor: 0, drafts: [], draftMinor: 0 }),
      retire,
    } as never);
    expect(retire).toHaveBeenCalledWith(SB, [], SALES_WORK_KEY_PREFIXES);
  });

  it("Purchases", async () => {
    const retire = vi.fn(async () => 0);
    await getPurchasesSurface(SB, {
      ...base,
      facts: async () => ({ bills: [], receivedNotBilled: [], unapplied: [] }),
      retire,
    } as never);
    expect(retire).toHaveBeenCalledWith(SB, [], PURCHASES_WORK_KEY_PREFIXES);
  });

  it("Inventory", async () => {
    const retire = vi.fn(async () => 0);
    await getInventorySurface(SB, {
      ...base,
      facts: async () => ({ items: [], subledgerMinor: 0, controlMinor: 0, tiesOut: true, assets: [] }),
      retire,
    } as never);
    expect(retire).toHaveBeenCalledWith(SB, [], INVENTORY_WORK_KEY_PREFIXES);
  });
});
