import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { TONES } from "@/lib/design/tone";
import {
  ESTIMATE_COLUMN_WIDTH,
  ESTIMATE_ELASTIC_FLOOR,
  ESTIMATE_STATE_TONES,
} from "@/app/(app)/estimates/estimate-columns";
import {
  ESTIMATE_STATES,
  ESTIMATE_STATE_LABELS,
  estimateConversionHref,
  estimateToInvoicePrefill,
  invoiceFormFromEstimate,
  type EstimateLineValues,
} from "@/lib/domain/estimates";
import { defaultTaxCodeForState } from "@/lib/domain/tax-jurisdiction";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const ROOT = process.cwd();
const ESTIMATES_DIR = join(ROOT, "app", "(app)", "estimates");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("the Estimates list fits the screen", () => {
  it("fits the 984px box of a 1280px window, with Customer at its floor", () => {
    expect(ESTIMATE_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    const measured = sum(Object.values(ESTIMATE_COLUMN_WIDTH));
    expect(fitsBox(measured, ESTIMATE_ELASTIC_FLOOR)).toBe(true);
    expect(measured + ESTIMATE_ELASTIC_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
  });

  it("measures its columns from the shared tokens, giving every date at least the date token", () => {
    expect(ESTIMATE_COLUMN_WIDTH.number).toBe(COLUMN.CODE);
    expect(ESTIMATE_COLUMN_WIDTH.date).toBe(COLUMN.DATE);
    expect(ESTIMATE_COLUMN_WIDTH.validUntil).toBeGreaterThanOrEqual(COLUMN.DATE);
    expect(ESTIMATE_COLUMN_WIDTH.total).toBe(COLUMN.MONEY);
    expect(ESTIMATE_COLUMN_WIDTH.state).toBe(COLUMN.STATUS);
    expect(ESTIMATE_COLUMN_WIDTH.invoice).toBe(COLUMN.CODE);
    expect(ESTIMATE_COLUMN_WIDTH.actions).toBeGreaterThanOrEqual(COLUMN.ACTION);
  });

  it("draws every measured width it adds up, so the sum above is the table's", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    for (const key of Object.keys(ESTIMATE_COLUMN_WIDTH)) {
      expect(client, key).toContain(`width: W.${key}`);
    }
    // Eight columns: seven measured and Customer, the elastic one.
    expect(client.match(/width: W\.\w+/g)).toHaveLength(Object.keys(ESTIMATE_COLUMN_WIDTH).length);
    expect(client).toContain("floor: ESTIMATE_ELASTIC_FLOOR");
  });

  it("reads every state in its own word, on the shared tones", () => {
    for (const state of ESTIMATE_STATES) {
      expect(ESTIMATE_STATE_TONES[state].label).toBe(ESTIMATE_STATE_LABELS[state]);
      expect(TONES).toContain(ESTIMATE_STATE_TONES[state].tone);
    }
    expect(ESTIMATE_STATE_TONES.converted.tone).toBe("positive");
    expect(ESTIMATE_STATE_TONES.expired.tone).toBe("warning");
  });
});

describe("the Estimates screen's sources", () => {
  const files = readdirSync(ESTIMATES_DIR).filter((file) => /\.(tsx?|css)$/.test(file));
  const sources = files.map((file) => ({ file, source: readFileSync(join(ESTIMATES_DIR, file), "utf8") }));

  it("finds the files it is guarding", () => {
    expect(files).toEqual(expect.arrayContaining(["page.tsx", "EstimatesClient.tsx", "EstimateFormModal.tsx"]));
  });

  it("draws the list through DataTable, never Ant Design's Table", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(client).toMatch(/<DataTable<EstimateListEntry>/);
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/<Table(?!\w)/);
      expect(source, file).not.toMatch(/import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*"antd"/);
    }
  });

  it("never asks for a horizontal scroll or pins a page size", () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
      expect(source, file).not.toMatch(/pageSize\s*[:=]\s*\d/);
    }
  });

  it("opens the New estimate form from ?new=1 only after hydration", () => {
    expect(read("app", "(app)", "estimates", "page.tsx")).toContain('.new === "1"');
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('import { useInitiallyOpen } from "@/lib/client/use-initially-open"');
    expect(client).toContain("useInitiallyOpen(initialCreateOpen)");
  });

  it("never takes today from the browser's clock", () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("new Date().toISOString()");
      expect(source, file).not.toMatch(/\bdayjs\(\)/);
    }
    // The day every state is judged on is the company's, worked out on the server.
    const page = read("app", "(app)", "estimates", "page.tsx");
    expect(page).toContain("companyClock(sb)");
    expect(page).toContain("estimateStateOf(row, clock.today)");
    expect(page).toContain("today={clock.today}");
  });

  it("shows the spec's words: the title, the intro and the empty list", () => {
    const page = read("app", "(app)", "estimates", "page.tsx");
    expect(page).toContain('title="Estimates"');
    expect(page).toContain(
      "An estimate is a price promised to a customer. It is not in the books: nothing posts until the invoice made from it is issued.",
    );
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('"No estimates yet"');
    const form = readFileSync(join(ESTIMATES_DIR, "EstimateFormModal.tsx"), "utf8");
    expect(form).toContain('label="Note printed at the foot"');
  });

  it("keeps Valid until from being cleared, so a blank date cannot reset it to 30 days", () => {
    const form = readFileSync(join(ESTIMATES_DIR, "EstimateFormModal.tsx"), "utf8");
    expect(form).toContain("<DatePicker allowClear={false} onChange={() => setExpiryFollowsDate(false)} />");
  });

  it("asks before a delete and before turning an expired estimate into an invoice, in the shared words", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain("estimateMessages.deleteConfirm(row.estimate_number)");
    expect(client).toContain("estimateMessages.expiredConfirm(target.estimate_number, target.expiry_date)");
    expect(client).toContain("estimateMessages.declined(n)");
    expect(client).toContain("estimateMessages.reopened(n)");
    expect(client).toContain("router.push(estimateConversionHref(target.id))");
  });
});

