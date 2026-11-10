import { describe, expect, it } from "vitest";
import type { FormInstance } from "antd";
import {
  customerSavedMessage,
  draftInvoiceCreatedMessage,
  salesLineAmountMinor,
} from "@/lib/domain/sales-form";
import { validateOrFocus } from "@/lib/client/validate-or-focus";
import { antdThemeTokens, resolveToken } from "@/lib/design/tokens";

describe("salesLineAmountMinor", () => {
  // The line editor showed no amount per line, only the totals below it.
  it("is quantity times unit price, in minor units, rounded as the totals are", () => {
    expect(salesLineAmountMinor({ quantity: 2, unit_price: 12.5 }, 2)).toBe(2500);
    expect(salesLineAmountMinor({ quantity: 3, unit_price: 0.333 }, 2)).toBe(99);
    expect(salesLineAmountMinor({ quantity: 1, unit_price: 0 }, 2)).toBe(0);
  });

  it("is null while the line has no quantity or no price yet", () => {
    expect(salesLineAmountMinor({ quantity: 2 }, 2)).toBeNull();
    expect(salesLineAmountMinor({ unit_price: 5 }, 2)).toBeNull();
    expect(salesLineAmountMinor(undefined, 2)).toBeNull();
  });
});

describe("messages that name the record", () => {
  it("a draft has no number yet, so it is named by its customer", () => {
    expect(draftInvoiceCreatedMessage("BlueRidge Foods")).toBe("Draft invoice for BlueRidge Foods created");
  });

  it("a customer is named by its name", () => {
    expect(customerSavedMessage("BlueRidge Foods", "created")).toBe("BlueRidge Foods added");
    expect(customerSavedMessage("BlueRidge Foods", "updated")).toBe("BlueRidge Foods updated");
  });
});

describe("validateOrFocus", () => {
  function fakeForm(result: { values?: object; errorFields?: { name: (string | number)[] }[] }) {
    const scrolled: unknown[] = [];
    const form = {
      validateFields: () =>
        result.errorFields ? Promise.reject({ errorFields: result.errorFields }) : Promise.resolve(result.values),
      scrollToField: (name: unknown, options: unknown) => {
        scrolled.push([name, options]);
      },
    } as unknown as FormInstance;
    return { form, scrolled };
  }

  it("returns the values when every field is valid, and moves nothing", async () => {
    const { form, scrolled } = fakeForm({ values: { name: "A" } });
    await expect(validateOrFocus(form)).resolves.toEqual({ name: "A" });
    expect(scrolled).toEqual([]);
  });

  // Save on an empty New invoice left focus on Save, with the errors out of sight.
  it("moves focus to the first invalid field and returns null when one is wrong", async () => {
    const { form, scrolled } = fakeForm({
      errorFields: [{ name: ["customer_id"] }, { name: ["lines", 0, "unit_price"] }],
    });
    await expect(validateOrFocus(form)).resolves.toBeNull();
    expect(scrolled).toEqual([[["customer_id"], { focus: true, block: "center" }]]);
  });
});

describe("secondary text contrast", () => {
  // Ant Design's own secondary grey read 3.32:1 under every page title.
  it("Ant Design's description colour is the app's secondary text, in both themes", () => {
    expect(antdThemeTokens("light").token.colorTextDescription).toBe(resolveToken("text.secondary", "light"));
    expect(antdThemeTokens("dark").token.colorTextDescription).toBe(resolveToken("text.secondary", "dark"));
  });
});
