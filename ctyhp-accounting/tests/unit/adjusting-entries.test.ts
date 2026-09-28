import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markAdjustingSchema, parseClosedPeriod, unmarkAdjustingSchema } from "@/lib/domain/adjusting-entries";
import { AdjustingEntryError, markAdjusting, unmarkAdjusting } from "@/lib/services/adjusting-entries";

const ENTRY = "3f2b8c1e-7a4d-4c2b-9e1f-0a1b2c3d4e5f";

describe("parseClosedPeriod", () => {
  it("reads the entry's date and the end of its closed period", () => {
    expect(parseClosedPeriod("closed_period:2026-03-04:2026-03-31")).toEqual({
      entryDate: "2026-03-04",
      closedThrough: "2026-03-31",
    });
  });

  it("finds nothing in any other refusal", () => {
    expect(parseClosedPeriod("permission denied: marking an adjusting entry needs journal.post")).toBeNull();
  });
});

describe("the mark's input", () => {
  it("accepts a note up to 500 characters, and none at all", () => {
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: "x".repeat(500), confirmClosed: false }).success).toBe(true);
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: null, confirmClosed: false }).success).toBe(true);
  });

  it("refuses a longer note, and an id that is not one", () => {
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: "x".repeat(501), confirmClosed: false }).success).toBe(false);
    expect(unmarkAdjustingSchema.safeParse({ entryId: "JE-000001", confirmClosed: false }).success).toBe(false);
  });
});

function rpcAnswering(error: string | null, calls: [string, Record<string, unknown>][] = []): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: null, error: error ? { message: error } : null };
    },
  } as unknown as SupabaseClient;
}

describe("markAdjusting and unmarkAdjusting", () => {
  it("pass the entry, the note and the confirmation through", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await markAdjusting(rpcAnswering(null, calls), ENTRY, "Year-end accrual", true);
    await unmarkAdjusting(rpcAnswering(null, calls), ENTRY, false);
    expect(calls).toEqual([
      ["acc_mark_adjusting", { p_entry_id: ENTRY, p_note: "Year-end accrual", p_confirm_closed: true }],
      ["acc_unmark_adjusting", { p_entry_id: ENTRY, p_confirm_closed: false }],
    ]);
  });

  it("report done when the database agrees", async () => {
    await expect(markAdjusting(rpcAnswering(null), ENTRY, null, false)).resolves.toEqual({ kind: "done" });
  });

  it("turn a closed period into a question for the screen", async () => {
    await expect(unmarkAdjusting(rpcAnswering("closed_period:2026-03-04:2026-03-31"), ENTRY, false)).resolves.toEqual({
      kind: "closed_period",
      ask: { entryDate: "2026-03-04", closedThrough: "2026-03-31" },
    });
  });

  it("throw any other refusal", async () => {
    await expect(markAdjusting(rpcAnswering("That entry is not in the books"), ENTRY, null, false)).rejects.toThrow(
      AdjustingEntryError,
    );
  });
});
