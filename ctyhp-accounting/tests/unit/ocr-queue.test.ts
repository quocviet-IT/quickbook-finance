import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { claimOcrJob } from "@/lib/services/ocr-queue";

const JOB = { id: "11111111-1111-4111-8111-111111111111", storage_path: "c/1/file.pdf", mime_type: "application/pdf", attempts: 2 };

function fakes(opts: { claimed?: unknown[] | null; signed?: { data: { signedUrl: string } | null; error: unknown }; failThrows?: boolean } = {}) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "claim_ocr_job") return { data: opts.claimed === undefined ? [JOB] : opts.claimed, error: null };
    if (opts.failThrows) throw new Error("network down");
    return { data: true, error: null };
  });
  const createSignedUrl = vi.fn(async () => opts.signed ?? { data: { signedUrl: "https://signed/url" }, error: null });
  const from = vi.fn(() => ({ createSignedUrl }));
  return {
    rpc, createSignedUrl, from,
    sb: { rpc } as unknown as SupabaseClient,
    storage: { storage: { from } } as unknown as SupabaseClient,
  };
}

describe("claimOcrJob", () => {
  it("returns the job with a signed URL that lasts 600 seconds", async () => {
    const f = fakes();
    expect(await claimOcrJob("v1", f.sb, f.storage)).toEqual({
      id: JOB.id, downloadUrl: "https://signed/url", mimeType: "application/pdf", attempts: 2,
    });
    expect(f.createSignedUrl).toHaveBeenCalledWith(JOB.storage_path, 600);
  });

  it("fails the job and returns null when the signed URL cannot be made", async () => {
    const f = fakes({ signed: { data: null, error: new Error("nope") } });
    expect(await claimOcrJob("v1", f.sb, f.storage)).toBeNull();
    expect(f.rpc).toHaveBeenCalledWith("fail_ocr_job", expect.objectContaining({ p_id: JOB.id }));
  });

  it("still returns null when fail_ocr_job itself throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakes({ signed: { data: null, error: new Error("nope") }, failThrows: true });
    expect(await claimOcrJob("v1", f.sb, f.storage)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns null without touching storage when nothing is claimed", async () => {
    const f = fakes({ claimed: [] });
    expect(await claimOcrJob("v1", f.sb, f.storage)).toBeNull();
    expect(f.from).not.toHaveBeenCalled();
  });
});