// --- Turning an estimate into an invoice ------------------------------------

const ESTIMATE_ID = "6f1c2a7e-0b5d-4c8e-9a31-2d4e5f6a7b8c";
const CUSTOMER_ID = "0c9d8e7f-6a5b-4c3d-8e1f-a2b3c4d5e6f7";
const ACCOUNT_ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const MA_RATE_ID = "7e6d5c4b-3a2f-4e1d-9c0b-a1b2c3d4e5f6";

const lines: EstimateLineValues[] = [
  {
    line_order: 2,
    item_id: null,
    // Deliberately untaxed: a service the sample company does not tax.
    description: "Design consultation",
    quantity: 2,
    unit_price_minor: 7_500,
    income_account_id: ACCOUNT_ID,
    tax_code_id: null,
  },
  {
    line_order: 1,
    item_id: "9f8e7d6c-5b4a-4398-8776-655443322110",
    description: "Sample pendant",
    quantity: 1,
    unit_price_minor: 42_000,
    income_account_id: ACCOUNT_ID,
    tax_code_id: MA_RATE_ID,
  },
];

const prefill = estimateToInvoicePrefill(
  {
    id: ESTIMATE_ID,
    estimate_number: "EST-000007",
    customer_id: CUSTOMER_ID,
    declined_at: null,
    live_invoice: null,
  },
  lines,
);

