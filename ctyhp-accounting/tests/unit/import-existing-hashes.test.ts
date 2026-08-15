import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { existingHashes } from "@/lib/services/transaction-import-preview";

/**
 * A stand-in for PostgREST's row cap.
 *
 * The real one returns at most a thousand rows and reports no error when it
 * truncates, which is what made this worth pinning: nothing in the response
 * says the answer is partial.
 */
function clientWith(hashes: readonly string[], cap = 1000): { sb: SupabaseClient; calls: () => number } {
  let calls = 0;
  const rowsBetween = (from: number, to: number) => {
    calls += 1;
    const width = Math.min(to - from + 1, cap);
    return { data: hashes.slice(from, from + width).map((raw_hash) => ({ raw_hash })), error: null };
  };
  const sb = {
    from() {
      return {
        select() {
          // Awaitable on its own, exactly as PostgREST is: a caller that never
          // asks for a range still gets an answer, silently capped. That is
          // what makes an implementation without paging fail here on the count
          // rather than on a missing method.
          return {
            range: (from: number, to: number) => Promise.resolve(rowsBetween(from, to)),
            then: (resolve: (value: unknown) => unknown) => resolve(rowsBetween(0, cap - 1)),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, calls: () => calls };
}

describe("reading the hashes already in the books", () => {
  it("reads past the row cap, because a partial answer imports rows twice", () => {
    // The number that made this real: a company with 1,466 bank lines, of which
    // a single read saw 1,000. The 466 it could not see are rows the preview
    // would offer for import again, and the unique index would then refuse on
    // the server — the screen promising more rows than arrive, and a balance
    // that stops agreeing with the books it came from.
    const all = Array.from({ length: 1466 }, (_, i) => `hash-${i}`);
    const { sb, calls } = clientWith(all);
    return existingHashes(sb).then((found) => {
      expect(found.size).toBe(1466);
      expect(found.has("hash-0")).toBe(true);
      expect(found.has("hash-1465")).toBe(true);
      // Two pages: one full, one short. A short page is the last one.
      expect(calls()).toBe(2);
    });
  });

  it("stops on a short page rather than asking again for nothing", () => {
    const { sb, calls } = clientWith(Array.from({ length: 12 }, (_, i) => `h${i}`));
    return existingHashes(sb).then((found) => {
      expect(found.size).toBe(12);
      expect(calls()).toBe(1);
    });
  });

  it("reads an empty table without a second request", () => {
    const { sb, calls } = clientWith([]);
    return existingHashes(sb).then((found) => {
      expect(found.size).toBe(0);
      expect(calls()).toBe(1);
    });
  });

  it("asks again when a page comes back exactly full", () => {
    // The boundary that decides whether the loop terminates too early: a table
    // holding exactly one page looks identical to one holding more until the
    // second request comes back empty.
    const { sb, calls } = clientWith(Array.from({ length: 1000 }, (_, i) => `h${i}`));
    return existingHashes(sb).then((found) => {
      expect(found.size).toBe(1000);
      expect(calls()).toBe(2);
    });
  });
});
