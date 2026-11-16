import { describe, expect, it } from "vitest";
import { formatCompactMoney, formatSignedMoney } from "@/lib/format";

describe("formatCompactMoney", () => {
  it("shortens an axis label from minor units", () => {
    expect(formatCompactMoney(2_000_000, "USD", 2)).toBe("$20K");
    expect(formatCompactMoney(2_185_000, "USD", 2)).toBe("$21.9K");
    expect(formatCompactMoney(150_000_000, "USD", 2)).toBe("$1.5M");
    expect(formatCompactMoney(0, "USD", 2)).toBe("$0");
    expect(formatCompactMoney(-30_000, "USD", 2)).toBe("-$300");
  });

  it("uses the currency's own decimals", () => {
    expect(formatCompactMoney(123_456, "JPY", 0)).toBe("¥123.5K");
  });

  it("still says the amount for a currency code Intl does not know", () => {
    expect(formatCompactMoney(2_000_000, "XX", 2)).toBe("20K XX");
  });
});

describe("formatSignedMoney", () => {
  it("always shows the sign of a change", () => {
    expect(formatSignedMoney(254_025, "USD", 2)).toBe("+$2,540.25");
    expect(formatSignedMoney(-130_000, "USD", 2)).toBe("-$1,300.00");
    expect(formatSignedMoney(0, "USD", 2)).toBe("$0.00");
  });
});
