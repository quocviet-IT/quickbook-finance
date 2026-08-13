import { describe, expect, it } from "vitest";
import { moneyDisplay } from "@/lib/domain/money-display";

describe("a money cell", () => {
  it("shows the same string formatMoney has always produced", () => {
    // The formatting itself is not being changed. What this adds is the reading
    // and the sign, so a column can align and colour without each screen
    // deciding for itself.
    expect(moneyDisplay(123456, "USD").text).toBe("$1,234.56");
    expect(moneyDisplay(-123456, "USD").text).toBe("-$1,234.56");
  });

  it("reports the sign, so a caller never has to test the string", () => {
    expect(moneyDisplay(-1, "USD").sign).toBe("negative");
    expect(moneyDisplay(0, "USD").sign).toBe("zero");
    expect(moneyDisplay(1, "USD").sign).toBe("positive");
  });

  it("spells a negative out loud, because a leading dash is easy to miss", () => {
    // A screen reader announcing "$1,234.56" for a credit is the accounting
    // equivalent of dropping a minus sign, and colour is no help at all here.
    expect(moneyDisplay(-123456, "USD").ariaLabel).toBe("negative $1,234.56");
    expect(moneyDisplay(123456, "USD").ariaLabel).toBe("$1,234.56");
  });

  it("honours a currency with no minor unit", () => {
    // Not every currency has cents; the decimal places come from the currency
    // record, and defaulting to 2 everywhere would misstate those.
    expect(moneyDisplay(1234, "JPY", 0).text).toBe("¥1,234");
  });

  it("falls back to a readable string when the currency code is unknown", () => {
    // formatMoney already catches this; the point is that it does not throw and
    // a table cell never renders empty.
    expect(moneyDisplay(123456, "ZZZ").text.length).toBeGreaterThan(0);
  });
});
