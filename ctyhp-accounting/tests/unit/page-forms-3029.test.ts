import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.29: the forms the UI audit of 13 November 2026 still found wanting once
 * it was run again on 3.0.28 — the company settings, the vendor form, Work
 * policy and Purchasing — save once, keep what was typed, and say why a save
 * failed where the reader is looking.
 */
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const company = read("app", "(app)", "settings", "company", "CompanySettingsClient.tsx");
const vendors = read("app", "(app)", "vendors", "VendorsClient.tsx");
const workPolicy = read("app", "(app)", "settings", "work-policy", "WorkPolicyClient.tsx");
const purchasing = read("app", "(app)", "settings", "purchasing", "PurchasingConfigClient.tsx");
const formActions = read("components", "ui", "FormActions.tsx");
const css = read("app", "globals.css");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("a page form's buttons (3.0.29)", () => {
  it("stay at the foot of the window while the form runs on below it", () => {
    const bar = rule(".accounting-form-actions");
    expect(bar).toMatch(/position: sticky;/);
    expect(bar).toMatch(/bottom: 0;/);
    // A ground of its own, or the fields show through as they pass under it.
    expect(bar).toMatch(/background: var\(--ob-surface-card\);/);
    expect(bar).not.toMatch(/box-shadow/);
  });

  it("say when there are unsaved changes, and keep a failed save's reason beside Save", () => {
    expect(formActions).toMatch(/dirty \? "Unsaved changes"/);
    expect(formActions).toMatch(/role="alert"/);
    expect(formActions).toMatch(/aria-live="polite"/);
  });
});

describe("the company settings form (3.0.29)", () => {
  it("cannot be sent twice: Save is busy until the answer comes back", () => {
    expect(company).toMatch(/if \(saving\) return;/);
    expect(company).toMatch(/loading=\{saving\}/);
    expect(company).toMatch(/finally \{\s*setSaving\(false\);/);
  });

  it("asks before Cancel or a link throws the changes away", () => {
    expect(company).toMatch(/closeOrConfirmDiscard\(/);
    expect(company).toMatch(/useUnsavedGuard\(editing && dirty/);
    expect(company).toMatch(/onClick=\{cancelEdit\}/);
  });

  it("keeps a refused save open, with the reason beside Save, and focuses the first wrong field", () => {
    expect(company).toMatch(/validateOrFocus\(form\)/);
    expect(company).toMatch(/<FormActions dirty=\{dirty\} error=\{saveError\}>/);
    expect(company).not.toMatch(/message\.error/);
  });

  it("is in titled sections, one field to a row", () => {
    const legends = [...company.matchAll(/<legend>([^<]+)<\/legend>/g)].map((m) => m[1]);
    expect(legends).toEqual(["Company", "Address and contact", "Accounting", "Inventory", "Invoices"]);
    // Fields no longer wrap side by side wherever they fit.
    expect(company).not.toMatch(/<Space wrap>/);
  });

  it("says when its history could not be read, and offers to read it again", () => {
    expect(company).toMatch(/versionsState === "failed"/);
    expect(company).toMatch(/Retry/);
    expect(company).toMatch(/loading=\{versionsState === "loading"\}/);
  });

  it("lines the version number up on the right", () => {
    expect(company).toMatch(/title: "Version", dataIndex: "version", width: COMPANY_VERSIONS_FIXED_WIDTHS\[0\], align: "right"/);
  });
});

describe("the New vendor form works as the customer one does (3.0.29)", () => {
  it("asks before a typed vendor is thrown away", () => {
    expect(vendors).toMatch(/closeOrConfirmDiscard\(/);
    expect(vendors).toMatch(/useUnsavedGuard\(open && dirty/);
    expect(vendors).toMatch(/maskClosable=\{false\}/);
  });

  it("says why a save was refused inside the form", () => {
    expect(vendors).toMatch(/<Alert type="error" showIcon role="alert" title=\{saveError\} \/>/);
    expect(vendors).not.toMatch(/message\.error/);
    expect(vendors).toMatch(/validateOrFocus\(form\)/);
  });

  it("types its email and phone, so a phone shows a number pad and the browser can fill them", () => {
    expect(vendors).toMatch(/<Input type="email" autoComplete="email" \/>/);
    expect(vendors).toMatch(/<Input type="tel" autoComplete="tel" \/>/);
  });

  it("offers Clear filters when nothing matches", () => {
    expect(vendors).toMatch(/<Button onClick=\{clearFilters\}>Clear filters<\/Button>/);
  });
});

describe("Work policy and Purchasing (3.0.29)", () => {
  for (const [name, source] of [["Work policy", workPolicy], ["Purchasing", purchasing]] as const) {
    it(`${name}: says what is unsaved, asks before leaving, keeps a refusal beside Save`, () => {
      expect(source).toMatch(/onValuesChange=\{\(\) => setDirty\(true\)\}/);
      expect(source).toMatch(/useUnsavedGuard\(dirty/);
      expect(source).toMatch(/<FormActions dirty=\{dirty\} error=\{saveError\}>/);
      expect(source).not.toMatch(/message\.error/);
    });
  }
});

describe("questions before an action that changes the books (3.0.29)", () => {
  const files = {
    import: read("app", "(app)", "settings", "import", "ImportClient.tsx"),
    reconcile: read("app", "(app)", "banking", "reconcile", "[id]", "ReconcileWorkspaceClient.tsx"),
    history: read("app", "(app)", "banking", "reconcile", "history", "ReconcileHistoryClient.tsx"),
    approvals: read("app", "(app)", "approvals", "ApprovalsClient.tsx"),
    periods: read("app", "(app)", "settings", "periods", "PeriodsClient.tsx"),
  };

  it("open on Cancel, so Enter does not import, approve or bring history forward", () => {
    expect(files.import).toMatch(/autoFocusButton: "cancel",\n\s+title: `Import into/);
    expect(files.reconcile).toMatch(/autoFocusButton: "cancel",\n\s+title: `\$\{BRING_HISTORY_FORWARD\}\?`/);
    expect(files.history).toMatch(/autoFocusButton: "cancel",\n\s+title: `\$\{offer\.action\}\?`/);
    expect(files.approvals).toMatch(/autoFocusButton: "cancel",\n\s+title: `Approve/);
  });

  it("put the cursor in the reason a reopening asks for, and name that field", () => {
    for (const source of [files.periods, files.reconcile]) {
      expect(source).toMatch(/autoFocusButton: null,[\s\S]{0,120}<Input\s+autoFocus\s+aria-label="Reason"/);
    }
  });
});

describe("the release note (3.0.29)", () => {
  it("says what changed on these forms", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.29");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/Unsaved changes/);
    expect(said).toMatch(/vendor/i);
    expect(said).toMatch(/company settings/i);
  });
});
