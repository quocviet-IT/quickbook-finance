import { describe, expect, it } from "vitest";
import { periodColumnLabel } from "@/lib/domain/period-label";

describe("naming the period a column covers", () => {
  it("calls a whole year by its year, which is what the reader asked for", () => {
    // The report said "Current" and "Prior" over two columns of figures, and a
    // reader comparing two years had to carry the dates from the subtitle in
    // their head — or lose them entirely once the page was printed.
    expect(periodColumnLabel("2024-01-01", "2024-12-31")).toBe("2024");
    expect(periodColumnLabel("2023-01-01", "2023-12-31")).toBe("2023");
  });

  it("calls a whole month by its month", () => {
    expect(periodColumnLabel("2026-08-01", "2026-08-31")).toBe("Aug 2026");
    // February in a leap year still ends its own month.
    expect(periodColumnLabel("2024-02-01", "2024-02-29")).toBe("Feb 2024");
  });

  it("calls a whole quarter by its quarter", () => {
    expect(periodColumnLabel("2026-01-01", "2026-03-31")).toBe("Q1 2026");
    expect(periodColumnLabel("2026-10-01", "2026-12-31")).toBe("Q4 2026");
  });

  it("names whole months that are not a quarter or a year by their months", () => {
    expect(periodColumnLabel("2026-02-01", "2026-05-31")).toBe("Feb–May 2026");
    expect(periodColumnLabel("2025-11-01", "2026-02-28")).toBe("Nov 2025 – Feb 2026");
  });

  it("shows the dates themselves for a range somebody picked by hand", () => {
    // Naming this would mean inventing one. The dates are the honest answer.
    expect(periodColumnLabel("2026-01-01", "2026-08-15")).toBe("2026-01-01 – 2026-08-15");
    expect(periodColumnLabel("2026-03-15", "2026-04-20")).toBe("2026-03-15 – 2026-04-20");
  });

  it("does not pretend a February that stops short is a whole month", () => {
    // The leap day is the boundary that decides it: 28 February 2024 is not the
    // end of that month, and a column headed "Feb 2024" would be a day short.
    expect(periodColumnLabel("2024-02-01", "2024-02-28")).toBe("2024-02-01 – 2024-02-28");
  });

  it("shows what it was given rather than guessing when a date is unreadable", () => {
    expect(periodColumnLabel("", "2026-12-31")).toBe(" – 2026-12-31");
    expect(periodColumnLabel("not a date", "2026-12-31")).toBe("not a date – 2026-12-31");
  });
});
