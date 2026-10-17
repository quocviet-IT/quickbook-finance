import { describe, expect, it } from "vitest";
import { timeZoneLabel } from "@/lib/format";

/**
 * The overview pages, the dashboard and Company Settings printed the stored
 * zone as it is kept, "America/New_York". A bookkeeper says Eastern Time.
 */
describe("timeZoneLabel", () => {
  it("names the US zones the way people say them", () => {
    expect(timeZoneLabel("America/New_York")).toBe("Eastern Time");
    expect(timeZoneLabel("America/Chicago")).toBe("Central Time");
    expect(timeZoneLabel("America/Denver")).toBe("Mountain Time");
    expect(timeZoneLabel("America/Phoenix")).toBe("Arizona Time");
    expect(timeZoneLabel("America/Los_Angeles")).toBe("Pacific Time");
    expect(timeZoneLabel("Pacific/Honolulu")).toBe("Hawaii Time");
  });

  it("reads any other zone as its city, never as the raw identifier", () => {
    expect(timeZoneLabel("America/Sao_Paulo")).toBe("Sao Paulo time");
    expect(timeZoneLabel("Europe/London")).toBe("London time");
  });

  it("keeps UTC as UTC", () => {
    expect(timeZoneLabel("UTC")).toBe("UTC");
    expect(timeZoneLabel("Etc/UTC")).toBe("UTC");
  });
});
