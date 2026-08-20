import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { previewImport } from "@/lib/services/data-import";

/**
 * What the preview promises has to be what the import delivers.
 *
 * `acc_import_contacts` matches a contact by name, ignoring case, and updates
 * the one it finds. The preview used to compare each row only against what was
 * already in the database — so a file naming the same customer twice, as an
 * export sorted by transaction routinely does, was counted as two creates and
 * the import then made one and updated it.
 */

const MAPPING = { name: 0, email: 1, phone: 2, city: 3, region: null, postal_code: null, country: null, contact_name: null, opening_balance_minor: null };

/** Stands in for the customer table the preview reads to decide create vs update. */
function clientWith(existing: string[]): SupabaseClient {
  return {
    from: () => ({
      select: async () => ({ data: existing.map((name) => ({ name })), error: null }),
    }),
  } as unknown as SupabaseClient;
}

const preview = (rows: string[][], existing: string[] = []) =>
  previewImport(clientWith(existing), "customers", rows, MAPPING);

describe("previewImport, customers", () => {
  it("counts a new contact as a create and a known one as an update", async () => {
    const out = await preview(
      [
        ["Zenith Alpha", "a@example.com", "555", "Boston"],
        ["Acme Studio", "b@example.com", "556", "Austin"],
      ],
      ["Acme Studio"],
    );
    expect({ creates: out.creates, updates: out.updates }).toEqual({ creates: 1, updates: 1 });
  });

  it("counts the second mention of one contact as an update, not a second create", async () => {
    // The whole point: the import creates it once and updates it after that.
    const out = await preview([
      ["Zenith Alpha", "a@example.com", "555", "Boston"],
      ["Zenith Alpha", "a2@example.com", "556", "Boston"],
    ]);
    expect({ creates: out.creates, updates: out.updates }).toEqual({ creates: 1, updates: 1 });
  });

  it("treats a repeat differing only in case or surrounding space as the same contact", async () => {
    // acc_import_contacts trims and lowercases before it matches; so must this.
    const out = await preview([
      ["Zenith Alpha", "a@example.com", "555", "Boston"],
      ["  zenith ALPHA  ", "a2@example.com", "556", "Boston"],
    ]);
    expect({ creates: out.creates, updates: out.updates }).toEqual({ creates: 1, updates: 1 });
  });

  it("still counts genuinely different contacts separately", async () => {
    const out = await preview([
      ["Zenith Alpha", "a@example.com", "555", "Boston"],
      ["Zenith Beta", "b@example.com", "556", "Austin"],
    ]);
    expect({ creates: out.creates, updates: out.updates }).toEqual({ creates: 2, updates: 0 });
  });
});
