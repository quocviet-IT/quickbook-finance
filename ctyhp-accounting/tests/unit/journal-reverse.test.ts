import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reverseEntry } from "@/lib/services/journal";

/**
 * Reverse on Journal Entries never worked: the dialog sent no date, the
 * service dropped the missing one, and PostgREST — finding no
 * acc_reverse_entry(p_entry_id, p_reason) — answered "Could not find the
 * function … in the schema cache". The function takes its date with no default.
 */
describe("reversing a journal entry", () => {
  it("calls acc_reverse_entry with all three arguments, the date among them", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const sb = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: "reversal-id", error: null };
      },
    } as unknown as SupabaseClient;
    expect(await reverseEntry(sb, { entry_id: "e-1", reason: "Posted twice", reversal_date: "2026-02-02" })).toBe("reversal-id");
    expect(calls).toEqual([
      { fn: "acc_reverse_entry", args: { p_entry_id: "e-1", p_reason: "Posted twice", p_reversal_date: "2026-02-02" } },
    ]);
  });

  it("asks the person for the date, starting from the entry's own", () => {
    const client = readFileSync(join(process.cwd(), "app", "(app)", "journal", "JournalClient.tsx"), "utf8");
    const start = client.indexOf("const reverse = (entry: JournalEntrySummary) => {");
    expect(start).toBeGreaterThan(-1);
    const dialog = client.slice(start, client.indexOf("\n  };", start));
    expect(dialog).toContain("let reversalDate: Dayjs | null = dayjs(entry.entryDate);");
    expect(dialog).toContain("<DatePicker");
    expect(dialog).toContain('reversal_date: reversalDate.format("YYYY-MM-DD")');
  });
});
