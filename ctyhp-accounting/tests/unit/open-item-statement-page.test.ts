import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The open-item statement page (3.0.13): the route, its toolbar, the A4 sheet
 * and its stylesheet. The model behind every string is tested in
 * open-item-statement.test.ts; this pins how the page is wired to it.
 */
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
const route = (file: string) => read("app", "(app)", "customers", "[id]", "statement", file);
/** Words on screen, whole: JSX text (`>Print<`) or a string (`"Print"`, `title="…"`). */
const shown = (text: string) =>
  new RegExp(`(>\\s*|")${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*<|")`);

describe("the open-item statement page", () => {
  const page = route("page.tsx");
  const client = route("OpenItemStatementClient.tsx");
  const loading = route("loading.tsx");
  const sheet = read("components", "statements", "OpenItemStatementSheet.tsx");
  const css = read("components", "statements", "open-item-statement.module.css");

  describe("page.tsx", () => {
    it("answers an id that names no customer with Page not found", () => {
      expect(page).toContain("customerIdSchema.safeParse(id)");
      expect(page).toContain("notFound()");
      // Both branches: the id check, and a customer the read did not find.
      expect(page).toMatch(/customerIdSchema\.safeParse\(id\)\.success\) notFound\(\)/);
      expect(page).toMatch(/if \(!found\) notFound\(\)/);
      expect(page.match(/notFound\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it("reads the statement for the company's day, or the day asked for", () => {
      expect(page).toContain("companyToday(sb)");
      expect(page).toContain("parseStatementAsOf(");
      expect(page).toContain("readOpenItemStatement(sb, id, asOf)");
    });

    it("titles the page for the customer, with a way back to their page", () => {
      expect(page).toContain("`Statement for ${");
      expect(page).toMatch(/href: `\/customers\/\$\{id\}`/);
    });

    it("starts the toolbar afresh for another day", () => {
      expect(page).toMatch(/key=\{asOf\}/);
    });
  });

  describe("OpenItemStatementClient.tsx", () => {
    it("prints the sheet alone, from its button and from Ctrl+P", () => {
      expect(client).toMatch(/useEffect\(\(\) => watchReportPrinting\(\), \[\]\)/);
      expect(client).toContain("printReport()");
      expect(client).toContain('className="report-print-area"');
    });

    it("downloads the PDF and opens the email from the same statement", () => {
      expect(client).toContain("downloadOpenItemStatementPdf(");
      expect(client).toContain("openItemStatementEmail(statement)");
      // The tooltip that says there is no address is there only when there is none.
      expect(client).toContain("statement.customerEmail");
    });

    it("links to the activity statement and to another day's statement", () => {
      expect(client).toContain("`/reports/customer-statement?customer=${customerId}`");
      expect(client).toContain("`/customers/${customerId}/statement?asOf=");
    });

    it("names its actions", () => {
      for (const text of ["Print", "Download PDF", "Email", "Activity statement"]) {
        expect(client, text).toMatch(shown(text));
      }
      expect(client).toContain('"Attach the PDF before sending."');
      expect(client).toContain('"No email saved for this customer: your mail program opens without a recipient. Attach the PDF before sending."');
      // One Tooltip, always; no native title on the Email button.
      expect(client).not.toMatch(/<Button[^>]*title=/);
      expect(client).toContain("<Tooltip title={statement.customerEmail ? ATTACH_HINT : NO_EMAIL}>");
      expect(client).toContain('console.error("Statement PDF failed:", error)');
      expect(client).toContain("disabledDate={(day) => day.isAfter(dayjs(today))}");
      expect(page).toContain("today={today}");
      expect(client).toContain('"The PDF could not be made. Try again."');
    });
  });

  describe("OpenItemStatementSheet.tsx", () => {
    it("says who it is for, how to pay, and what the figures are", () => {
      expect(sheet).toMatch(shown("Statement for"));
      expect(sheet).toMatch(shown("How to pay."));
      expect(sheet).toContain("statement.footnote");
      expect(sheet).toContain("statement.emptyText");
    });

    it("heads its table Date, Description, Due, Age, Amount, Outstanding", () => {
      const at = ["Date", "Description", "Due", "Age", "Amount", "Outstanding"].map((heading) =>
        sheet.search(new RegExp(`>${heading}</th>`)),
      );
      for (const index of at) expect(index).toBeGreaterThan(-1);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it("marks an overdue age, and a credit's figures, apart from the rest", () => {
      expect(sheet).toContain("line.overdue");
      expect(sheet).toContain("line.outstandingMinor < 0");
      expect(css).toContain("var(--ob-money-negative)");
    });

    it("is plain HTML, readable on the server and on paper", () => {
      expect(sheet).not.toMatch(/from ["']antd["']/);
      expect(sheet).not.toMatch(/^\s*["']use client["']/);
    });
  });

  describe("open-item-statement.module.css", () => {
    it("is an A4 sheet that scrolls inside its own box", () => {
      expect(css).toMatch(/max-width:\s*794px/);
      expect(css).toMatch(/overflow-x:\s*auto/);
      expect(css).toMatch(/@media print/);
      // On paper the page is the sheet: no frame, and no width of its own.
      const print = css.slice(css.indexOf("@media print"));
      expect(print).toMatch(/min-width:\s*0/);
      expect(print).toMatch(/max-width:\s*none/);
      expect(print).toMatch(/box-shadow:\s*none/);
    });

    it("takes every colour from a theme token", () => {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });
  });

  describe("loading.tsx", () => {
    it("is a skeleton, with no Typography sub-component a server component cannot read", () => {
      expect(loading).toContain("Skeleton");
      expect(loading).not.toContain("Typography");
    });
  });
});
