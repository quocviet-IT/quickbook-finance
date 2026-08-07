import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fileFeedbackReport } = await import("@/lib/services/feedback");

/** A client that files the row, then refuses the screenshot the way storage did. */
function clientRefusingTheUpload(uploadError: string | null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "r1" }, error: null }) }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: uploadError ? { message: uploadError } : null }),
      }),
    },
  } as never;
}

const input = {
  kind: "broken" as const,
  description: "something",
  page: { url: "u", route: "/r", title: "t", viewport: { width: 1, height: 1 } },
  screenshotBase64: Buffer.from("not really a png").toString("base64"),
  current_difficulty: null,
  desired_outcome: null,
  impact: null,
  frequency: null,
  page_purpose: null,
};

describe("a screenshot that could not be stored", () => {
  it("says why, instead of returning a quiet false", async () => {
    // The reporter believes the picture went with the report. When storage
    // refuses it, nothing on screen corrects that belief — which is how four
    // reports arrived with no screenshot and nobody knew for three days.
    const linker = { from: () => ({}), storage: { from: () => ({}) } } as never;
    const result = await fileFeedbackReport(clientRefusingTheUpload("violates row-level security policy"), input, linker);

    expect(result.id).toBe("r1");
    expect(result.screenshotStored).toBe(false);
    expect(result.screenshotProblem).toMatch(/row-level security/);
  });

  it("reports the link failing too, not only the upload", async () => {
    const linker = {
      from: () => ({
        update: () => ({
          eq: () => ({ select: async () => ({ data: [], error: null }) }),
        }),
      }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    } as never;
    const result = await fileFeedbackReport(clientRefusingTheUpload(null), input, linker);

    expect(result.screenshotStored).toBe(false);
    expect(result.screenshotProblem, "a silent link failure is the older bug").toBeTruthy();
  });

  it("says nothing when there was no screenshot to store", async () => {
    const result = await fileFeedbackReport(
      clientRefusingTheUpload(null),
      { ...input, screenshotBase64: null },
      undefined,
    );
    expect(result.screenshotStored).toBe(false);
    expect(result.screenshotProblem).toBeUndefined();
  });
});
