import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { pageMetadata, recordTitle } from "@/lib/domain/page-title";
import { knownScreenName } from "@/lib/domain/screen-names";
import { RELEASES } from "@/lib/domain/changelog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconciliationTitle } from "@/lib/services/page-titles";

/**
 * 3.0.32: every browser tab used to say "One Book". Each page now names its
 * screen in its menu's words, and a record's page names the record first.
 */
const ROOT = process.cwd();
const APP = join(ROOT, "app");
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** The URL a page file serves, route groups such as (app) left out. */
const routeOf = (file: string) =>
  "/" +
  relative(APP, file)
    .replaceAll("\\", "/")
    .replace(/\/?page\.tsx$/, "")
    .split("/")
    .filter((part) => !/^\(.*\)$/.test(part))
    .join("/");

/** Pages that only send the reader on, and so are never seen. */
const REDIRECT_ONLY = new Set(["/", "/reports/beancount"]);
/** A client page names its tab from its layout. */
const NAMED_BY_LAYOUT = new Set(["/status"]);

describe("every page names its browser tab (3.0.32)", () => {
  const all = pages(APP).map((file) => ({ file, route: routeOf(file), text: read(file) }));

  it("finds the pages (the scan itself works)", () => {
    expect(all.length).toBeGreaterThan(90);
  });

  it("with a title of its own, or a reason not to need one", () => {
    const untitled = all
      .filter(({ route }) => !REDIRECT_ONLY.has(route) && !NAMED_BY_LAYOUT.has(route))
      .filter(({ text }) => !/export (const metadata|async function generateMetadata)/.test(text))
      .map(({ route }) => route);
    expect(untitled).toEqual([]);
    expect(read(join(APP, "status", "layout.tsx"))).toMatch(/export const metadata: Metadata = \{ title: "Status" \}/);
  });

  it("a page in the menus is titled by its own route, which its menus name", () => {
    const wrong: string[] = [];
    for (const { route, text } of all) {
      const match = text.match(/export const metadata = pageMetadata\("([^"]+)"\)/);
      if (!match) continue;
      if (match[1] !== route) wrong.push(`${route} says ${match[1]}`);
      if (!knownScreenName(route)) wrong.push(`${route} has no name in the menus`);
    }
    expect(wrong).toEqual([]);
  });

  it("a record's page asks for the record, and checks the id before reading", () => {
    const records = all.filter(({ route }) => route.includes("[id]"));
    expect(records.length).toBe(10);
    for (const { route, text } of records) {
      expect(text, route).toMatch(/recordMetadata\(/);
      if (/generateMetadata/.test(text) && /createSupabaseServerClient\(\), id\)/.test(text)) {
        expect(text, route).toMatch(/if \(!\/\^\[0-9a-f\]\{8\}.*\.test\(id\)\) return recordMetadata\(null/);
      }
    }
  });
});

describe("what a tab says (3.0.32)", () => {
  it("names a screen as its menu does, and the layout adds One Book", () => {
    expect(pageMetadata("/invoices")).toEqual({ title: "Invoices" });
    expect(pageMetadata("/banking/reconcile/from-files")).toEqual({ title: "Reconcile from statement files" });
    expect(read(join(APP, "layout.tsx"))).toMatch(/title: \{ default: "One Book", template: "%s · One Book" \}/);
  });

  it("puts a record before its screen, and falls back to the screen alone", () => {
    expect(recordTitle("Alder Grove Ventures", "/customers")).toBe("Alder Grove Ventures · Customers");
    expect(recordTitle(null, "/customers")).toBe("Customers");
    expect(recordTitle("  ", "/purchase-orders")).toBe("Purchase Orders");
    expect(recordTitle("Bank statement March", "Statement file")).toBe("Bank statement March · Statement file");
  });
});

describe("a reconciliation's tab (3.0.32)", () => {
  /** A client that answers one select with one row, and records what was asked. */
  function fakeClient(row: unknown) {
    const asked: string[] = [];
    const client = {
      from: (table: string) => ({
        select: (columns: string) => {
          asked.push(`${table}: ${columns}`);
          return { eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
        },
      }),
    };
    return { client: client as unknown as SupabaseClient, asked };
  }

  it("names the account by its ledger account, and the statement date", async () => {
    const { client, asked } = fakeClient({ statement_ending_date: "2026-01-31", bank_account: { acc_account: { name: "Checking" } } });
    expect(await reconciliationTitle(client, "45d24de5-7bd4-4f23-b6b7-fc91a96e9e0d")).toBe("Checking, 01/31/2026");
    // A bank account has no name column of its own; asking for one failed the whole read.
    expect(asked).toEqual(["acc_statement_reconciliation: statement_ending_date,bank_account:acc_bank_account(acc_account(name))"]);
  });

  it("keeps whichever half it has", async () => {
    expect(await reconciliationTitle(fakeClient({ statement_ending_date: null, bank_account: [{ acc_account: [{ name: "Savings" }] }] }).client, "x")).toBe("Savings");
    expect(await reconciliationTitle(fakeClient(null).client, "x")).toBeNull();
  });
});

describe("the release note (3.0.32)", () => {
  it("says the tabs are named", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.32");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/tab/i);
  });
});