describe("invoiceFormFromEstimate", () => {
  it("keeps each line's tax code exactly, so an untaxed line is not taxed on the way", () => {
    // Picking this customer by hand would fill the state's rate into every
    // line without one: the customer is in MA and the company has one MA rate.
    const maRate = {
      id: MA_RATE_ID,
      code: "MA-6.25",
      name: "Massachusetts sales tax",
      rate_percent: 6.25,
      direction: "sales" as const,
      tax_account_id: null,
      is_active: true,
      state_code: "MA",
    };
    expect(defaultTaxCodeForState("MA", [maRate])?.id).toBe(MA_RATE_ID);

    const values = invoiceFormFromEstimate(prefill, {
      currencyCode: "USD",
      customerTermsDays: 15,
      defaultTermsDays: 30,
    });
    expect(values.lines.map((line) => line.tax_code_id)).toEqual([MA_RATE_ID, null]);
  });

  it("carries the customer, the currency and every line in the estimate's order, losing nothing", () => {
    const values = invoiceFormFromEstimate(prefill, {
      currencyCode: "USD",
      customerTermsDays: null,
      defaultTermsDays: 30,
    });
    expect(values.customer_id).toBe(CUSTOMER_ID);
    expect(values.currency_code).toBe("USD");
    expect(values.lines).toEqual([
      {
        item_id: "9f8e7d6c-5b4a-4398-8776-655443322110",
        description: "Sample pendant",
        quantity: 1,
        unit_price: 420,
        income_account_id: ACCOUNT_ID,
        tax_code_id: MA_RATE_ID,
      },
      {
        item_id: null,
        description: "Design consultation",
        quantity: 2,
        unit_price: 75,
        income_account_id: ACCOUNT_ID,
        tax_code_id: null,
      },
    ]);
  });

  it("sets the due date from the customer's terms, as picking the customer would", () => {
    const terms = (customerTermsDays: number | null | undefined) =>
      invoiceFormFromEstimate(prefill, { currencyCode: "USD", customerTermsDays, defaultTermsDays: 30 }).dueInDays;
    expect(terms(15)).toBe(15);
    expect(terms(0)).toBe(0);
    expect(terms(null)).toBe(30);
    expect(terms(undefined)).toBe(30);
  });

  it("hands the form its own copies, so editing the form cannot change the prefill", () => {
    const values = invoiceFormFromEstimate(prefill, { currencyCode: "USD", customerTermsDays: null, defaultTermsDays: 30 });
    values.lines[0].quantity = 99;
    expect(prefill.values.lines[0].quantity).toBe(1);
  });
});

describe("estimateConversionHref", () => {
  it("opens New invoice on the Invoices screen, filled in from the estimate", () => {
    expect(estimateConversionHref(ESTIMATE_ID)).toBe(`/invoices?new=1&estimate=${ESTIMATE_ID}`);
  });
});

describe("the Invoices screen opened from an estimate", () => {
  const page = read("app", "(app)", "invoices", "page.tsx");
  const client = read("app", "(app)", "invoices", "InvoicesClient.tsx");

  it("reads the estimate on the server, for writers only, and never lets a failure take the list down", () => {
    expect(page).toContain("estimateLink(sb, params.estimate)");
    expect(page).toContain("if (!canWrite(await getUserRole())) return { prefill: null, notice: null };");
    expect(page).toContain("} catch (err) {");
    expect(page).toContain("return { prefill: null, notice: `The estimate could not be read${reason}` };");
    // A blocked estimate says so instead of opening a form.
    expect(page).toContain('const initialCreateOpen = params.new === "1" && fromEstimate.notice === null;');
  });

  it("fills the form through invoiceFormFromEstimate, not by picking the customer", () => {
    expect(client).toContain("invoiceFormFromEstimate(fromEstimate,");
    expect(client).toContain("initialValues={estimateFormValues ??");
    // applyCustomerDefaults runs only when somebody picks a customer.
    expect(client.match(/applyCustomerDefaults/g)).toHaveLength(2);
    expect(client).toContain("onChange={applyCustomerDefaults}");
  });

  it("sends the estimate with the draft, and says what happened in the spec's words", () => {
    expect(client).toContain("estimateId: fromEstimate.estimateId");
    expect(client).toContain("estimateMessages.invoiceCreated(fromEstimate.estimateNumber)");
    expect(client).toContain("estimateMessages.fromEstimate(fromEstimate.estimateNumber)");
    expect(client).toContain("setCreateError(res.error");
  });

  it("names the estimate in the invoice's detail, linking to Estimates", () => {
    expect(client).toContain('<Link href="/estimates">{estimateMessages.fromEstimate(viewEstimate.estimate_number)}</Link>');
  });

  it("clears the estimate's fields when New invoice opens, so a cancelled draft cannot leak into it", () => {
    const start = client.indexOf("function openCreate()");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = client.indexOf("setOpen(true);", start);
    const body = client.slice(start, end);
    const setter = body.slice(body.indexOf("form.setFieldsValue({"));
    expect(setter).toContain("customer_id: undefined,");
    expect(setter).toContain("issue_date: undefined,");
    expect(setter).toContain("due_date: undefined,");
    expect(setter).toContain("memo: undefined,");
  });
});
