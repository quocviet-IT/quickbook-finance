import { describe, expect, it } from "vitest";
import { moneyDisplay } from "@/lib/domain/money-display";

describe("a money cell", () => {
  it("shows the same string formatMoney has always produced", () => {
    // The formatting itself is not being changed. What this adds is the reading
    // and the sign, so a column can align and colour without each screen
    // deciding for itself.
    expect(moneyDisplay(123456, "USD", 2).text).toBe("$1,234.56");
    expect(moneyDisplay(-123456, "USD", 2).text).toBe("-$1,234.56");
  });

  it("reports the sign, so a caller never has to test the string", () => {
    expect(moneyDisplay(-1, "USD", 2).sign).toBe("negative");
    expect(moneyDisplay(0, "USD", 2).sign).toBe("zero");
    expect(moneyDisplay(1, "USD", 2).sign).toBe("positive");
  });

  it("spells a negative out loud, because a leading dash is easy to miss", () => {
    // A screen reader announcing "$1,234.56" for a credit is the accounting
    // equivalent of dropping a minus sign, and colour is no help at all here.
    expect(moneyDisplay(-123456, "USD", 2).ariaLabel).toBe("negative $1,234.56");
    expect(moneyDisplay(123456, "USD", 2).ariaLabel).toBe("$1,234.56");
  });

  it("honours a currency with no minor unit", () => {
    // Not every currency has cents; the decimal places come from the currency
    // record, which is why this argument is required rather than defaulted.
    expect(moneyDisplay(1234, "JPY", 0).text).toBe("¥1,234");
  });

  it("falls back to a readable string when the currency code is unknown", () => {
    // formatMoney already catches this; the point is that it does not throw and
    // a table cell never renders empty.
    expect(moneyDisplay(123456, "ZZZ", 2).text.length).toBeGreaterThan(0);
  });

  it("treats negative zero as zero, in the text as well as the sign", () => {
    // `Math.sign(v) * Math.round(...)` in lib/domain/money.ts yields -0 for any
    // small negative amount that rounds to nothing, so this is a value the
    // ledger really produces. Left alone it splits in two: `-0 < 0` is false so
    // the sign says "zero", while Intl formats -0 as "-$0.00". The cell would
    // then show a minus sign that nothing accounts for, and — because only a
    // "negative" sign triggers the spoken word — read aloud as an unexplained
    // dash. Whatever a reader concludes from that, it is not what the number
    // means.
    const negativeZero = moneyDisplay(-0, "USD", 2);
    expect(negativeZero.sign).toBe("zero");
    expect(negativeZero.text).toBe("$0.00");
    expect(negativeZero.ariaLabel).toBe("$0.00");
    expect(negativeZero).toEqual(moneyDisplay(0, "USD", 2));
  });
});
