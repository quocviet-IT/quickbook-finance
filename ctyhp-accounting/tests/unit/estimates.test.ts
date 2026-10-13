import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESTIMATE_FILTERS,
  ESTIMATE_STATES,
  ESTIMATE_STATE_LABELS,
  countEstimatesByFilter,
  defaultExpiryDate,
  estimateActions,
  estimateInFilter,
  estimateLineToFormLine,
  estimateMessages,
  estimateState,
  estimateStateOf,
  estimateToInvoicePrefill,
  formLineToLineInput,
  formLinesTotals,
  type EstimateLineValues,
  type EstimateState,
} from "@/lib/domain/estimates";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import { invoiceLineInputSchema } from "@/lib/domain/schemas";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0141_estimates.sql"),
  "utf8",
);

const ACCOUNT = "0f6b3c8e-1111-4111-8111-000000000001";
const TAX = "0f6b3c8e-2222-4222-8222-000000000002";
const ITEM = "0f6b3c8e-3333-4333-8333-000000000003";

describe("estimateState", () => {
  const base = { declinedAt: null, expiryDate: "2026-11-11", hasLiveInvoice: false };

  it("is Open before the expiry date", () => {
    expect(estimateState(base, "2026-10-12")).toBe("open");
  });

  it("is still Open on the expiry day itself", () => {
    expect(estimateState(base, "2026-11-11")).toBe("open");
  });

  it("is Expired from the day after the expiry date", () => {
    expect(estimateState(base, "2026-11-12")).toBe("expired");
  });

  it("expires across a year end", () => {
    expect(estimateState({ ...base, expiryDate: "2026-12-31" }, "2026-12-31")).toBe("open");
    expect(estimateState({ ...base, expiryDate: "2026-12-31" }, "2027-01-01")).toBe("expired");
  });

  it("is Declined when declined, before or after the expiry date: Declined wins over Expired", () => {
    const declined = { ...base, declinedAt: "2026-10-20T15:04:00+00:00" };
    expect(estimateState(declined, "2026-10-21")).toBe("declined");
    expect(estimateState(declined, "2026-12-01")).toBe("declined");
  });

  it("is Converted when a live invoice was made from it, whatever else is true", () => {
    expect(estimateState({ ...base, hasLiveInvoice: true }, "2026-10-12")).toBe("converted");
    expect(estimateState({ ...base, hasLiveInvoice: true }, "2027-06-01")).toBe("converted");
    expect(
      estimateState({ ...base, hasLiveInvoice: true, declinedAt: "2026-10-20T15:04:00+00:00" }, "2027-06-01"),
    ).toBe("converted");
  });

  it("reads Open again once the invoice made from it is voided (no live invoice left)", () => {
    // A voided invoice keeps its link, but the list reports no live invoice.
    expect(estimateState({ ...base, hasLiveInvoice: false }, "2026-10-12")).toBe("open");
  });

  it("refuses a timestamp for today, which would move the expiry day a day early", () => {
    // "2026-11-11" < "2026-11-11T05:00:00.000Z" as strings: the trap this guards.
    expect(() => estimateState(base, "2026-11-11T05:00:00.000Z")).toThrow(/YYYY-MM-DD/);
  });

  it("refuses a date that is not on the calendar", () => {
    expect(() => estimateState(base, "2026-02-30")).toThrow(/YYYY-MM-DD/);
    expect(() => estimateState({ ...base, expiryDate: "11/11/2026" }, "2026-10-12")).toThrow(/YYYY-MM-DD/);
  });
});

describe("estimateStateOf", () => {
  it("reads the state straight off a list row", () => {
    const row = { declined_at: null, expiry_date: "2026-10-01", live_invoice: null };
    expect(estimateStateOf(row, "2026-10-02")).toBe("expired");
    expect(estimateStateOf({ ...row, live_invoice: { id: "x" } }, "2026-10-02")).toBe("converted");
    expect(estimateStateOf({ ...row, declined_at: "2026-09-30T10:00:00+00:00" }, "2026-10-02")).toBe("declined");
  });
});

describe("defaultExpiryDate", () => {
  it.each([
    ["2026-10-12", "2026-11-11"],
    ["2026-01-31", "2026-03-02"],
    ["2026-02-01", "2026-03-03"],
    ["2028-02-01", "2028-03-02"],
    ["2026-12-15", "2027-01-14"],
  ])("is %s plus 30 days: %s", (date, expected) => {
    expect(defaultExpiryDate(date)).toBe(expected);
  });

  it("refuses anything that is not a calendar date", () => {
    expect(() => defaultExpiryDate("2026-13-01")).toThrow(/YYYY-MM-DD/);
    expect(() => defaultExpiryDate("")).toThrow(/YYYY-MM-DD/);
  });
});

