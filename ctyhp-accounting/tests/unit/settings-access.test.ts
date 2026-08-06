import { describe, expect, it } from "vitest";
import { settingsGateFor } from "@/lib/domain/navigation";

describe("settingsGateFor", () => {
  it("finds the catalog entry behind a settings route", () => {
    expect(settingsGateFor("/settings/users").anyPermissions).toEqual(["users.manage"]);
  });

  it("throws for a route with no catalog entry, rather than opening it", () => {
    expect(() => settingsGateFor("/settings/nowhere")).toThrow(/no settings catalog entry/i);
  });
});
