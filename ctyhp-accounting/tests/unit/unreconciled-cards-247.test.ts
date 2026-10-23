import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardsReconciledStep, type CardCloseStanding } from "@/lib/domain/accounting-dashboard/close-checklist";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0160_unreconciled_cards.sql";
const PERIOD_END = "2026-09-30";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Line comments removed, so naming a thing in prose never reads as doing it. */
function strip(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** The text of one `create or replace function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

const card = (over: Partial<CardCloseStanding> = {}): CardCloseStanding => ({
  label: "2010 Example Card",
  lastCompletedOn: PERIOD_END,
  unmatchedCount: 0,
  ...over,
});

describe("cardsReconciledStep", () => {
  it("is its own step, never the bank's, and does not block the close", () => {
    const s = cardsReconciledStep({ periodEnd: PERIOD_END, cards: [card()] });
    expect(s).toMatchObject({ key: "cards-reconciled", blocksClose: false, href: "/banking/reconcile", workKey: null });
    expect(s.title).toBe("Credit cards are reconciled through the period end");
  });

  it("passes when every card's statement reaches the period end and nothing is unmatched", () => {
    const one = cardsReconciledStep({ periodEnd: PERIOD_END, cards: [card()] });
    expect(one.status).toBe("complete");
    expect(one.evidence).toBe("2010 Example Card is reconciled through 09/30/2026, with nothing unmatched on or before 09/30/2026.");
    const two = cardsReconciledStep({ periodEnd: PERIOD_END, cards: [card(), card({ label: "2020 Other Card", lastCompletedOn: "2026-10-29" })] });
    expect(two.status).toBe("complete");
    expect(two.evidence).toContain("All 2 cards");
  });

  it("checks card by card: one card reconciled says nothing about another", () => {
    const s = cardsReconciledStep({
      periodEnd: PERIOD_END,
      cards: [card(), card({ label: "2020 Other Card", lastCompletedOn: "2026-08-29" }), card({ label: "2030 New Card", lastCompletedOn: null })],
    });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain("Not reconciled through 09/30/2026: 2020 Other Card (last statement ends 08/29/2026), 2030 New Card (never reconciled).");
    expect(s.evidence).not.toContain("2010 Example Card");
  });

  it("an unmatched card line keeps the step open even when every statement is in", () => {
    const s = cardsReconciledStep({ periodEnd: PERIOD_END, cards: [card({ unmatchedCount: 1 }), card({ label: "2020 Other Card", unmatchedCount: 2 })] });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toBe("Every card is reconciled through 09/30/2026. 3 card lines dated on or before 09/30/2026 are still unmatched.");
  });

  it("a company with no card under Banking has nothing to check", () => {
    expect(cardsReconciledStep({ periodEnd: PERIOD_END, cards: [] }).status).toBe("not-applicable");
  });

  it("banking that did not answer is never reported as reconciled", () => {
    expect(cardsReconciledStep({ periodEnd: PERIOD_END, cards: null }).status).toBe("unavailable");
  });
});

describe("migration 0160", () => {
  const raw = read(`supabase/migrations/${FILE}`);
  const sql = strip(raw);

  it("lands in every company's schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });

  it("only adds functions, reads only, and keeps the tables' own row security", () => {
    expect(sql).not.toMatch(/\b(insert into|delete from|update \w+ set|alter table|drop )\b/i);
    expect(sql).not.toMatch(/security definer/i);
    for (const fn of ["acc_unreconciled_cards", "acc_bank_close_standing"]) {
      expect(sql).toContain(`revoke all on function ${fn}(date) from public, anon;`);
      expect(sql).toContain(`grant execute on function ${fn}(date) to authenticated, service_role;`);
    }
  });

  it("counts only cards kept under Banking, their posted lines no completed reconciliation holds", () => {
    const fn = functionText(sql, "acc_unreconciled_cards");
    expect(fn).toMatch(/a\.account_type = 'credit_card'/);
    expect(fn).toMatch(/exists \(select 1 from acc_bank_account b where b\.account_id = a\.id\)/);
    expect(fn).toMatch(/e\.status = 'posted'/);
    expect(fn).toMatch(/e\.entry_date <= p_as_of/);
    expect(fn).toMatch(/r\.status = 'completed'/);
    // Debit positive, as the books keep a card and as acc_unreconciled_bank signs it.
    expect(fn).toMatch(/case when l\.debit_minor > 0 then l\.amount_base_minor else -l\.amount_base_minor end/);
  });

  it("gives every bank account record its latest completed statement and its unmatched lines", () => {
    const fn = functionText(sql, "acc_bank_close_standing");
    expect(fn).toMatch(/a\.account_type = 'credit_card'/);
    expect(fn).toMatch(/max\(r\.statement_ending_date\)/);
    expect(fn).toMatch(/r\.status = 'completed'/);
    // Whenever the statement ends: one ending after the period end still covers it.
    expect(fn).not.toMatch(/statement_ending_date <= p_as_of/);
    for (const filter of [/t\.status = 'unmatched'/, /t\.pending = false/, /t\.provider_removed_at is null/, /t\.txn_date <= p_as_of/]) {
      expect(fn).toMatch(filter);
    }
  });
});

describe("where the card figures are read", () => {
  it("the close checklist reads every bank account record in one call, and checks cards apart", () => {
    const src = read("lib/services/accounting-dashboard/close-readiness.ts");
    expect(src.match(/sb\.rpc\("acc_bank_close_standing"/g)).toHaveLength(1);
    expect(src).not.toMatch(/from\("acc_bank_account"\)/);
    expect(src).not.toMatch(/from\("acc_bank_transaction"\)/);
    expect(src).toMatch(/filter\(\(r\) => !r\.is_card\)/);
    expect(src).toMatch(/cardsReconciledStep\(/);
  });

  it("the dashboard reads the cards' figure and shows it as the statement prints it", () => {
    const src = read("lib/services/dashboard.ts");
    expect(src).toMatch(/sb\.rpc\("acc_unreconciled_cards", \{ p_as_of: asOf \}\)/);
    expect(src).toMatch(/shown\(Number\(c\.amount_minor \?\? 0\), "card"\)/);
    const client = read("app/(app)/dashboard/DashboardClient.tsx");
    expect(client).toContain('"Unreconciled card activity"');
    expect(client).toMatch(/metrics\.unreconciledCards && metrics\.unreconciledCards\.cards > 0/);
  });
});

describe("the page's own ground", () => {
  it("is painted on html, so nothing white shows below a short page in dark mode", () => {
    const css = read("app/globals.css");
    const html = css.match(/(^|\n)html \{[^}]*\}/)?.[0] ?? "";
    expect(html).toMatch(/background: var\(--ob-surface-page\);/);
  });
});

describe("the 2.47 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.47")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.47);
    expect(release.date).toBe("2026-10-23");
  });

  it("says where the card figure shows, how a card is checked at the close, and what the fix was", () => {
    for (const words of [
      "Unreconciled card activity on the dashboard",
      "what is owed is positive",
      "Each card is checked on its own",
      "The bank's step now counts bank accounts only",
      "No white band below a short page in dark mode",
    ]) {
      expect(said).toContain(words);
    }
  });
});
