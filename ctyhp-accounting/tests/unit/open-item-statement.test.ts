import { describe, expect, it } from "vitest";
import { formatLongDate } from "@/lib/format";
import { daysPastDue } from "@/lib/domain/aging";
import {
  buildOpenItemStatement,
  openItemAmountMinor,
  openItemDescription,
  openItemStatementDocument,
  openItemStatementEmail,
  openItemStatementFileName,
  parseStatementAsOf,
  type OpenItemSource,
  type OpenItemStatementInput,
} from "@/lib/domain/open-item-statement";

const company = {
  legal_name: "Meridian Goods LLC",
  dba_name: null,
  address_line1: "100 Market Street",
  address_line2: null,
  city: "San Francisco",
  region: "CA",
  postal_code: "94105",
  country: "United States",
  phone: "+1 415 555 0100",
  email: "ar@meridian.example",
  pay_note: "Pay by ACH to account 000123456, routing 121000248.",
};
const customer = {
  name: "BlueRidge Foods",
  email: "billing@blueridge.example",
  contact_name: "Dana Lee",
  phone: "+1 828 555 0199",
  address_line1: "12 Mill Road",
  address_line2: null,
  city: "Asheville",
  region: "NC",
  postal_code: "28801",
  country: "United States",
};

const overdueInvoice: OpenItemSource = {
  docType: "invoice",
  docNumber: "INV-000004",
  docDate: "2026-03-24",
  dueDate: "2026-04-23",
  outstandingMinor: 1_000_000,
  detail: { totalMinor: 2_680_000, openMinor: 1_000_000, currencyCode: "USD", note: "Wholesale order, spring collection" },
};
const unappliedPayment: OpenItemSource = {
  docType: "payment",
  docNumber: "PMT-000009",
  docDate: "2026-10-01",
  dueDate: "2026-10-01",
  outstandingMinor: -120_000,
  detail: { totalMinor: 500_000, openMinor: 120_000, currencyCode: "USD", note: "RCV-1010" },
};
const currentInvoice: OpenItemSource = {
  docType: "invoice",
  docNumber: "INV-000011",
  docDate: "2026-11-01",
  dueDate: "2026-12-01",
  outstandingMinor: 250_000,
  detail: { totalMinor: 250_000, openMinor: 250_000, currencyCode: "USD", note: null },
};

const input = (over: Partial<OpenItemStatementInput> = {}): OpenItemStatementInput => ({
  asOf: "2026-11-10",
  today: "2026-11-10",
  company,
  customer,
  // Out of order on purpose: the statement sorts by date.
  items: [currentInvoice, overdueInvoice, unappliedPayment],
  currencyCode: "USD",
  decimals: 2,
  ...over,
});

describe("formatLongDate", () => {
  it("writes the month out", () => {
    expect(formatLongDate("2026-11-10")).toBe("November 10, 2026");
    expect(formatLongDate("2026-01-05")).toBe("January 5, 2026");
  });
  it("returns anything else as it was", () => {
    expect(formatLongDate("soon")).toBe("soon");
  });
});

describe("daysPastDue", () => {
  it("counts calendar days from the due date", () => {
    expect(daysPastDue("2026-04-23", "2026-11-10")).toBe(201);
    expect(daysPastDue("2026-12-01", "2026-11-10")).toBe(-21);
  });
});

