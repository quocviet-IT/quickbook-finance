import { describe, expect, it } from "vitest";
import {
  APPLIED_LABELS,
  PAID_LABELS,
  RECEIVED_LABELS,
  humanizeStatus,
  statusLabel,
  statusLook,
} from "@/lib/domain/status-label";

describe("humanizeStatus", () => {
  it("writes a code as words, first letter capitalized", () => {
    expect(humanizeStatus("open")).toBe("Open");
    expect(humanizeStatus("not_requested")).toBe("Not requested");
    expect(humanizeStatus("stock_count")).toBe("Stock count");
    expect(humanizeStatus("bank_transfer")).toBe("Bank transfer");
    expect(humanizeStatus("in-progress")).toBe("In progress");
  });

  it("keeps the capitals of the words that have them", () => {
    expect(humanizeStatus("ach")).toBe("ACH");
    expect(humanizeStatus("w9_on_file")).toBe("W-9 on file");
  });

  it("reads an empty code as a dash", () => {
    expect(humanizeStatus(null)).toBe("—");
    expect(humanizeStatus("")).toBe("—");
    expect(humanizeStatus("  ")).toBe("—");
  });
});

describe("statusLook", () => {
  it("gives the codes that mean one thing everywhere one look", () => {
    expect(statusLook("posted")).toEqual({ tone: "positive", label: "Posted" });
    expect(statusLook("void")).toEqual({ tone: "muted", label: "Void" });
    expect(statusLook("draft")).toEqual({ tone: "muted", label: "Draft" });
    expect(statusLook("overdue")).toEqual({ tone: "danger", label: "Overdue" });
    expect(statusLook("attention_required")).toEqual({ tone: "warning", label: "Needs attention" });
    // The stored code is British; the screen is not.
    expect(statusLabel("cancelled")).toBe("Canceled");
  });

  it("lets a domain say what partial means, keeping the shared tone", () => {
    expect(statusLook("partial", { labels: PAID_LABELS })).toEqual({ tone: "warning", label: "Partially paid" });
    expect(statusLabel("partial", { labels: APPLIED_LABELS })).toBe("Partially applied");
    expect(statusLabel("partial", { labels: RECEIVED_LABELS })).toBe("Partially received");
  });

  it("takes a screen's own look over the shared one", () => {
    expect(statusLook("open", { looks: { open: { tone: "warning", label: "Waiting" } } })).toEqual({
      tone: "warning",
      label: "Waiting",
    });
  });

  it("reads a code nobody named as words in the muted tone, never as the code", () => {
    expect(statusLook("some_new_state")).toEqual({ tone: "muted", label: "Some new state" });
  });

  it("starts every shared label with a capital and holds no underscore", () => {
    for (const code of [
      "draft", "open", "issued", "partial", "paid", "unapplied", "applied", "posted", "void", "reversed",
      "received", "closed", "cancelled", "overdue", "pending", "approved", "rejected", "in_progress",
      "completed", "active", "inactive", "archived", "disconnected", "on_file", "not_enrolled",
    ]) {
      const { label } = statusLook(code);
      expect(label, code).toMatch(/^[A-Z]/);
      expect(label, code).not.toContain("_");
    }
  });
});
