import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { theme } from "antd";
import { describe, expect, it } from "vitest";
import TableEmpty from "@/components/ui/TableEmpty";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { antdThemeTokens, resolveToken } from "@/lib/design/tokens";

describe("the empty lists release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Empty lists that say what to do"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-20");
  });

  it("names the five screens, the loading fix and the selected colour", () => {
    for (const words of ["Pay Bills, Sales Tax, Accounting Periods, Audit History or Approvals", "still loading", "pale teal", "Dark mode is unchanged"]) {
      expect(said).toContain(words);
    }
  });
});

describe("an empty table", () => {
  const html = (props: Parameters<typeof TableEmpty>[0]) => renderToString(createElement(TableEmpty, props));

  it("says what is missing, what to do, and offers the button", () => {
    const out = html({ title: "No periods for 2026 yet", description: "Generate the year's monthly periods.", action: createElement("button", null, "Generate periods") });
    expect(out).toContain("No periods for 2026 yet");
    expect(out).toContain("Generate the year&#x27;s monthly periods.");
    expect(out).toContain("Generate periods");
  });

  it("says nothing while it is still loading", () => {
    expect(html({ title: "No open bills", loading: true })).not.toContain("No open bills");
  });
});

describe("the five screens' empty lists", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const screens = [
    "components/payables/PayRunPanel.tsx",
    "app/(app)/pay-bills/PayBillsClient.tsx",
    "app/(app)/sales-tax/SalesTaxClient.tsx",
    "app/(app)/settings/periods/PeriodsClient.tsx",
    "app/(app)/settings/audit/AuditClient.tsx",
    "app/(app)/approvals/ApprovalsClient.tsx",
  ];

  it("use TableEmpty rather than a bare line of text", () => {
    for (const path of screens) {
      const source = read(path);
      expect(source, path).toContain("<TableEmpty");
      // A plain string is a line with no next step. The one left is the
      // field list nested inside an audit entry, where a line is enough.
      const bare = [...source.matchAll(/emptyText: "([^"]*)"/g)].map((m) => m[1]);
      expect(bare.filter((text) => text !== "No field changed"), path).toEqual([]);
    }
  });

  it("wait for the pay run and the periods before saying they are empty", () => {
    for (const path of ["components/payables/PayRunPanel.tsx", "app/(app)/settings/periods/PeriodsClient.tsx"]) {
      expect(read(path), path).toMatch(/const \[loading, setLoading\] = useState\(true\)/);
    }
  });
});

describe("a selected option or row in light mode", () => {
  // Ant Design derives these from the primary, and for this teal it derived
  // #a8b5b2: the selected company in the switcher sat in a heavy grey.
  const light = theme.getDesignToken({ algorithm: theme.defaultAlgorithm, token: antdThemeTokens("light").token });

  it("is the pale teal token, not a derived grey", () => {
    expect(light.controlItemBgActive).toBe(resolveToken("accent.selected", "light"));
    expect(light.controlItemBgActiveHover).toBe(resolveToken("accent.selectedHover", "light"));
    expect(light.colorPrimaryBg).not.toBe("#a8b5b2");
  });
});

describe("a plain line of text in an empty list", () => {
  it("is drawn in the secondary text colour, not antd's disabled grey", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(
      /\.ant-table-wrapper \.ant-table \.ant-table-tbody > tr\.ant-table-placeholder,\s*body \.ant-empty \.ant-empty-description,\s*\.ant-empty \.accounting-empty-description\.ant-typography \{\s*color: var\(--ob-text-secondary\);/,
    );
  });
});
