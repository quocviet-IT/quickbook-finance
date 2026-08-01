import { describe, expect, it } from "vitest";
import { feedbackReportSchema } from "@/lib/domain/schemas";

const page = {
  url: "https://one-book.example.com/bills",
  route: "/bills",
  title: "Bills",
  viewport: { width: 1512, height: 982 },
};

const suggestion = {
  kind: "suggestion" as const,
  description: "",
  page,
  screenshot_base64: null,
  current_difficulty: "I open every bill to see which are paid.",
  desired_outcome: "Show the balance in the list.",
  impact: "slows_work" as const,
  frequency: "every_time" as const,
  page_purpose: "Bills is where a vendor invoice is entered.",
};

describe("feedbackReportSchema", () => {
  it("accepts a suggestion that carries its argument", () => {
    const parsed = feedbackReportSchema.safeParse(suggestion);
    expect(parsed.success).toBe(true);
  });

  it("still accepts a bare fault report", () => {
    // The extra fields are optional on purpose: somebody reporting a broken
    // screen should not have to rank it before they can send it.
    const parsed = feedbackReportSchema.safeParse({
      kind: "broken",
      description: "The total is wrong.",
      page,
      screenshot_base64: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an impact the database would reject", () => {
    // The check constraint in migration 0086 lists three values; anything else
    // must fail here, not after the reporter has typed everything out.
    const parsed = feedbackReportSchema.safeParse({ ...suggestion, impact: "critical" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a frequency the database would reject", () => {
    const parsed = feedbackReportSchema.safeParse({ ...suggestion, frequency: "daily" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a difficulty longer than the column allows", () => {
    const parsed = feedbackReportSchema.safeParse({
      ...suggestion,
      current_difficulty: "x".repeat(2001),
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a page purpose longer than the column allows", () => {
    const parsed = feedbackReportSchema.safeParse({
      ...suggestion,
      page_purpose: "x".repeat(501),
    });
    expect(parsed.success).toBe(false);
  });
});
