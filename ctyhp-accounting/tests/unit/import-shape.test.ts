import { describe, expect, it } from "vitest";
import { fieldsFor, type ImportTarget } from "@/lib/domain/import-mapping";
import {
  describeShapeMismatch,
  detectFileShape,
  templateCsvFor,
} from "@/lib/domain/import-shape";

const TARGETS: ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
  "transactions",
];

/** The headers of the file attached to feedback report 428ca4db. */
const WAVE_ACCOUNT_TRANSACTIONS = [
  "ACCOUNT NUMBER",
  "DATE",
  "DESCRIPTION",
  "DEBIT (In Business Currency)",
  "CREDIT (In Business Currency)",
  "BALANCE (In Business Currency)",
];

const QUICKBOOKS_CHART = ["Account Number", "Account Name", "Type", "Description", "Balance"];

describe("templateCsvFor", () => {
  it("writes the header row from the mapper's own labels, for every target", () => {
    for (const target of TARGETS) {
      const [header, example, ...rest] = templateCsvFor(target).trim().split("\n");
      const labels = fieldsFor(target).map((field) => field.label);
      expect(header.split(",").length, target).toBe(labels.length);
      expect(example.split(",").length, target).toBe(labels.length);
      expect(rest, target).toEqual([]);
      // Derived, not a second list: every label appears in the header row.
      for (const label of labels) expect(header, `${target}/${label}`).toContain(label);
    }
  });

  it("answers the report's question with a chart of accounts example", () => {
    const csv = templateCsvFor("chart_of_accounts");
    expect(csv).toContain("Account code");
    expect(csv).toContain("121");
  });
});

describe("detectFileShape", () => {
  it("recognises the file from the report as Wave's account transactions", () => {
    const detection = detectFileShape(WAVE_ACCOUNT_TRANSACTIONS);

    expect(detection.looksLikeLedgerDetail).toBe(true);
    expect(detection.looksLikeWaveAccountTransactions).toBe(true);
    // It must not claim this is a chart of accounts; that belief is the bug.
    expect(detection.target).not.toBe("chart_of_accounts");
    // Since slice 4 there is a tab that reads this file whole.
    expect(detection.target).toBe("general_ledger");
  });

  it("keeps ledger detail and the Wave report as two separate signals", () => {
    const noBalance = detectFileShape(["Account", "Date", "Description", "Debit", "Credit"]);

    expect(noBalance.looksLikeLedgerDetail).toBe(true);
    expect(noBalance.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("recognises a genuine chart of accounts export", () => {
    const detection = detectFileShape(QUICKBOOKS_CHART);

    expect(detection.target).toBe("chart_of_accounts");
    expect(detection.matchedRequired).toBe(detection.requiredTotal);
    expect(detection.looksLikeLedgerDetail).toBe(false);
  });

  it("guesses nothing rather than wrongly, for an unrecognisable file", () => {
    const detection = detectFileShape(["foo", "bar", "baz"]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeLedgerDetail).toBe(false);
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("says nothing about an empty file", () => {
    const detection = detectFileShape([]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });
});

describe("describeShapeMismatch", () => {
  it("stays quiet when the file and the tab agree", () => {
    expect(describeShapeMismatch("chart_of_accounts", detectFileShape(QUICKBOOKS_CHART))).toBeNull();
  });

  it("names the Wave report and sends it to the tab that reads it", () => {
    const message = describeShapeMismatch(
      "chart_of_accounts",
      detectFileShape(WAVE_ACCOUNT_TRANSACTIONS),
    );

    expect(message).toBeTruthy();
    expect(message).toMatch(/one row per transaction/i);
    expect(message).toMatch(/general ledger/i);
  });

  it("says nothing once the ledger is on its own tab", () => {
    expect(
      describeShapeMismatch("general_ledger", detectFileShape(WAVE_ACCOUNT_TRANSACTIONS)),
    ).toBeNull();
  });

  it("points at the tab a recognised file belongs in", () => {
    const message = describeShapeMismatch("customers", detectFileShape(QUICKBOOKS_CHART));

    expect(message).toMatch(/chart of accounts/i);
  });
});

/** The file the tester imported: the transactions tab reads exactly this. */
const ONE_BOOK_TRANSACTIONS = [
  "Date",
  "Description",
  "Bank account",
  "Chart of account",
  "Amount",
  "Debit",
  "Credit",
];

describe("a categorized transactions export", () => {
  it("is recognised as belonging to the transactions tab", () => {
    expect(detectFileShape(ONE_BOOK_TRANSACTIONS).target).toBe("transactions");
  });

  it("says nothing when it is already on that tab", () => {
    // It carried a date and debit/credit columns, so the old rule called it
    // "transactions rather than one row per record" — on the transactions tab.
    expect(
      describeShapeMismatch("transactions", detectFileShape(ONE_BOOK_TRANSACTIONS)),
    ).toBeNull();
  });

  it("still warns when the same file lands on the chart of accounts tab", () => {
    const message = describeShapeMismatch(
      "chart_of_accounts",
      detectFileShape(ONE_BOOK_TRANSACTIONS),
    );
    expect(message).toMatch(/transactions/i);
  });

  it("never scolds the general ledger tab about holding transactions", () => {
    // That tab exists to read transactions; the hint would always be wrong.
    const ledgerish = ["Account", "Date", "Description", "Debit", "Credit"];
    expect(describeShapeMismatch("general_ledger", detectFileShape(ledgerish))).toBeNull();
  });
});

describe("templateCsvFor, invoices", () => {
  /** Read one cell out of the example row, by its column label. */
  function cellOf(csv: string, label: string): string {
    const [header, example] = csv.trim().split("\n");
    const columns = header.split(",");
    const index = columns.indexOf(label);
    expect(index, `column ${label}`).toBeGreaterThanOrEqual(0);
    // The example row has no quoted commas in any case this test builds.
    return example.split(",")[index];
  }

  it("does not describe an invoice line as a bank account", () => {
    // Both the chart of accounts and an invoice line carry a field keyed
    // `description`, and the shared example made the invoice template read
    // "Operating checking account" as its line description.
    expect(cellOf(templateCsvFor("invoices"), "Line description")).not.toMatch(/checking account/i);
  });

  it("names a customer, an income account and a tax code the company actually has", () => {
    // A template is an example the reader can import. Its own values must
    // therefore exist: the importer refuses an unknown customer, and refuses a
    // tax code it cannot find.
    const csv = templateCsvFor("invoices", {
      customer: "Le My Hanh Thi",
      income_account: "4100",
      tax_code: "TAX0",
    });
    expect(cellOf(csv, "Customer")).toBe("Le My Hanh Thi");
    expect(cellOf(csv, "Income account")).toBe("4100");
    expect(cellOf(csv, "Sales tax code")).toBe("TAX0");
  });

  it("leaves the tax code empty rather than naming one that does not exist", () => {
    // Sales tax is optional on an invoice line, and an invented code blocks the
    // whole invoice. Empty imports; wrong does not.
    const csv = templateCsvFor("invoices", { customer: "Le My Hanh Thi", tax_code: null });
    expect(cellOf(csv, "Sales tax code")).toBe("");
  });

  it("keeps its placeholder when the company has nothing to offer", () => {
    const csv = templateCsvFor("invoices", {});
    expect(cellOf(csv, "Customer").length).toBeGreaterThan(0);
  });
});
