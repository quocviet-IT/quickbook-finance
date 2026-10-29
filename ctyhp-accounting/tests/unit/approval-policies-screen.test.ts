import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { APPROVAL_POLICY_FIXED_WIDTHS } from "@/app/(app)/settings/approvals/ApprovalPoliciesClient";

/**
 * Approval Policies was Ant Design's own table, as wide as its longest
 * description: on a phone the first column filled the screen and every switch
 * sat past its edge. It is a fitted DataTable now.
 */
describe("the Approval Policies table", () => {
  const fixed = APPROVAL_POLICY_FIXED_WIDTHS.reduce((sum, px) => sum + px, 0);

  it("fits the narrowest computer screen with the controlled action at its floor", () => {
    expect(fitsBox(fixed, COLUMN.TEXT_MIN)).toBe(true);
  });

  it("gives each switch room for its heading, the longest being Segregation of duties", () => {
    expect(APPROVAL_POLICY_FIXED_WIDTHS[0]).toBe(COLUMN.SWITCH);
    expect(APPROVAL_POLICY_FIXED_WIDTHS[2]).toBe(COLUMN.SWITCH);
    // 137px of heading, measured on the page, and 8px of cell padding either side.
    expect(COLUMN.SWITCH).toBeGreaterThanOrEqual(137 + 16);
  });
});