describe("estimateActions", () => {
  it("follows the spec's table for someone who can write", () => {
    expect(estimateActions("open", true)).toEqual({
      edit: true, convert: true, confirmConvert: false, decline: true, reopen: false, delete: true, pdf: true,
    });
    expect(estimateActions("expired", true)).toEqual({
      edit: true, convert: true, confirmConvert: true, decline: true, reopen: false, delete: true, pdf: true,
    });
    expect(estimateActions("declined", true)).toEqual({
      edit: true, convert: false, confirmConvert: false, decline: false, reopen: true, delete: true, pdf: true,
    });
    expect(estimateActions("converted", true)).toEqual({
      edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false, pdf: true,
    });
  });

  it("leaves a read-only role the PDF and nothing else, in every state", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, false)).toEqual({
        edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false, pdf: true,
      });
    }
  });

  it("offers delete whenever it is not converted", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, true).delete).toBe(state !== "converted");
    }
  });

  it("asks before converting only an expired estimate", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, true).confirmConvert).toBe(state === "expired");
    }
  });
});

describe("labels and filter pills", () => {
  it("labels every state", () => {
    expect(ESTIMATE_STATE_LABELS).toEqual({
      open: "Open",
      expired: "Expired",
      declined: "Declined",
      converted: "Converted",
    });
  });

  it("offers the pills All, Open, Expired, Declined, Converted, in that order", () => {
    expect(ESTIMATE_FILTERS.map((pill) => pill.label)).toEqual([
      "All", "Open", "Expired", "Declined", "Converted",
    ]);
    expect(ESTIMATE_FILTERS.map((pill) => pill.key)).toEqual([
      "all", "open", "expired", "declined", "converted",
    ]);
  });

  it("counts each pill, and All counts every estimate", () => {
    const states: EstimateState[] = ["open", "open", "expired", "converted", "declined", "open"];
    expect(countEstimatesByFilter(states)).toEqual({
      all: 6, open: 3, expired: 1, declined: 1, converted: 1,
    });
    expect(countEstimatesByFilter([])).toEqual({ all: 0, open: 0, expired: 0, declined: 0, converted: 0 });
  });

  it("keeps a row in All and in its own state's pill only", () => {
    expect(estimateInFilter("expired", "all")).toBe(true);
    expect(estimateInFilter("expired", "expired")).toBe(true);
    expect(estimateInFilter("expired", "open")).toBe(false);
  });
});

describe("estimateMessages", () => {
  it("says exactly what the spec says", () => {
    expect(estimateMessages.deleteConfirm("EST-000001")).toBe(
      "Delete EST-000001? It is not in the books, so nothing else changes.",
    );
    expect(estimateMessages.deleteRefused("EST-000001")).toBe(
      "EST-000001 has had an invoice made from it. Mark it declined instead.",
    );
    expect(estimateMessages.alreadyConverted("EST-000001", "INV-000123")).toBe(
      "EST-000001 has already been turned into an invoice (INV-000123).",
    );
    expect(estimateMessages.alreadyConverted("EST-000001", null)).toBe(
      "EST-000001 has already been turned into an invoice (a draft invoice).",
    );
    expect(estimateMessages.declined("EST-000001")).toBe("EST-000001 marked declined.");
    expect(estimateMessages.reopened("EST-000001")).toBe("EST-000001 reopened.");
    expect(estimateMessages.expiredConfirm("EST-000001", "2026-10-01")).toBe(
      "EST-000001 expired on 2026-10-01. Turn it into an invoice anyway?",
    );
    expect(estimateMessages.fromEstimate("EST-000001")).toBe("From estimate EST-000001");
    expect(estimateMessages.invoiceCreated("EST-000001")).toBe(
      "Draft invoice created from EST-000001. Check it over, then issue it.",
    );
  });

  it("uses the database's own words for the refusals both sides can give", () => {
    // Postgres fills each % in order; "%" in, "%" out shows the templates are equal.
    expect(migration).toContain(`'${estimateMessages.deleteRefused("%")}'`);
    expect(migration).toContain(`'${estimateMessages.alreadyConverted("%", "%")}'`);
    expect(migration).toContain(`'${estimateMessages.declinedCannotConvert("%")}'`);
    expect(migration).toContain("coalesce(i.invoice_number, 'a draft invoice')");
  });
});

const storedLines: EstimateLineValues[] = [
  {
    line_order: 1,
    item_id: null,
    description: "Install brass shelf brackets",
    quantity: 2.5,
    unit_price_minor: 4_250,
    income_account_id: ACCOUNT,
    tax_code_id: null,
  },
  {
    line_order: 0,
    item_id: ITEM,
    description: "Walnut shelf, 90 cm",
    quantity: 3,
    unit_price_minor: 1_999,
    income_account_id: ACCOUNT,
    tax_code_id: TAX,
  },
];

