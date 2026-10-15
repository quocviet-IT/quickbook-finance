import { describe, expect, it } from "vitest";
import {
  descriptionShape,
  duplicatePayeeKey,
  findDuplicateCharges,
} from "@/lib/domain/duplicate-charges";
import { duplicateChargeItem } from "@/lib/domain/banking-surface/queue-items";
import type { BankLine } from "@/lib/domain/statement-alerts";

const TODAY = "2026-10-15";

let seq = 0;
function line(date: string, amountMinor: number, payee: string, over: Partial<BankLine> = {}): BankLine {
  seq += 1;
  return {
    lineId: `l${String(seq).padStart(4, "0")}`,
    entryId: `e${String(seq).padStart(4, "0")}`,
    entryNumber: `JE-${String(seq).padStart(6, "0")}`,
    date,
    amountMinor,
    payee,
    narration: "",
    codedTo: [],
    sourceType: "manual",
    cleared: false,
    ...over,
  };
}

const acct = (lines: BankLine[], id = "a1") => ({ bankAccountId: id, accountName: "Operating", lines });
const find = (lines: BankLine[]) => findDuplicateCharges([acct(lines)], TODAY);

describe("duplicatePayeeKey", () => {
  it("unites a web-style and a card-style text of one payee", () => {
    expect(duplicatePayeeKey("SHOPMART.COM 8004")).toBe("shopmart");
    expect(duplicatePayeeKey("POS DEBIT SHOPMART #1234")).toBe("shopmart");
  });
  it("keeps the first two remaining words", () => {
    expect(duplicatePayeeKey("Recurring ACH Harbor Rent Co 55 LLC")).toBe("harbor rent");
  });
  it("is empty when nothing is left", () => {
    expect(duplicatePayeeKey("POS DEBIT 1234")).toBe("");
    expect(duplicatePayeeKey("")).toBe("");
  });
});

describe("descriptionShape", () => {
  it("tells the two formats apart", () => {
    expect(descriptionShape("POS DEBIT SHOPMART 1234")).not.toBe(descriptionShape("SHOPMART.COM 8004"));
  });
  it("ignores the digits' value and the merchant's name", () => {
    expect(descriptionShape("POS DEBIT SHOPMART 1234")).toBe(descriptionShape("pos debit othershop 99"));
  });
});

