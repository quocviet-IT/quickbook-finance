import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const invoicesPage = read("app/(app)/invoices/page.tsx");
const paymentsPage = read("app/(app)/payments/page.tsx");
const invoicesClient = read("app/(app)/invoices/InvoicesClient.tsx");
const paymentsClient = read("app/(app)/payments/PaymentsClient.tsx");
const receiveModal = read("app/(app)/payments/ReceivePaymentModal.tsx");

describe("opening New invoice / Receive payment with a customer chosen", () => {
  it("both pages read ?customer=", () => {
    expect(invoicesPage).toContain("params.customer");
    expect(paymentsPage).toContain("params.customer");
  });

  it("invoices only prefill an active customer, and never over an estimate", () => {
    expect(invoicesPage).toContain("c.is_active");
    expect(invoicesPage).toContain("!params.estimate");
    expect(invoicesPage).toContain("initialCustomerId={prefillCustomer}");
  });

  it("InvoicesClient applies the customer once, with its defaults", () => {
    expect(invoicesClient).toContain("initialCustomerId");
    expect(invoicesClient).toContain("applyCustomerDefaults(initialCustomerId)");
    expect(invoicesClient).toContain("prefilled.current");
  });

  it("only the first ordinary receipt gets the customer", () => {
    expect(paymentsClient).toContain("receiveSession === 0 && !basis");
  });

  it("ReceivePaymentModal chooses the customer and loads their open invoices", () => {
    expect(receiveModal).toContain("customer_id: initialCustomerId");
    expect(receiveModal).toContain("getOpenInvoicesAction(initialCustomerId)");
  });
});