describe("estimateToInvoicePrefill", () => {
  const estimate = {
    id: "0f6b3c8e-4444-4444-8444-000000000004",
    estimate_number: "EST-000007",
    customer_id: "0f6b3c8e-5555-4555-8555-000000000005",
    declined_at: null,
    live_invoice: null,
  };

  it("fills the customer and every line, in the estimate's order, with the price in dollars", () => {
    expect(estimateToInvoicePrefill(estimate, storedLines)).toEqual({
      estimateId: estimate.id,
      estimateNumber: "EST-000007",
      values: {
        customer_id: estimate.customer_id,
        lines: [
          {
            item_id: ITEM,
            description: "Walnut shelf, 90 cm",
            quantity: 3,
            unit_price: 19.99,
            income_account_id: ACCOUNT,
            tax_code_id: TAX,
          },
          {
            item_id: null,
            description: "Install brass shelf brackets",
            quantity: 2.5,
            unit_price: 42.5,
            income_account_id: ACCOUNT,
            tax_code_id: null,
          },
        ],
      },
      blocked: null,
    });
  });

  it("loses nothing: the form submits exactly the lines the estimate stores", () => {
    const prefill = estimateToInvoicePrefill(estimate, storedLines);
    const submitted = prefill.values.lines.map(formLineToLineInput);
    expect(submitted).toEqual([
      {
        description: "Walnut shelf, 90 cm",
        quantity: 3,
        unit_price_minor: 1_999,
        income_account_id: ACCOUNT,
        tax_code_id: TAX,
        item_id: ITEM,
      },
      {
        description: "Install brass shelf brackets",
        quantity: 2.5,
        unit_price_minor: 4_250,
        income_account_id: ACCOUNT,
        tax_code_id: null,
        item_id: null,
      },
    ]);
    for (const line of submitted) {
      expect(invoiceLineInputSchema.safeParse(line).success).toBe(true);
    }
  });

  it("brings every whole-cent price back to the same cents", () => {
    for (let cents = 0; cents <= 250_000; cents += 1) {
      const form = estimateLineToFormLine({ ...storedLines[0], unit_price_minor: cents });
      if (formLineToLineInput(form).unit_price_minor !== cents) {
        throw new Error(`${cents} cents came back as ${formLineToLineInput(form).unit_price_minor}`);
      }
    }
  });

  it("says why instead when the estimate has already become an invoice", () => {
    const issued = { ...estimate, live_invoice: { invoice_number: "INV-000123" } };
    expect(estimateToInvoicePrefill(issued, storedLines).blocked).toBe(
      "EST-000007 has already been turned into an invoice (INV-000123).",
    );
    const draft = { ...estimate, live_invoice: { invoice_number: null } };
    expect(estimateToInvoicePrefill(draft, storedLines).blocked).toBe(
      "EST-000007 has already been turned into an invoice (a draft invoice).",
    );
  });

  it("says why instead when the estimate is declined", () => {
    const declined = { ...estimate, declined_at: "2026-10-20T15:04:00+00:00" };
    expect(estimateToInvoicePrefill(declined, storedLines).blocked).toBe(
      "EST-000007 is marked declined. Reopen it before turning it into an invoice.",
    );
  });
});

describe("formLinesTotals", () => {
  const rates: Record<string, number> = { [TAX]: 6.25 };
  const rateOf = (id: string | null | undefined) => (id ? rates[id] ?? 0 : 0);

  it("works out subtotal, sales tax and total as the invoice does", () => {
    // 3 × $19.99 = $59.97; 6.25% of 5,997 cents = 374.8125, rounded to 375.
    expect(
      formLinesTotals(
        [{ quantity: 3, unit_price: 19.99, tax_code_id: TAX, income_account_id: ACCOUNT }],
        rateOf,
      ),
    ).toEqual({ subtotalMinor: 5_997, taxTotalMinor: 375, totalMinor: 6_372 });
  });

  it("rounds each line before adding the lines up, not the total", () => {
    // Each line: 1,001 cents, tax 62.5625 → 63. Two lines: 126, where rounding
    // the total instead would give 125.
    const line = { quantity: 1, unit_price: 10.01, tax_code_id: TAX };
    expect(formLinesTotals([line, line], rateOf)).toEqual({
      subtotalMinor: 2_002,
      taxTotalMinor: 126,
      totalMinor: 2_128,
    });
  });

  it("matches the invoice helpers line for line, fractional quantities included", () => {
    const lines = [
      { quantity: 2.5, unit_price: 10.01, tax_code_id: TAX },
      { quantity: 0.333, unit_price: 7.77, tax_code_id: null },
    ];
    const expected = sumInvoiceTotals([
      computeInvoiceLine({ quantity: 2.5, unitPriceMinor: 1_001, taxRatePercent: 6.25 }),
      computeInvoiceLine({ quantity: 0.333, unitPriceMinor: 777, taxRatePercent: 0 }),
    ]);
    expect(formLinesTotals(lines, rateOf)).toEqual(expected);
    expect(expected.subtotalMinor).toBe(2_503 + 259);
  });

  it("leaves out lines the form has not finished: no quantity, a negative price, an empty row", () => {
    expect(
      formLinesTotals(
        [
          undefined,
          null,
          { quantity: 0, unit_price: 50 },
          { quantity: 1, unit_price: -5 },
          { quantity: 2, unit_price: 12.5 },
        ],
        rateOf,
      ),
    ).toEqual({ subtotalMinor: 2_500, taxTotalMinor: 0, totalMinor: 2_500 });
  });

  it("is zero for an empty form", () => {
    expect(formLinesTotals([], rateOf)).toEqual({ subtotalMinor: 0, taxTotalMinor: 0, totalMinor: 0 });
  });
});
