import { describe, expect, it } from "vitest";
import { passwordPolicyProblems } from "@/lib/domain/password-policy";

describe("passwordPolicyProblems (Microsoft AD/Entra complexity)", () => {
  it("accepts a password meeting length, 3-of-4 categories, and no name parts", () => {
    expect(passwordPolicyProblems("Harbor#2026", "kt.us02@ctyhp.vn", "Kim Thanh")).toEqual([]);
  });

  it("accepts three categories without a symbol — Microsoft asks for 3 of 4, not all 4", () => {
    expect(passwordPolicyProblems("Harbor2026x", "a@b.vn", "")).toEqual([]);
  });

  it("rejects fewer than 8 characters", () => {
    expect(passwordPolicyProblems("Ab1!x", "a@b.vn", "")).toContainEqual(
      expect.stringMatching(/at least 8/),
    );
  });

  it("rejects more than 256 characters", () => {
    const long = "Aa1!" + "x".repeat(260);
    expect(passwordPolicyProblems(long, "a@b.vn", "")).toContainEqual(
      expect.stringMatching(/256/),
    );
  });

  it("rejects only 2 of 4 character categories", () => {
    expect(passwordPolicyProblems("abcdefgh1234", "a@b.vn", "")).toContainEqual(
      expect.stringMatching(/three of the four/i),
    );
  });

  it("rejects a password containing the account name from the email", () => {
    // Account name = the email's local part; case does not hide it.
    expect(passwordPolicyProblems("xKT.us02!9a", "kt.us02@ctyhp.vn", "")).toContainEqual(
      expect.stringMatching(/account name/i),
    );
  });

  it("rejects a password containing a part of the full name of 3+ characters", () => {
    expect(passwordPolicyProblems("xThanh#2026", "a@b.vn", "Kim Thanh")).toContainEqual(
      expect.stringMatching(/name/i),
    );
  });

  it("ignores name parts of two characters or fewer, as the AD rule does", () => {
    // "Vu" is 2 chars — too short to count as a name part.
    expect(passwordPolicyProblems("Vu#Secure99", "a@b.vn", "Vu Nguyen")).toEqual([]);
  });

  it("splits the full name on the AD delimiters (space, comma, period, dash, underscore, #, tab)", () => {
    expect(passwordPolicyProblems("xanhdao!A1z", "a@b.vn", "anh-dao,le")).toContainEqual(
      expect.stringMatching(/name/i),
    );
  });

  it("handles empty account name and full name without crashing", () => {
    expect(passwordPolicyProblems("Harbor#2026", "", null)).toEqual([]);
  });
});
