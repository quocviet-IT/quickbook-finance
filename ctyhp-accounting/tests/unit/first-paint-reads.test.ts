import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2.92: screens that read their list only once the page had loaded.
 *
 * Measured on production 31/10, each of these waited for the page's code, then
 * sent a Server Action, and Next sends a page's Server Actions one after
 * another: Journal 1.3–2.5 s, Pay Bills 1.7 s, Credit Memos 1.5 s, Vendor
 * Credits 1.3 s; the reconciliation screen sent four in a row on opening and
 * three on every reload. Each page now reads its screen's first list itself,
 * and the screen reads again only for what comes after.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import { firstPaintRead } from "@/lib/services/request-kind";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("firstPaintRead", () => {
  beforeEach(() => mocks.headers.mockResolvedValue(new Headers({ rsc: "1" })));

  it("reads for an ordinary page load", async () => {
    expect(await firstPaintRead(async () => [1, 2])).toEqual([1, 2]);
  });

  it("does not read when the page is drawn in answer to a save", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "next-action": "abc" }));
    const reader = vi.fn(async () => [1]);
    expect(await firstPaintRead(reader)).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it("hands back nothing rather than failing the page, so the screen reads and reports for itself", async () => {
    expect(await firstPaintRead(async () => { throw new Error("relation does not exist"); })).toBeNull();
  });
});

describe("each screen's first list comes with its page", () => {
  const screens: Array<{ page: string; read: RegExp; client: string; skip: RegExp }> = [
    {
      page: "app/(app)/journal/page.tsx",
      // One page since 2.93; see journal-paging.test.ts.
      read: /firstPaintRead\(\(\) =>\s*readJournalPage\(sb, \{ entryId: initialEntryId \?\? null, from: null, to: null \}, 1, JOURNAL_DEFAULT_PAGE_SIZE\),?\s*\)/,
      client: "app/(app)/journal/JournalClient.tsx",
      skip: /if \(initialJournal\) return;\s*\/\/ eslint-disable-next-line react-hooks\/set-state-in-effect\s*void load\(\);/,
    },
    {
      page: "app/(app)/credit-memos/page.tsx",
      read: /firstPaintRead\(\(\) => listCreditMemos\(sb\)\)/,
      client: "app/(app)/credit-memos/CreditMemosClient.tsx",
      skip: /if \(initialMemos\) return;/,
    },
    {
      page: "app/(app)/vendor-credits/page.tsx",
      read: /firstPaintRead\(\(\) => listVendorCredits\(sb\)\)/,
      client: "app/(app)/vendor-credits/VendorCreditsClient.tsx",
      skip: /if \(initialCredits\) return;/,
    },
    {
      page: "app/(app)/pay-bills/page.tsx",
      read: /firstPaintRead\(async \(\) => getPayRun\(sb, \(await companyClock\(sb\)\)\.today\)\)/,
      client: "components/payables/PayRunPanel.tsx",
      skip: /if \(seeded\.current\) \{\s*seeded\.current = false;\s*return;\s*\}\s*void load\(\);/,
    },
    {
      page: "app/(app)/banking/reconcile/[id]/page.tsx",
      read: /firstPaintRead\(\(\) => readReconcileWorkspace\(sb, id\)\)/,
      client: "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx",
      skip: /if \(seeded\.current\) seeded\.current = false;\s*else void load\(\);/,
    },
    {
      page: "app/(app)/banking/reconcile/history/page.tsx",
      read: /firstPaintRead\(\(\) => getReconciliationHistoryWithStandings\(sb, today\)\)/,
      client: "app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx",
      skip: /if \(seeded\.current\) \{\s*seeded\.current = false;\s*return;\s*\}\s*void load\(\);/,
    },
    {
      page: "app/(app)/accounts/page.tsx",
      read: /canWrite\(r\) \? firstPaintRead\(\(\) => summarizeClassificationPlan\(sb\)\) : null/,
      client: "app/(app)/accounts/ClassifyAccountsButton.tsx",
      skip: /if \(!canWrite\) return;\s*if \(seeded\.current\) \{\s*seeded\.current = false;\s*return;\s*\}\s*refresh\(\);/,
    },
  ];

  for (const screen of screens) {
    it(`${screen.page}: read by the page, skipped once by the screen`, () => {
      expect(read(screen.page)).toMatch(screen.read);
      expect(read(screen.client)).toMatch(screen.skip);
    });
  }

  it("reloads the reconciliation screen with one request, not three", () => {
    const workspace = read("app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx");
    expect(workspace).toContain("await reconcileWorkspaceAction(reconciliationId)");
    expect(workspace).not.toMatch(/reconciliationLinesAction|reconciliationDetailAction|reconciliationStatementAction/);
  });

  it("reads the registers under the bank lines with the page, for the account it opens on", () => {
    const view = read("app/(app)/banking/banking-view.ts");
    expect(view).toMatch(/settled\(\(\) => listBankStatementImports\(sb, bankAccountId\)\)/);
    expect(view).toMatch(/settled\(\(\) => listBankFeedSyncs\(sb, bankAccountId\)\)/);
    const banking = read("app/(app)/banking/BankingClient.tsx");
    expect(banking).toContain("initialRows={openingRegisters?.imports}");
    expect(banking).toContain("initialRows={openingRegisters?.syncs}");
  });
});
