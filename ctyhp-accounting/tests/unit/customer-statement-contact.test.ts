import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportPdf } from "@/lib/client/report-export";
import { partyStatementSheet } from "@/lib/domain/ledger-report-sheets";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { StatementReport } from "@/lib/services/aging";

/**
 * 3.0.45. The Customer Statement goes to the customer. Until now it printed
 * only the company's name, so a customer reading it had no address, phone or
 * email to answer it with. Invoices have printed them since 2.99, and so has
 * the open-item statement since 3.0.13.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

const report = { openingMinor: 0, closingMinor: 4000, rows: [] } as unknown as StatementReport;
const when = { from: "2026-09-01", to: "2026-09-30" };
const lines = ["100 Example Street", "Springfield, IL 62701", "(555) 010-0100", "billing@example.com"];
const ctx = { companyName: "Example Jewelry LLC", currencyCode: "USD", baseDecimals: 2, companyLines: lines };

const pdfText = async (sheet: ReportExportSheet) =>
  new TextDecoder("latin1").decode(new Uint8Array((await buildReportPdf(sheet)).output("arraybuffer") as ArrayBuffer));

describe("the customer statement says how to reach the company", () => {
  it("carries the company's address, phone and email on a customer statement", () => {
    expect(partyStatementSheet("customer", "Example Customer", report, when, ctx).companyLines).toEqual(lines);
  });

  it("leaves them off a vendor statement, which stays inside the company", () => {
    expect(partyStatementSheet("vendor", "Example Vendor", report, when, ctx).companyLines).toBeUndefined();
  });

  it("leaves them off when the company has saved none", () => {
    const sheet = partyStatementSheet("customer", "Example Customer", report, when, { ...ctx, companyLines: [] });
    expect(sheet.companyLines).toBeUndefined();
  });

  it("prints them in the PDF between the company's name and the title", async () => {
    const sheet = partyStatementSheet("customer", "Example Customer", report, when, ctx);
    const page = await pdfText(sheet);
    const name = page.indexOf("(Example Jewelry LLC)");
    const contact = page.indexOf("(100 Example Street");
    const title = page.indexOf("(Customer Statement)");
    expect(name).toBeGreaterThan(-1);
    expect(contact).toBeGreaterThan(name);
    expect(title).toBeGreaterThan(contact);
    expect(page).toContain("billing@example.com");
  });

  it("prints a sheet without them as before", async () => {
    const sheet = partyStatementSheet("vendor", "Example Vendor", report, when, ctx);
    expect(await pdfText(sheet)).not.toContain("Example Street");
  });

  it("is wired from the company's settings to the statement's header", () => {
    expect(read("lib", "services", "report-context.ts")).toContain(
      "companyLines: settings ? documentSeller(settings).lines : [],",
    );
    expect(read("app", "(app)", "reports", "customer-statement", "page.tsx")).toContain(
      "companyLines={ctx.companyLines}",
    );
    const client = read("app", "(app)", "reports", "customer-statement", "CustomerStatementClient.tsx");
    expect(client).toContain("companyLines={companyLines}");
    expect(client).toContain("baseDecimals, companyLines }");
    expect(read("components", "reports", "ReportPaper.tsx")).toContain('companyLines.join(" · ")');
  });
});
