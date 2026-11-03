import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/ocr-queue", () => ({
  claimOcrJob: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", downloadUrl: "https://x/y", mimeType: "application/pdf", attempts: 1 })),
  reportOcrProgress: vi.fn(async () => true),
  completeOcrJob: vi.fn(async () => true),
  failOcrJob: vi.fn(async () => true),
}));

import { POST } from "@/app/api/ocr/worker/route";
import { workerAccess } from "@/lib/domain/ocr-worker-auth";
import { claimOcrJob, completeOcrJob } from "@/lib/services/ocr-queue";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request("https://onebook.test/api/ocr/worker", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }));

describe("workerAccess", () => {
  it("is disabled without a secret of at least 24 characters", () => {
    expect(workerAccess(`Bearer ${SECRET}`, undefined)).toBe("disabled");
    expect(workerAccess("Bearer short", "short")).toBe("disabled");
  });
  it("accepts only the exact secret", () => {
    expect(workerAccess(`Bearer ${SECRET}`, SECRET)).toBe("ok");
    expect(workerAccess(`Bearer ${SECRET}x`, SECRET)).toBe("unauthorized");
    expect(workerAccess(null, SECRET)).toBe("unauthorized");
  });
});

describe("POST /api/ocr/worker", () => {
  beforeEach(() => { process.env.OCR_WORKER_SECRET = SECRET; });
  afterEach(() => { delete process.env.OCR_WORKER_SECRET; vi.clearAllMocks(); });

  it("answers 404 when OCR is not set up", async () => {
    delete process.env.OCR_WORKER_SECRET;
    expect((await post({ action: "claim", version: "v" })).status).toBe(404);
  });

  it("answers 401 to a wrong secret and touches nothing", async () => {
    expect((await post({ action: "claim", version: "v" }, "Bearer nope")).status).toBe(401);
    expect(claimOcrJob).not.toHaveBeenCalled();
  });

  it("hands out a job, or 204 when there is none", async () => {
    const res = await post({ action: "claim", version: "v1" });
    expect(res.status).toBe(200);
    expect((await res.json()).job.id).toBe(ID);
    vi.mocked(claimOcrJob).mockResolvedValueOnce(null);
    expect((await post({ action: "claim", version: "v1" })).status).toBe(204);
  });

  it("refuses a result with more than 20 pages", async () => {
    const pages = Array.from({ length: 21 }, (_, i) => ({ page: i + 1, text: "t" }));
    expect((await post({ action: "complete", id: ID, result: { engine: "e", pages } })).status).toBe(400);
    expect(completeOcrJob).not.toHaveBeenCalled();
  });

  it("stores a valid result", async () => {
    const res = await post({ action: "complete", id: ID, result: { engine: "e", pages: [{ page: 1, text: "t" }] } });
    expect(res.status).toBe(200);
    expect(completeOcrJob).toHaveBeenCalledWith(ID, { engine: "e", pages: [{ page: 1, text: "t" }] });
  });
  it("answers 400 to a body that is not JSON", async () => {
    const res = await POST(new Request("https://onebook.test/api/ocr/worker", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: "not json",
    }));
    expect(res.status).toBe(400);
  });

  it("answers 400 to an unknown action", async () => {
    expect((await post({ action: "explode" })).status).toBe(400);
  });

  it("answers 404, not 401, to a wrong bearer when the secret is unset", async () => {
    delete process.env.OCR_WORKER_SECRET;
    expect((await post({ action: "claim", version: "v" }, "Bearer nope")).status).toBe(404);
  });

  it("does not leak database error text in a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(claimOcrJob).mockRejectedValueOnce(new Error("relation onebook.ocr_job does not exist"));
    const res = await post({ action: "claim", version: "v" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("relation");
    expect(JSON.parse(text)).toEqual({ error: "The OCR queue failed" });
  });
});
