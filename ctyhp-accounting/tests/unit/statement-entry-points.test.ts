import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("ways into the customer statement (3.0.13)", () => {
  it("AgingByPartyTable links each customer, in both views", () => {
    const table = read("components", "reports", "AgingByPartyTable.tsx");
    expect(table).toContain("statementHref?: (entityId: string) => string");
    expect(table).toContain("statementHref(row.entityId)");
    expect(table).toContain("statementHref(column.entityId)");
    expect(table).toContain("aria-label={`Statement for ${row.entityName}`}");
  });

  it("only A/R Aging passes statementHref", () => {
    expect(read("app", "(app)", "reports", "ar-aging", "ArAgingClient.tsx")).toContain(
      "`/customers/${id}/statement?asOf=${ranAsOf}`",
    );
    expect(read("app", "(app)", "reports", "ap-aging", "ApAgingClient.tsx")).not.toContain("statementHref");
  });

  it("the activity Customer Statement opens on ?customer=", () => {
    const page = read("app", "(app)", "reports", "customer-statement", "page.tsx");
    expect(page).toContain("searchParams");
    expect(page).toContain("initialCustomerId");
    expect(page).toContain("customers.some(");
    expect(read("app", "(app)", "reports", "customer-statement", "CustomerStatementClient.tsx")).toContain(
      "useState<string | undefined>(initialCustomerId)",
    );
  });

  it("a printed aging report carries no Statement links", () => {
    expect(read("components", "reports", "aging-party.module.css")).toMatch(/@media print/);
  });
});