describe("findDuplicateCharges", () => {
  it("flags a pair 15 days apart, reviewing the later line", () => {
    const a = line("2026-09-01", -2500, "SHOPMART");
    const b = line("2026-09-16", -2500, "SHOPMART");
    const out = find([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].daysApart).toBe(15);
    expect(out[0].earlier.lineId).toBe(a.lineId);
    expect(out[0].later.lineId).toBe(b.lineId);
    expect(out[0].reviewLineId).toBe(b.lineId);
    expect(out[0].outlier).toBe(false);
    expect(out[0].bankAccountId).toBe("a1");
    expect(out[0].accountName).toBe("Operating");
  });

  it("does not flag 31 days, flags 30", () => {
    expect(find([line("2026-08-01", -2500, "SHOPMART"), line("2026-09-01", -2500, "SHOPMART")])).toHaveLength(0);
    expect(find([line("2026-08-01", -2500, "SHOPMART"), line("2026-08-31", -2500, "SHOPMART")])).toHaveLength(1);
  });

  it("needs the same amount, payee and account", () => {
    expect(find([line("2026-09-01", -2500, "SHOPMART"), line("2026-09-02", -2501, "SHOPMART")])).toHaveLength(0);
    expect(find([line("2026-09-01", -2500, "SHOPMART"), line("2026-09-02", -2500, "OTHERSHOP")])).toHaveLength(0);
    const out = findDuplicateCharges(
      [acct([line("2026-09-01", -2500, "SHOPMART")], "a1"), acct([line("2026-09-02", -2500, "SHOPMART")], "a2")],
      TODAY,
    );
    expect(out).toHaveLength(0);
  });

  it("unites differently written texts of one payee", () => {
    expect(find([line("2026-09-01", -900, "SHOPMART.COM 8004"), line("2026-09-05", -900, "POS DEBIT SHOPMART #1234")])).toHaveLength(1);
  });

  it("leaves a monthly rent of four payments alone", () => {
    const rent = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((d) => line(d, -150000, "HARBOR RENT CO"));
    expect(find(rent)).toHaveLength(0);
  });

  it("flags the rent paid twice in one month", () => {
    const rent = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((d) =>
      line(d, -150000, "HARBOR RENT CO"),
    );
    const extra = line("2026-09-02", -150000, "HARBOR RENT CO");
    const out = find([...rent, extra]);
    expect(out).toHaveLength(1);
    expect(out[0].reviewLineId).toBe(extra.lineId);
    expect(out[0].daysApart).toBe(1);
  });

  it("leaves a weekly subscription alone and flags a double charge on one day", () => {
    const weekly = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"].map((d) =>
      line(d, -499, "STREAMBOX"),
    );
    expect(find(weekly)).toHaveLength(0);
    const twice = line("2026-09-15", -499, "STREAMBOX");
    const out = find([...weekly, twice]);
    expect(out).toHaveLength(1);
    expect(out[0].daysApart).toBe(0);
  });

  it("applies the rhythm only when the median is 6 days or more", () => {
    // Daily charges: median 1, so every pair is a candidate.
    const daily = ["2026-09-01", "2026-09-02", "2026-09-03"].map((d) => line(d, -300, "TOLLWAY"));
    expect(find(daily)).toHaveLength(2);
  });

  it("cuts a chain into consecutive pairs", () => {
    const out = find([line("2026-09-01", -700, "SHOPMART"), line("2026-09-03", -700, "SHOPMART"), line("2026-09-05", -700, "SHOPMART")]);
    expect(out).toHaveLength(2);
  });

  it("flags an outlier whose text differs from the payee's usual format", () => {
    const usual = [
      line("2026-03-01", -1000, "POS DEBIT SHOPMART 1111"),
      line("2026-04-05", -1300, "POS DEBIT SHOPMART 2222"),
      line("2026-05-09", -1700, "POS DEBIT SHOPMART 3333"),
    ];
    const first = line("2026-09-01", -4200, "POS DEBIT SHOPMART 4444");
    const odd = line("2026-09-10", -4200, "SHOPMART.COM 8004");
    const out = find([...usual, first, odd]);
    expect(out).toHaveLength(1);
    expect(out[0].outlier).toBe(true);
    expect(out[0].otherPayeeLines).toBe(4);
  });

  it("is not an outlier when the payee has fewer than 3 lines", () => {
    const out = find([line("2026-09-01", -4200, "POS DEBIT SHOPMART 4444"), line("2026-09-10", -4200, "SHOPMART.COM 8004")]);
    expect(out[0].outlier).toBe(false);
  });

  it("uses the narration for the shape when it is not empty", () => {
    const mk = (d: string, n: string, a = -1000) => line(d, a, "SHOPMART", { narration: n });
    const out = find([
      mk("2026-03-01", "POS DEBIT SHOPMART 1", -1000),
      mk("2026-04-01", "POS DEBIT SHOPMART 2", -1100),
      mk("2026-05-01", "POS DEBIT SHOPMART 3", -1200),
      mk("2026-09-01", "POS DEBIT SHOPMART 4", -4200),
      mk("2026-09-10", "SHOPMART.COM 8004", -4200),
    ]);
    expect(out[0].outlier).toBe(true);
    expect(out[0].later.text).toBe("SHOPMART.COM 8004");
  });

  it("reviews the other line when one is signed off", () => {
    const a = line("2026-09-01", -2500, "SHOPMART", { cleared: false });
    const b = line("2026-09-10", -2500, "SHOPMART", { cleared: true });
    const out = find([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].reviewLineId).toBe(a.lineId);
    const c = line("2026-09-01", -2500, "OTHERSHOP", { cleared: true });
    const d = line("2026-09-10", -2500, "OTHERSHOP", { cleared: false });
    expect(find([c, d])[0].reviewLineId).toBe(d.lineId);
  });

  it("does not offer a pair signed off on both sides", () => {
    expect(
      find([line("2026-09-01", -2500, "SHOPMART", { cleared: true }), line("2026-09-10", -2500, "SHOPMART", { cleared: true })]),
    ).toHaveLength(0);
  });

  it("ignores money in", () => {
    expect(find([line("2026-09-01", 2500, "SHOPMART"), line("2026-09-10", 2500, "SHOPMART")])).toHaveLength(0);
  });

  it("ignores lines with no payee key", () => {
    expect(find([line("2026-09-01", -2500, "POS 1234"), line("2026-09-10", -2500, "POS 1234")])).toHaveLength(0);
  });

  it("looks back 12 months up to and including today, no further either way", () => {
    expect(find([line("2025-10-14", -2500, "SHOPMART"), line("2025-10-20", -2500, "SHOPMART")])).toHaveLength(0);
    expect(find([line("2025-10-15", -2500, "SHOPMART"), line("2025-10-20", -2500, "SHOPMART")])).toHaveLength(1);
    expect(find([line("2026-10-14", -2500, "SHOPMART"), line("2026-10-15", -2500, "SHOPMART")])).toHaveLength(1);
    expect(find([line("2026-10-15", -2500, "SHOPMART"), line("2026-10-16", -2500, "SHOPMART")])).toHaveLength(0);
  });

  it("orders outliers first, then newest", () => {
    const old = [line("2026-04-01", -100, "AAA STORE"), line("2026-04-03", -100, "AAA STORE")];
    const recent = [line("2026-09-01", -200, "BBB STORE"), line("2026-09-03", -200, "BBB STORE")];
    const usual = [
      line("2026-01-01", -111, "POS DEBIT CCC SHOP 1"),
      line("2026-01-20", -122, "POS DEBIT CCC SHOP 2"),
      line("2026-02-20", -133, "POS DEBIT CCC SHOP 3"),
    ];
    const odd = [line("2026-03-01", -300, "POS DEBIT CCC SHOP 4"), line("2026-03-05", -300, "CCC SHOP.COM 9")];
    const out = find([...old, ...recent, ...usual, ...odd]);
    expect(out.map((c) => c.later.payee)).toEqual(["CCC SHOP.COM 9", "BBB STORE", "AAA STORE"]);
  });
});