describe("parseStatementAsOf", () => {
  it("keeps a real date", () => {
    expect(parseStatementAsOf("2026-10-31", "2026-11-10")).toBe("2026-10-31");
  });
  it("falls back to today for anything else", () => {
    expect(parseStatementAsOf(undefined, "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf("2026-02-30", "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf("yesterday", "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf(["2026-10-31", "2026-10-30"], "2026-11-10")).toBe("2026-11-10");
  });
});

describe("openItemDescription", () => {
  it("names each kind of line", () => {
    expect(openItemDescription("invoice", "Wholesale order")).toBe("Wholesale order");
    expect(openItemDescription("invoice", null)).toBe("Invoice");
    expect(openItemDescription("credit_memo", "Damaged stock")).toBe("Credit memo: Damaged stock");
    expect(openItemDescription("credit_memo", "  ")).toBe("Credit memo");
    expect(openItemDescription("payment", "RCV-1010")).toBe("Payment received, ref RCV-1010");
    expect(openItemDescription("payment", null)).toBe("Payment received");
  });
  it("cuts a long description to 44 characters", () => {
    const text = openItemDescription("invoice", "Custom engagement ring set with matching   wedding bands and engraving");
    expect(text).toHaveLength(44);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain("  ");
  });
});

describe("openItemAmountMinor", () => {
  it("is the document's total, signed as its outstanding", () => {
    expect(openItemAmountMinor(overdueInvoice, "USD")).toBe(2_680_000);
    expect(openItemAmountMinor(unappliedPayment, "USD")).toBe(-500_000);
  });
  it("converts a foreign document at the rate its outstanding was converted", () => {
    const euro: OpenItemSource = {
      ...overdueInvoice,
      outstandingMinor: 540_000,
      detail: { totalMinor: 1_000_000, openMinor: 500_000, currencyCode: "EUR", note: null },
    };
    expect(openItemAmountMinor(euro, "USD")).toBe(1_080_000);
  });
  it("falls back to the outstanding when the document was not found", () => {
    expect(openItemAmountMinor({ ...overdueInvoice, detail: null }, "USD")).toBe(1_000_000);
  });
});

describe("buildOpenItemStatement", () => {
  const s = buildOpenItemStatement(input());

  it("lists the lines by date with their ages", () => {
    expect(s.lines.map((l) => l.docNumber)).toEqual(["INV-000004", "PMT-000009", "INV-000011"]);
    expect(s.lines[0]).toMatchObject({
      date: "03/24/2026",
      description: "Wholesale order, spring collection",
      due: "04/23/2026",
      age: "201 days",
      amount: "$26,800.00",
      outstanding: "$10,000.00",
      overdue: true,
    });
    expect(s.lines[1]).toMatchObject({ due: "—", age: "40 days", amount: "-$5,000.00", outstanding: "-$1,200.00", overdue: false });
    expect(s.lines[2]).toMatchObject({ description: "Invoice", due: "12/01/2026", age: "current", overdue: false });
  });

  it("ages the buckets as A/R Aging does and nets the total", () => {
    expect(s.buckets.map((b) => [b.label, b.amount])).toEqual([
      ["Current", "$2,500.00"],
      ["1–30 days", "$0.00"],
      ["31–60 days", "-$1,200.00"],
      ["61–90 days", "$0.00"],
      ["Over 90 days", "$10,000.00"],
    ]);
    expect(s.totalMinor).toBe(1_130_000);
    expect(s.totalLabel).toBe("Total due");
    expect(s.totalAmount).toBe("$11,300.00");
    expect(s.overdueCount).toBe(1);
  });

  it("carries the header, the party and the pay note", () => {
    expect(s.asOfText).toBe("11/10/2026");
    expect(s.asOfLong).toBe("November 10, 2026");
    expect(s.companyName).toBe("Meridian Goods LLC");
    expect(s.party.name).toBe("BlueRidge Foods");
    expect(s.party.lines).toContain("billing@blueridge.example");
    expect(s.payNote).toBe(company.pay_note);
    expect(s.emptyText).toBeNull();
  });

  it("says the figures are as at today, and why some are negative", () => {
    expect(s.footnote).toBe(
      "Every figure is as at November 10, 2026. Anything paid after that date is not reflected here. " +
        "Payments not yet applied and unused credits are shown as negative amounts and reduce the total.",
    );
  });

  it("says plainly that a past date only limits and ages the documents", () => {
    const past = buildOpenItemStatement(input({ asOf: "2026-10-31", items: [overdueInvoice] }));
    expect(past.footnote).toBe(
      "Lists what was dated on or before October 31, 2026, aged to that date. " +
        "Amounts outstanding are as they stand on November 10, 2026.",
    );
  });

  it("reads Credit balance when credits exceed what is owed, and asks for nothing", () => {
    const credit = buildOpenItemStatement(input({ items: [unappliedPayment] }));
    expect(credit.totalLabel).toBe("Credit balance");
    expect(credit.totalAmount).toBe("$1,200.00");
    expect(credit.payNote).toBeNull();
  });

  it("says nothing is outstanding when there are no items", () => {
    const empty = buildOpenItemStatement(input({ items: [] }));
    expect(empty.lines).toEqual([]);
    expect(empty.emptyText).toBe("Nothing outstanding as of November 10, 2026.");
    expect(empty.totalAmount).toBe("$0.00");
    expect(empty.payNote).toBeNull();
  });
});

describe("openItemStatementEmail", () => {
  it("addresses the customer with the prototype's wording", () => {
    const mail = openItemStatementEmail(buildOpenItemStatement(input()));
    expect(mail.to).toBe("billing@blueridge.example");
    expect(mail.subject).toBe("Statement from Meridian Goods LLC as of 11/10/2026");
    expect(mail.body.split("\r\n")).toEqual([
      "Dear BlueRidge Foods,",
      "",
      "A statement of your account with Meridian Goods LLC as at November 10, 2026.",
      "",
      "  03/24/2026   INV-000004   $10,000.00   due 04/23/2026   201 days overdue",
      "  10/01/2026   PMT-000009   -$1,200.00",
      "  11/01/2026   INV-000011   $2,500.00   due 12/01/2026",
      "",
      "Total due: $11,300.00 USD",
      "",
      "1 of these is past the due date.",
      "",
      company.pay_note,
      "",
      "If any line does not match your own records, tell me which one and I will look into it.",
      "",
      "Meridian Goods LLC",
    ]);
    expect(mail.href.startsWith("mailto:billing@blueridge.example?subject=Statement%20from%20Meridian")).toBe(true);
    expect(mail.href).toContain("%0D%0A");
  });

  it("lists at most 15 documents", () => {
    const many = Array.from({ length: 17 }, (_, i) => ({
      ...currentInvoice,
      docNumber: `INV-1${String(i).padStart(5, "0")}`,
    }));
    const body = openItemStatementEmail(buildOpenItemStatement(input({ items: many }))).body;
    expect(body.split("\r\n").filter((line) => line.startsWith("  11/01/2026"))).toHaveLength(15);
    expect(body).toContain("  …and 2 more, listed in the attached statement.");
  });

  it("opens without a recipient when the customer has no email", () => {
    const mail = openItemStatementEmail(buildOpenItemStatement(input({ customer: { ...customer, email: null } })));
    expect(mail.to).toBe("");
    expect(mail.href.startsWith("mailto:?subject=")).toBe(true);
  });

  it("says nothing is outstanding instead of listing", () => {
    const body = openItemStatementEmail(buildOpenItemStatement(input({ items: [] }))).body;
    expect(body).toContain("Nothing is outstanding on your account as at November 10, 2026.");
    expect(body).not.toContain("Total due");
  });
});

describe("edge cases", () => {
  it("says what a past date lists when nothing is open", () => {
    const s = buildOpenItemStatement(input({ asOf: "2026-10-31", today: "2026-11-10", items: [] }));
    expect(s.emptyText).toBe("Nothing dated on or before October 31, 2026 is outstanding on November 10, 2026.");
    const mail = openItemStatementEmail(s);
    expect(mail.body).toContain(
      "Nothing dated on or before October 31, 2026 is outstanding on your account on November 10, 2026.",
    );
    expect(mail.body.split("\r\n")[2]).toBe(
      "A statement of your account with Meridian Goods LLC: what was dated on or before October 31, 2026 and is still outstanding on November 10, 2026.",
    );
  });

  it("is Total due, not a credit, when the total is exactly zero", () => {
    const invoice: OpenItemSource = {
      ...currentInvoice,
      outstandingMinor: 120_000,
      detail: { totalMinor: 120_000, openMinor: 120_000, currencyCode: "USD", note: null },
    };
    const s = buildOpenItemStatement(input({ items: [invoice, unappliedPayment] }));
    expect(s.totalLabel).toBe("Total due");
    expect(s.totalAmount).toBe("$0.00");
    expect(s.payNote).toBeNull();
    expect(s.emptyText).toBeNull();
  });

  it("says 1 day and 1 of these is past due, then 2 of these are", () => {
    const oneDay: OpenItemSource = { ...currentInvoice, docNumber: "INV-000012", docDate: "2026-10-10", dueDate: "2026-11-09" };
    const one = buildOpenItemStatement(input({ items: [oneDay] }));
    expect(one.lines[0].age).toBe("1 day");
    const mail = openItemStatementEmail(one);
    expect(mail.body.split("\r\n").find((l) => l.includes("INV-000012"))?.endsWith("1 day overdue")).toBe(true);
    const two = openItemStatementEmail(buildOpenItemStatement(input({ items: [oneDay, overdueInvoice] })));
    expect(two.body).toContain("2 of these are past the due date.");
  });
});

describe("openItemStatementDocument", () => {
  it("is what the PDF draws", () => {
    const doc = openItemStatementDocument(buildOpenItemStatement(input()));
    expect(doc.title).toBe("Statement");
    expect(doc.partyHeading).toBe("STATEMENT FOR");
    expect(doc.meta).toEqual([
      { label: "As of", value: "11/10/2026" },
      { label: "Open items", value: "3" },
    ]);
    expect(doc.table.head).toEqual(["Date", "Description", "Due", "Age", "Amount", "Outstanding"]);
    expect(doc.table.rightAligned).toEqual([2, 3, 4, 5]);
    expect(doc.table.body[0]).toEqual([
      "03/24/2026\nINV-000004",
      "Wholesale order, spring collection",
      "04/23/2026",
      "201 days",
      "$26,800.00",
      "$10,000.00",
    ]);
    expect(doc.totals.map((t) => t.label)).toEqual([
      "Current",
      "1–30 days",
      "31–60 days",
      "61–90 days",
      "Over 90 days",
      "Total due",
    ]);
    expect(doc.memo).toBeNull();
    expect(doc.lines).toEqual([]);
  });

  it("prints only the empty sentence when nothing is open", () => {
    const doc = openItemStatementDocument(buildOpenItemStatement(input({ items: [] })));
    expect(doc.table.body).toEqual([]);
    expect(doc.totals).toEqual([]);
    expect(doc.memo).toBe("Nothing outstanding as of November 10, 2026.");
  });
});

describe("openItemStatementFileName", () => {
  it("names the customer and the day", () => {
    expect(openItemStatementFileName(buildOpenItemStatement(input()))).toBe("statement-blueridge-foods-2026-11-10.pdf");
  });
});
