import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/access", () => ({
  submitForApproval: vi.fn(),
}));

import { submitForApproval } from "@/lib/services/access";
import {
  executeOrSubmitForApproval,
  isApprovalRequiredError,
  toControlledActionResponse,
} from "@/lib/services/approval-flow";

const submitMock = vi.mocked(submitForApproval);

function client(required: boolean) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: required, error: null }),
  };
}

describe("approval flow", () => {
  beforeEach(() => {
    submitMock.mockReset();
    submitMock.mockResolvedValue("request-1");
  });

  it("submits the intended call when the policy applies", async () => {
    const sb = client(true);
    const execute = vi.fn();
    const result = await executeOrSubmitForApproval({
      sb: sb as never,
      actionKey: "manual_journal",
      title: "Accrual",
      amountMinor: 50000,
      payload: { entry_date: "2026-07-25" },
      reason: "Month-end accrual",
      execute,
    });

    expect(result).toEqual({ status: "submitted", requestId: "request-1" });
    expect(execute).not.toHaveBeenCalled();
    expect(submitMock).toHaveBeenCalledWith(
      sb,
      expect.objectContaining({
        action_key: "manual_journal",
        amount_minor: 50000,
      }),
    );
  });

  it("executes immediately below the policy threshold", async () => {
    const execute = vi.fn().mockResolvedValue("entry-1");
    const result = await executeOrSubmitForApproval({
      sb: client(false) as never,
      actionKey: "manual_journal",
      title: "Small entry",
      amountMinor: 100,
      payload: {},
      reason: "Correction",
      execute,
    });

    expect(result).toEqual({ status: "executed", result: "entry-1" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("falls back to submission when the database policy changes during execution", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(
        new Error("A manual journal of this size requires approval; submit it for approval instead"),
      );
    const result = await executeOrSubmitForApproval({
      sb: client(false) as never,
      actionKey: "manual_journal",
      title: "Race-safe entry",
      amountMinor: 50000,
      payload: {},
      reason: "Correction",
      execute,
    });

    expect(result.status).toBe("submitted");
  });

  it("does not hide unrelated execution errors", async () => {
    await expect(
      executeOrSubmitForApproval({
        sb: client(false) as never,
        actionKey: "write_off",
        title: "Invalid write-off",
        amountMinor: 50000,
        payload: {},
        reason: "Correction",
        execute: async () => {
          throw new Error("Write-off exceeds invoice balance");
        },
      }),
    ).rejects.toThrow(/exceeds invoice balance/i);
  });

  it("maps both outcomes to the server-action response shape", () => {
    expect(
      toControlledActionResponse({ status: "submitted", requestId: "request-1" }, String),
    ).toEqual({ id: "request-1", submittedForApproval: true });
    expect(
      toControlledActionResponse({ status: "executed", result: "entry-1" }, String),
    ).toEqual({ id: "entry-1", submittedForApproval: false });
  });

  it("recognizes only the controlled RPC approval error", () => {
    expect(
      isApprovalRequiredError(
        new Error("This action requires approval; submit it for approval instead"),
      ),
    ).toBe(true);
    expect(isApprovalRequiredError(new Error("Permission denied"))).toBe(false);
  });
});