describe("duplicateChargeItem", () => {
  const input = {
    confirmedAt: "2026-10-15T00:00:00Z",
    money: (n: number) => `$${(n / 100).toFixed(2)}`,
    entryHref: (id: string) => `/journal?entry=${id}`,
    ageDays: 5,
  };
  const build = (a: Partial<BankLine>, b: Partial<BankLine>) => {
    const x = line("2026-03-16", -2500, "SHOPMART", a);
    const y = line("2026-03-31", -2500, "SHOPMART", b);
    return { x, y, charge: find([x, y])[0] };
  };

  it("words the plural title, reason and fields", () => {
    const { x, y, charge } = build({}, {});
    const item = duplicateChargeItem(charge, input);
    expect(item.key).toBe(`dupe-charge:${x.lineId}:${y.lineId}`);
    expect(item.sourceKind).toBe("possible-duplicate");
    expect(item.sourceId).toBe(y.lineId);
    expect(item.title).toBe("SHOPMART: $25.00 twice in 15 days");
    expect(item.reason).toBe("Operating · Mar 16, 2026 and Mar 31, 2026");
    expect(item.severity).toBe("medium");
    expect(item.amountMinor).toBe(2500);
    expect(item.href).toBe(`/journal?entry=${y.entryId}`);
    expect(item.actionLabel).toBe("Review");
    expect(item.blocking).toBe(false);
    expect(item.ageDays).toBe(5);
    expect(item.confirmedAt).toBe(input.confirmedAt);
  });

  it("words singular and same-day titles", () => {
    const one = find([line("2026-03-30", -2500, "SHOPMART"), line("2026-03-31", -2500, "SHOPMART")])[0];
    expect(duplicateChargeItem(one, input).title).toBe("SHOPMART: $25.00 twice in 1 day");
    const same = find([line("2026-03-31", -2500, "SHOPMART"), line("2026-03-31", -2500, "SHOPMART")])[0];
    expect(duplicateChargeItem(same, input).title).toBe("SHOPMART: $25.00 twice on the same day");
  });

  it("adds the signed-off line to the reason", () => {
    const { charge } = build({ cleared: true }, {});
    const item = duplicateChargeItem(charge, input);
    expect(item.reason).toBe(
      "Operating · Mar 16, 2026 and Mar 31, 2026 · the Mar 16, 2026 line is on a completed reconciliation",
    );
    expect(item.href).toBe(`/journal?entry=${charge.later.entryId}`);
  });

  it("adds the outlier clause and raises severity", () => {
    const usual = [
      line("2026-01-01", -111, "POS DEBIT SHOPMART 1"),
      line("2026-01-20", -122, "POS DEBIT SHOPMART 2"),
      line("2026-02-20", -133, "POS DEBIT SHOPMART 3"),
    ];
    const a = line("2026-03-16", -2500, "POS DEBIT SHOPMART 4");
    const b = line("2026-03-31", -2500, "SHOPMART.COM 8004");
    const charge = find([...usual, a, b])[0];
    const item = duplicateChargeItem(charge, input);
    expect(item.severity).toBe("high");
    expect(item.reason).toBe(
      "Operating · Mar 16, 2026 and Mar 31, 2026 · the Mar 31, 2026 line is described differently from this payee's other 4",
    );
  });

  it("keeps the key stable when the same pair is derived again", () => {
    const { charge } = build({}, {});
    expect(duplicateChargeItem(charge, input).key).toBe(duplicateChargeItem({ ...charge }, input).key);
  });
});
