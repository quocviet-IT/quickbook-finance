import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBankingSurface, type BankingSections } from "@/lib/services/banking-surface";
import { bankingWorkQueue } from "@/lib/services/banking-surface/sections";
import { BANKING_KIND_FILTERS } from "@/lib/domain/banking-surface/lifecycle";
import { EMPTY_WORK_POLICY } from "@/lib/domain/work-policy";
import type { BankingContext, BankingFacts } from "@/lib/services/banking-surface/facts";
import type { DuplicateCharge, DuplicateChargeLine } from "@/lib/domain/duplicate-charges";
import type { WorkItemState } from "@/lib/domain/work-surface/lifecycle";

const AT = "2026-08-22T09:00:00.000Z";
const CONTEXT: BankingContext = {
  asOf: "2026-08-22",
  currencyCode: "USD",
  currencyDecimals: 2,
  timeZone: "America/New_York",
};

function side(id: string, date: string, over: Partial<DuplicateChargeLine> = {}): DuplicateChargeLine {
  return {
    lineId: id,
    entryId: `entry-${id}`,
    entryNumber: `JE-${id}`,
    date,
    amountMinor: 49_95,
    payee: "Harbor Supplies",
    text: "POS DEBIT HARBOR SUPPLIES",
    cleared: false,
    ...over,
  };
}

function charge(over: Partial<DuplicateCharge> = {}): DuplicateCharge {
  return {
    bankAccountId: "acct-1",
    accountName: "Operating",
    earlier: side("l1", "2026-08-03"),
    later: side("l2", "2026-08-05"),
    reviewLineId: "l2",
    reviewSide: "later",
    daysApart: 2,
    outlier: false,
    otherPayeeLines: 0,
    ...over,
  };
}

const FACTS: BankingFacts = {
  accounts: [{ id: "acct-1", name: "Operating" }],
  feeds: [],
  transactions: [],
  sessions: [],
};

describe("bankingWorkQueue with duplicate charges", () => {
  it("appends one Review item per charge, opening the entry of the line to review", () => {
    const items = bankingWorkQueue(FACTS, CONTEXT, null, AT, [charge()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "dupe-charge:l1:l2",
      sourceKind: "possible-duplicate",
      href: "/journal?entry=entry-l2",
      actionLabel: "Review",
      blocking: false,
    });
    expect(items[0].title).toContain("$49.95");
  });

  it("shows no duplicates for a failed read, and leaves the other items alone", () => {
    const facts: BankingFacts = {
      ...FACTS,
      transactions: [
        {
          id: "t1",
          bank_account_id: "acct-1",
          txn_date: "2026-08-01",
          description: "Card payment",
          amount_minor: -12_50,
          status: "unmatched",
          pending: false,
          provider_removed_at: null,
        } as BankingFacts["transactions"][number],
      ],
    };
    const withoutRead = bankingWorkQueue(facts, CONTEXT, null, AT, null);
    expect(withoutRead.map((item) => item.sourceKind)).toEqual(["unmatched-bank"]);
    const withRead = bankingWorkQueue(facts, CONTEXT, null, AT, [charge()]);
    expect(withRead.map((item) => item.sourceKind).sort()).toEqual(["possible-duplicate", "unmatched-bank"]);
  });

  it("has a filter for the kind", () => {
    expect(BANKING_KIND_FILTERS).toContainEqual(
      expect.objectContaining({ label: "Possible duplicates", kinds: ["possible-duplicate"] }),
    );
  });
});

function dismissed(): WorkItemState {
  return { lifecycle: "dismissed", dismissReason: "Two separate purchases" } as WorkItemState;
}

function sections(over: Partial<BankingSections>): { sections: BankingSections; retire: ReturnType<typeof vi.fn> } {
  const retire = vi.fn(async () => 0);
  return {
    retire,
    sections: {
      context: async () => CONTEXT,
      facts: async () => FACTS,
      workState: async () => new Map(),
      duplicates: async () => [],
      retire,
      policy: async () => EMPTY_WORK_POLICY,
      ...over,
    },
  };
}

const SB = {} as SupabaseClient;

describe("getBankingSurface and duplicate charges", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the duplicates in the queue and keeps their live key", async () => {
    const { sections: s, retire } = sections({ duplicates: async () => [charge()] });
    const surface = await getBankingSurface(SB, s);
    expect(surface.queue.data?.map((item) => item.key)).toEqual(["dupe-charge:l1:l2"]);
    expect(retire).toHaveBeenCalledWith(SB, ["dupe-charge:l1:l2"]);
  });

  it("retires a dupe-charge key that is no longer derived", async () => {
    const state = new Map([["dupe-charge:old:pair", dismissed()]]);
    const { sections: s, retire } = sections({ workState: async () => state });
    await getBankingSurface(SB, s);
    expect(retire).toHaveBeenCalledWith(SB, []);
  });

  it("skips retirement when both the state and the duplicates reads failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sections: s, retire } = sections({
      workState: async () => {
        throw new Error("state unreadable");
      },
      duplicates: async () => {
        throw new Error("lines unreadable");
      },
    });
    const surface = await getBankingSurface(SB, s);
    expect(surface.queue.dataState).toBe("fresh");
    expect(retire).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("skipping retirement"));
  });

  it("still retires when only the state read failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sections: s, retire } = sections({
      workState: async () => {
        throw new Error("state unreadable");
      },
    });
    await getBankingSurface(SB, s);
    expect(retire).toHaveBeenCalledWith(SB, []);
  });

  it("keeps dupe-charge state out of retirement when the duplicates read failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = new Map<string, WorkItemState>([
      ["dupe-charge:old:pair", dismissed()],
      ["unmatched-bank:gone", dismissed()],
    ]);
    const { sections: s, retire } = sections({
      workState: async () => state,
      duplicates: async () => {
        throw new Error("lines unreadable");
      },
    });
    const surface = await getBankingSurface(SB, s);
    // The rest of Banking renders; only the other stale key is still retired.
    expect(surface.queue.dataState).toBe("fresh");
    expect(surface.controls.data).toBeDefined();
    const liveKeys = retire.mock.calls[0][1] as string[];
    expect(liveKeys).toContain("dupe-charge:old:pair");
    expect(liveKeys).not.toContain("unmatched-bank:gone");
    expect(error).toHaveBeenCalledWith("reading duplicate charges failed:", expect.any(Error));
  });
});
