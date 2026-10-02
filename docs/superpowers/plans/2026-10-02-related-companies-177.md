# Related companies (1.77) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each company register the other companies its owners run, so a bank line naming one — money in or out — is proposed to that company's single due-from/to account, before any rule or history, and never to income or a cost.

**Architecture:** A new table `acc_related_company` (migration 0131) holds the register. A pure module `lib/domain/related-companies.ts` decides which companies a line names, and a second pure module `lib/domain/register-claim.ts` weighs those together with the cards and loans of 1.75/1.76: one claimant or nothing. `suggestCoding` gives a related company the new source `related` ahead of rules and history, so the existing posting path (`acc_categorise_bank_transaction`) and every existing screen (Review import, the Category cell, Code all) carry it. A **Related companies** section on Banking › Rules lists each company with its balance today.

**Tech Stack:** Next.js App Router, React 19 + Ant Design 6, Supabase (Postgres, PostgREST, RLS), Zod 4, Vitest, `pg` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-10-02-related-companies-design.md`.

## Global Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads (`readAllPages`), each page with a total order.
- Nothing is posted without a person's click.
- Money is in minor units end to end.
- `lib/domain/*.ts` files use relative `.ts` imports only (`"./bank-rules.ts"`), never `@/`.
- One account per related company: money out debits it, money in credits it. Allowed account types: `current_asset`, `current_liability`, `long_term_liability`, active and posting, never a holding account.
- An account belongs to at most one related company, and never to a related company and Cards and loans at once.
- Phrases match whole words, case-insensitive (`wordPattern`); every phrase is at least 2 characters; words ≤ 200 characters; name 1–120 characters after trimming.
- **Post as:** `Between companies · {account label}`. **Why:** `Names {name}, a related company. Money between your companies is owed, never income or a cost.` Short label on Bank Transactions: `Related`.
- Rivals **why**: `Matches A and B — code it yourself`; past two, `Matches A, B and N more — code it yourself`. A related company is named by its name, a card or loan by `{code} {name}` of its account.
- Stage files by name; never `git add -A` (the repo is public and has untracked client files). No Co-Authored-By trailer. Write commit messages to `../.superpowers/sdd/commit-msg.txt` and use `git commit -F`.
- No real client names, account digits or figures in repository files. Fixtures are invented ("Example Affiliate", "2050 Example Card").
- Migration 0131 goes live only with the user's approval. Writes to live data happen only on the sample company PC-Test.
- Run everything from `ctyhp-accounting/`.
- Never pipe test output through `tail`/`head` before a push; read the pass/fail lines.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0131_related_company.sql` (new) | The register table, its checks, RLS, grants and audit. |
| `tests/unit/related-company-migration.test.ts` (new) | A static reading of 0131. |
| `lib/domain/company-export.ts` (modify) | Export the register with the rest of a company. |
| `lib/domain/related-companies.ts` (new) | Pure rules: the entry type, matching, usability, defaults, validation, balance words. |
| `tests/unit/related-companies.test.ts` (new) | Tests for the above. |
| `lib/domain/repayments.ts` (modify) | `repaymentHits` (Task 3); `repaymentFor` and `RepaymentFact` removed (Task 5). |
| `lib/domain/register-claim.ts` (new) | One claim over cards, loans and related companies; the rivals sentence. |
| `tests/unit/register-claim.test.ts` (new) | Tests for the claim. |
| `lib/services/repayment-register.ts` (modify) | Reads the related companies too; `RepaymentContext.related`. |
| `lib/domain/coding.ts` (modify) | The `related` source; `suggestCoding` takes the claim. |
| `lib/services/coding.ts` (modify) | `suggestionsFrom` builds the claim; `codingSuggestions` passes the related companies. |
| `tests/unit/coding.test.ts`, `tests/unit/coding-service.test.ts` (modify) | The claim and the related source. |
| `lib/domain/statement-review.ts` (modify) | Rivals by name; the `Between companies` label and `related` marker. |
| `lib/domain/loan-interest.ts` (modify) | A loan line a related company also claims is no loan suggestion. |
| `lib/services/statement-review.ts`, `lib/services/loan-payments.ts` (modify) | Pass the related companies and the rivals' labels. |
| `tests/unit/statement-review-cards.test.ts`, `tests/unit/statement-review-loans.test.ts`, `tests/unit/loan-interest.test.ts`, `tests/unit/repayments.test.ts` (modify) | Follow the changes above. |
| `tests/unit/statement-review-related.test.ts` (new) | Review import with a related company. |
| `lib/services/related-companies.ts` (new) | Save, delete, preview, waiting counts, balances. |
| `lib/services/repayments.ts` (modify) | Cards and loans refuses a related company's account. |
| `lib/domain/schemas.ts` (modify) | `relatedCompanyPreviewSchema`, `relatedCompanyInputSchema`. |
| `app/(app)/banking/rules/actions.ts` (modify) | Preview, save and delete actions. |
| `tests/unit/related-companies-service.test.ts` (new) | `relatedPreviewFrom`, `relatedDuplicateMessage`, the schemas. |
| `app/(app)/banking/rules/related-columns.ts` (new) | The table's fixed widths. |
| `tests/unit/related-columns.test.ts` (new) | The table fits 1280px. |
| `app/(app)/banking/rules/RelatedCompanyFormModal.tsx` (new) | Add or edit a related company, with the live preview. |
| `app/(app)/banking/rules/RelatedCompaniesSection.tsx` (new) | The Related companies section. |
| `app/(app)/banking/rules/repayments.module.css` (modify) | Its comment names both sections. |
| `app/(app)/banking/rules/page.tsx` (modify) | Loads the register and renders the section; Cards and loans no longer offers a related company's account. |
| `app/(app)/banking/imports/[id]/ReviewImportClient.tsx` (modify) | Header count *between companies*. |
| `scripts/verify-related-companies.mjs` (new) | A rolled-back behavioural check of 0131 on every company. |
| `lib/domain/changelog.ts`, `lib/domain/system-guide.ts` (modify) | Release 1.77 and a guide step. |

---

### Task 1: Migration 0131 — the register table

**Files:**
- Create: `supabase/migrations/0131_related_company.sql`
- Create: `tests/unit/related-company-migration.test.ts`
- Modify: `lib/domain/company-export.ts` (after the `"acc_repayment_account",` line, about line 63)

**Interfaces:**
- Produces: table `acc_related_company(id, name, account_id, match_words, is_active, created_by, created_at, updated_by, updated_at)`; constraint names `acc_related_company_name_ck`, `acc_related_company_words_ck`, `acc_related_company_account_id_key` (from `unique`); unique index `acc_related_company_name_key` on `lower(btrim(name))`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/related-company-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/domain/company-export";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0131_related_company.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0131 related company register", () => {
  const sql = body();
  it("keeps one company per account, with a name and the words its bank prints", () => {
    expect(sql).toMatch(/create table if not exists acc_related_company/i);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/account_id\s+uuid not null unique references acc_account \(id\)/i);
    expect(sql).toMatch(/constraint acc_related_company_name_ck\s+check \(length\(btrim\(name\)\) between 1 and 120\)/i);
    expect(sql).toMatch(/constraint acc_related_company_words_ck\s+check \(btrim\(match_words\) <> '' and length\(match_words\) <= 200\)/i);
  });
  it("keeps names unique in any case", () => {
    expect(sql).toMatch(/create unique index if not exists acc_related_company_name_key\s+on acc_related_company \(lower\(btrim\(name\)\)\)/i);
  });
  it("is staff-written, viewer-readable and audited", () => {
    expect(sql).toMatch(/after insert or update or delete on acc_related_company\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/before insert or update on acc_related_company\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for insert with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_related_company from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_related_company to authenticated/i);
    expect(sql).toMatch(/grant all on acc_related_company to service_role/i);
  });
  it("changes nothing that exists", () => {
    expect(sql).not.toMatch(/alter table (?!acc_related_company)/i);
    expect(sql).not.toMatch(/drop table/i);
  });
  it("travels with the company export", () => {
    expect(EXPORT_TABLES).toContain("acc_related_company");
    expect(EXPORT_TABLES.indexOf("acc_related_company")).toBeGreaterThan(EXPORT_TABLES.indexOf("acc_account"));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/related-company-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '…0131_related_company.sql'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0131_related_company.sql`:

```sql
-- ============================================================================
-- 0131 — Related companies: money between companies the same owners run.
--
-- Money sent to a sister company is a loan to it, and money received from one
-- is a loan from it — never income or a cost. Coded singly in each book, the
-- same movement becomes income in one and a cost in the other. Each company
-- lists its related companies with the words its bank prints for them and the
-- one account that carries what each owes or is owed: money out debits it,
-- money in credits it. lib/domain/related-companies.ts recognises a line
-- naming one, in or out, before any rule or history; it posts through
-- acc_categorise_bank_transaction as before.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_related_company (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  account_id   uuid not null unique references acc_account (id),
  match_words  text not null,
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now(),
  constraint acc_related_company_name_ck
    check (length(btrim(name)) between 1 and 120),
  constraint acc_related_company_words_ck
    check (btrim(match_words) <> '' and length(match_words) <= 200)
);

create unique index if not exists acc_related_company_name_key
  on acc_related_company (lower(btrim(name)));

drop trigger if exists acc_related_company_actor_stamp on acc_related_company;
create trigger acc_related_company_actor_stamp
  before insert or update on acc_related_company
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_related_company_atomic_audit on acc_related_company;
create trigger acc_related_company_atomic_audit
  after insert or update or delete on acc_related_company
  for each row execute function acc_audit_row_change();

alter table acc_related_company enable row level security;

drop policy if exists acc_related_company_sel on acc_related_company;
create policy acc_related_company_sel on acc_related_company
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_related_company_ins on acc_related_company;
create policy acc_related_company_ins on acc_related_company
  for insert with check (acc_is_staff());
drop policy if exists acc_related_company_upd on acc_related_company;
create policy acc_related_company_upd on acc_related_company
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_related_company_del on acc_related_company;
create policy acc_related_company_del on acc_related_company
  for delete using (acc_is_staff());

revoke all on acc_related_company from public, anon;
grant select, insert, update, delete on acc_related_company to authenticated;
grant all on acc_related_company to service_role;
```

- [ ] **Step 4: Export it**

In `lib/domain/company-export.ts`, directly after the line `"acc_repayment_account",` add:

```ts
  // Related companies (0131): which account carries what each owes or is owed.
  "acc_related_company",
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/related-company-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/company-export-order.test.ts tests/unit/backup-restore.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0131_related_company.sql tests/unit/related-company-migration.test.ts lib/domain/company-export.ts
printf 'feat(banking): 0131 related company register\n\nOne row per related company: its name, the words its bank prints, and the\none account that carries what it owes or is owed. Staff write, viewers read,\naudited; exported with the company. Nothing existing changes.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: The pure rules — `lib/domain/related-companies.ts`

**Files:**
- Create: `lib/domain/related-companies.ts`
- Create: `tests/unit/related-companies.test.ts`

**Interfaces:**
- Consumes: `phrasesOf(words): string[]` and `type RepaymentLine = { description: string; amountMinor: number; inBaseCurrency: boolean }` from `./repayments.ts`; `wordPattern(text): RegExp` from `./bank-rules.ts`; `codableAccount(account): boolean` and `type CodingAccount` from `./coding.ts`.
- Produces (all exported):
  - `interface RelatedCompany { id: string; name: string; accountId: string; matchWords: string; isActive: boolean }`
  - `type RelatedCompanyInput = Omit<RelatedCompany, "id">`
  - `RELATED_NAME_MAX = 120`, `RELATED_WORDS_MAX = 200`, `RELATED_PHRASE_MIN = 2`
  - `seedRelatedWords(name: string): string`
  - `relatedAccountAllowed(account: CodingAccount | undefined): boolean`
  - `usableRelated(company: RelatedCompany, accounts: ReadonlyMap<string, CodingAccount>): boolean`
  - `relatedMatches(company: Pick<RelatedCompany, "matchWords">, description: string): boolean`
  - `relatedHits(companies: readonly RelatedCompany[], line: RepaymentLine, accounts: ReadonlyMap<string, CodingAccount>): RelatedCompany[]`
  - `validateRelatedInput(input: RelatedCompanyInput): string | null`
  - `relatedAccountProblem(account: CodingAccount | undefined, inCardsAndLoans: boolean): string | null`
  - `balanceWords(balanceMinor: number, money: (minor: number) => string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/related-companies.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  balanceWords,
  relatedAccountAllowed,
  relatedAccountProblem,
  relatedHits,
  relatedMatches,
  seedRelatedWords,
  usableRelated,
  validateRelatedInput,
  type RelatedCompany,
  type RelatedCompanyInput,
} from "@/lib/domain/related-companies";

const acct = (id: string, type: CodingAccount["type"], over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code: id.toUpperCase(),
  name: `Account ${id}`,
  type,
  active: true,
  posting: true,
  ...over,
});
const accounts = new Map(
  [
    acct("due", "current_asset", { name: "Due from/to Example Affiliate" }),
    acct("due2", "current_liability", { name: "Due to Other Affiliate" }),
    acct("ltl", "long_term_liability"),
    acct("rent", "expense"),
    acct("sales", "income"),
    acct("other-inc", "other_income"),
    acct("bank", "bank"),
    acct("ar", "accounts_receivable"),
    acct("card", "credit_card"),
    acct("held", "current_asset", { name: "Uncategorized Asset" }),
    acct("closed", "current_asset", { active: false }),
    acct("heading", "current_asset", { posting: false }),
  ].map((a) => [a.id, a]),
);
const company = (over: Partial<RelatedCompany> = {}): RelatedCompany => ({
  id: "rc1",
  name: "Example Affiliate, LLC",
  accountId: "due",
  matchWords: "example affiliate, exa",
  isActive: true,
  ...over,
});
const at = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });

describe("seedRelatedWords", () => {
  it("drops a trailing company suffix, with any comma before it", () => {
    expect(seedRelatedWords("Example Affiliate, LLC")).toBe("Example Affiliate");
    expect(seedRelatedWords("Example Affiliate L.L.C.")).toBe("Example Affiliate");
    expect(seedRelatedWords("Example Holdings Inc.")).toBe("Example Holdings");
    expect(seedRelatedWords("Example Trading Corp")).toBe("Example Trading");
    expect(seedRelatedWords("Example Trading Corporation")).toBe("Example Trading");
    expect(seedRelatedWords("Example Co.")).toBe("Example");
    expect(seedRelatedWords("Example Ltd")).toBe("Example");
  });
  it("keeps a name with no suffix, a suffix inside a word, and a name that is only a suffix", () => {
    expect(seedRelatedWords("  Example   Affiliate ")).toBe("Example Affiliate");
    expect(seedRelatedWords("Costco")).toBe("Costco");
    expect(seedRelatedWords("LLC")).toBe("LLC");
  });
});

describe("relatedAccountAllowed", () => {
  it("allows an active posting current asset, current liability or long-term liability", () => {
    for (const id of ["due", "due2", "ltl"]) expect(relatedAccountAllowed(accounts.get(id))).toBe(true);
  });
  it("refuses income, expense, bank, receivable, card, holding, inactive, heading and missing accounts", () => {
    for (const id of ["rent", "sales", "other-inc", "bank", "ar", "card", "held", "closed", "heading", "nope"]) {
      expect(relatedAccountAllowed(accounts.get(id)), id).toBe(false);
    }
  });
});

describe("usableRelated", () => {
  it("speaks only when switched on and its account is still allowed", () => {
    expect(usableRelated(company(), accounts)).toBe(true);
    expect(usableRelated(company({ isActive: false }), accounts)).toBe(false);
    expect(usableRelated(company({ accountId: "rent" }), accounts)).toBe(false);
  });
});

describe("relatedMatches", () => {
  it("matches any phrase as whole words, in any case", () => {
    expect(relatedMatches(company(), "WIRE TO EXAMPLE AFFILIATE LLC")).toBe(true);
    expect(relatedMatches(company(), "Online transfer to EXA ref 12")).toBe(true);
    expect(relatedMatches(company(), "exa-0042")).toBe(true);
  });
  it("never matches a short phrase inside a longer word", () => {
    expect(relatedMatches(company({ matchWords: "ab" }), "TAB PAYMENT")).toBe(false);
    expect(relatedMatches(company({ matchWords: "ab" }), "ABC SUPPLY")).toBe(false);
    expect(relatedMatches(company({ matchWords: "ab" }), "WIRE TO AB")).toBe(true);
    expect(relatedMatches(company(), "EXAMPLE SUPPLY")).toBe(false);
  });
});

describe("relatedHits", () => {
  it("finds a company named on money out and on money in", () => {
    expect(relatedHits([company()], at("WIRE TO EXA"), accounts)).toEqual([company()]);
    expect(relatedHits([company()], at("WIRE FROM EXA", 50000), accounts)).toEqual([company()]);
  });
  it("ignores a zero line, a foreign-currency bank, a company switched off and an unusable account", () => {
    expect(relatedHits([company()], at("WIRE TO EXA", 0), accounts)).toEqual([]);
    expect(relatedHits([company()], { ...at("WIRE TO EXA"), inBaseCurrency: false }, accounts)).toEqual([]);
    expect(relatedHits([company({ isActive: false })], at("WIRE TO EXA"), accounts)).toEqual([]);
    expect(relatedHits([company({ accountId: "closed" })], at("WIRE TO EXA"), accounts)).toEqual([]);
  });
  it("returns every company a line names", () => {
    const other = company({ id: "rc2", name: "Other Affiliate", accountId: "due2", matchWords: "affiliate" });
    expect(relatedHits([company(), other], at("WIRE TO EXAMPLE AFFILIATE"), accounts)).toEqual([company(), other]);
    expect(relatedHits([company(), other], at("METRO REALTY RENT"), accounts)).toEqual([]);
  });
});

describe("validateRelatedInput", () => {
  const input = (over: Partial<RelatedCompanyInput> = {}): RelatedCompanyInput => ({
    name: "Example Affiliate, LLC",
    accountId: "due",
    matchWords: "example affiliate, exa",
    isActive: true,
    ...over,
  });
  it("accepts a company with a name, an account and words of two characters or more", () => {
    expect(validateRelatedInput(input())).toBeNull();
    expect(validateRelatedInput(input({ matchWords: "AB" }))).toBeNull();
  });
  it("needs a name of at most 120 characters", () => {
    expect(validateRelatedInput(input({ name: "   " }))).toBe("Give the company's name");
    expect(validateRelatedInput(input({ name: "x".repeat(121) }))).toBe("The name is at most 120 characters");
    expect(validateRelatedInput(input({ name: ` ${"x".repeat(120)} ` }))).toBeNull();
  });
  it("needs an account", () => {
    expect(validateRelatedInput(input({ accountId: "" }))).toBe("Choose the account it owes or is owed on");
  });
  it("needs words, at most 200 characters, every phrase at least two characters", () => {
    expect(validateRelatedInput(input({ matchWords: " , " }))).toBe("Give the words your bank prints for this company");
    expect(validateRelatedInput(input({ matchWords: "x".repeat(201) }))).toBe("Words are at most 200 characters");
    expect(validateRelatedInput(input({ matchWords: "example affiliate, e" }))).toBe(
      '"e" is too short — each word or phrase is at least 2 characters',
    );
  });
});

describe("relatedAccountProblem", () => {
  it("refuses an account of the wrong kind, then one already in Cards and loans", () => {
    expect(relatedAccountProblem(accounts.get("rent"), false)).toBe(
      "A related company's account is an active posting current asset, current liability or long-term liability",
    );
    expect(relatedAccountProblem(accounts.get("ltl"), true)).toBe(
      "This account is in Cards and loans — a related company needs an account of its own",
    );
    expect(relatedAccountProblem(accounts.get("due"), false)).toBeNull();
  });
});

describe("balanceWords", () => {
  const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
  it("says who owes whom, or that nothing is owed", () => {
    expect(balanceWords(114025, money)).toBe("Owes us $1140.25");
    expect(balanceWords(-300000, money)).toBe("We owe $3000.00");
    expect(balanceWords(0, money)).toBe("Settled");
  });
});

describe("the related-companies module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/related-companies.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/related-companies.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/related-companies"`.

- [ ] **Step 3: Write the module**

Create `lib/domain/related-companies.ts`:

```ts
/**
 * Related companies: money between companies the same owners run.
 *
 * Money sent to a sister company is a loan to it, and money received from one
 * is a loan from it — never income or a cost. Coded singly in each book, the
 * same movement becomes income in one and a cost in the other. Each company
 * lists its related companies with the words its bank prints for them and the
 * one account that carries what each owes or is owed: money out debits it,
 * money in credits it, and the sign of its balance says who owes whom. A
 * waiting line naming one, in or out, is weighed with the cards and loans
 * (register-claim.ts) before any rule or history.
 *
 * Imported by scripts/*.mjs: relative imports only.
 */
import type { AccountType } from "./accounts.ts";
import { wordPattern } from "./bank-rules.ts";
import { codableAccount, type CodingAccount } from "./coding.ts";
import { phrasesOf, type RepaymentLine } from "./repayments.ts";

export interface RelatedCompany {
  id: string;
  name: string;
  /** The one account that carries what this company owes or is owed. */
  accountId: string;
  /** Phrases the bank prints, comma-separated: "example affiliate, exa". */
  matchWords: string;
  isActive: boolean;
}

export type RelatedCompanyInput = Omit<RelatedCompany, "id">;

export const RELATED_NAME_MAX = 120;
export const RELATED_WORDS_MAX = 200;
/** Two letters can name a company on a statement; one names nothing. */
export const RELATED_PHRASE_MIN = 2;
const RELATED_ACCOUNT_TYPES: readonly AccountType[] = ["current_asset", "current_liability", "long_term_liability"];
const COMPANY_SUFFIX = /[\s,]+(?:l\.?l\.?c\.?|inc\.?|corp\.?|corporation|co\.?|ltd\.?)$/i;

/** "Example Affiliate, LLC" → "Example Affiliate": the name without its company suffix. */
export function seedRelatedWords(name: string): string {
  const squeezed = name.trim().replace(/\s+/g, " ");
  return squeezed.replace(COMPANY_SUFFIX, "").trim() || squeezed;
}

/** Whether an account can carry what a related company owes or is owed. */
export function relatedAccountAllowed(account: CodingAccount | undefined): boolean {
  return Boolean(account && codableAccount(account) && RELATED_ACCOUNT_TYPES.includes(account.type));
}

/** An entry that can speak: switched on, and its account still one it may use. */
export function usableRelated(company: RelatedCompany, accounts: ReadonlyMap<string, CodingAccount>): boolean {
  return company.isActive && relatedAccountAllowed(accounts.get(company.accountId));
}

/** Whether a description carries one of the company's phrases, each as whole words, in any case. */
export function relatedMatches(company: Pick<RelatedCompany, "matchWords">, description: string): boolean {
  return phrasesOf(company.matchWords).some((phrase) => wordPattern(phrase).test(description));
}

/** Every usable related company a waiting line names — money in or out, on a bank in the base currency. */
export function relatedHits(
  companies: readonly RelatedCompany[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RelatedCompany[] {
  if (line.amountMinor === 0 || !line.inBaseCurrency) return [];
  return companies.filter((company) => usableRelated(company, accounts) && relatedMatches(company, line.description));
}

/**
 * What is wrong with a company as typed, or null. Whether its account is of
 * the right kind is checked against the chart by the service.
 */
export function validateRelatedInput(input: RelatedCompanyInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give the company's name";
  if (name.length > RELATED_NAME_MAX) return `The name is at most ${RELATED_NAME_MAX} characters`;
  if (!input.accountId) return "Choose the account it owes or is owed on";
  if (input.matchWords.length > RELATED_WORDS_MAX) return `Words are at most ${RELATED_WORDS_MAX} characters`;
  const phrases = phrasesOf(input.matchWords);
  if (phrases.length === 0) return "Give the words your bank prints for this company";
  const short = phrases.find((phrase) => phrase.length < RELATED_PHRASE_MIN);
  if (short) return `"${short}" is too short — each word or phrase is at least ${RELATED_PHRASE_MIN} characters`;
  return null;
}

/** What is wrong with this account for a related company, or null. */
export function relatedAccountProblem(account: CodingAccount | undefined, inCardsAndLoans: boolean): string | null {
  if (!relatedAccountAllowed(account)) {
    return "A related company's account is an active posting current asset, current liability or long-term liability";
  }
  if (inCardsAndLoans) return "This account is in Cards and loans — a related company needs an account of its own";
  return null;
}

/** "Owes us $1,140.25", "We owe $3,000.00" or "Settled": a debit-less-credit balance as the person reads it. */
export function balanceWords(balanceMinor: number, money: (minor: number) => string): string {
  if (balanceMinor > 0) return `Owes us ${money(balanceMinor)}`;
  if (balanceMinor < 0) return `We owe ${money(-balanceMinor)}`;
  return "Settled";
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/related-companies.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/related-companies.ts tests/unit/related-companies.test.ts
printf 'feat(banking): related companies, the pure rules\n\nWhich related companies a waiting line names, in or out, as whole words;\nwhich accounts may carry what one owes or is owed; the default words from\nits name; validation; and the balance read as Owes us / We owe / Settled.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: One claim over cards, loans and related companies

**Files:**
- Modify: `lib/domain/repayments.ts` (`repaymentFor`, lines 108–118)
- Create: `lib/domain/register-claim.ts`
- Create: `tests/unit/register-claim.test.ts`
- Modify: `tests/unit/repayments.test.ts` (add a `repaymentHits` block)
- Modify: `lib/services/repayment-register.ts`

**Interfaces:**
- Consumes: from Task 2, `relatedHits`, `type RelatedCompany`.
- Produces:
  - in `repayments.ts`: `repaymentHits(entries: readonly RepaymentAccount[], line: RepaymentLine, accounts: ReadonlyMap<string, CodingAccount>): RepaymentAccount[]`. `repaymentFor` stays for now, built on it; Task 5 removes it.
  - in `register-claim.ts`:
    - `type RegisterClaim = { kind: "repayment"; entry: RepaymentAccount } | { kind: "related"; company: RelatedCompany } | { kind: "rivals"; labels: string[] }`
    - `registerClaim(input: { repayments: readonly RepaymentAccount[]; related: readonly RelatedCompany[]; line: RepaymentLine; accounts: ReadonlyMap<string, CodingAccount> }): RegisterClaim | null`
    - `rivalsWhy(labels: readonly string[]): string`
  - in `lib/services/repayment-register.ts`: `relatedFromRow(row): RelatedCompany`, `listRelatedCompanies(sb): Promise<RelatedCompany[]>`, and `RepaymentContext` gains `related: RelatedCompany[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/register-claim.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import { registerClaim, rivalsWhy } from "@/lib/domain/register-claim";
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { RepaymentAccount } from "@/lib/domain/repayments";

const acct = (id: string, code: string, name: string, type: CodingAccount["type"]): CodingAccount => ({
  id,
  code,
  name,
  type,
  active: true,
  posting: true,
});
const accounts = new Map(
  [
    acct("card1", "2050", "Example Card", "credit_card"),
    acct("card2", "2060", "Other Card", "credit_card"),
    acct("due", "1460", "Due from/to Example Affiliate", "current_asset"),
    acct("due2", "2460", "Due to Other Affiliate", "current_liability"),
  ].map((a) => [a.id, a]),
);
const card = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "rp1",
  kind: "card",
  accountId: "card1",
  matchWords: "example card",
  matchDigits: null,
  interestAccountId: null,
  interestMethod: null,
  annualRate: null,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const company = (over: Partial<RelatedCompany> = {}): RelatedCompany => ({
  id: "rc1",
  name: "Example Affiliate",
  accountId: "due",
  matchWords: "example affiliate",
  isActive: true,
  ...over,
});
const line = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });
const claim = (repayments: RepaymentAccount[], related: RelatedCompany[], description: string, amountMinor?: number) =>
  registerClaim({ repayments, related, line: line(description, amountMinor), accounts });

describe("registerClaim", () => {
  it("gives the one card a payment out repays", () => {
    expect(claim([card()], [company()], "EXAMPLE CARD EPAY")).toEqual({ kind: "repayment", entry: card() });
  });
  it("gives the one related company a line names, out or in", () => {
    expect(claim([card()], [company()], "WIRE TO EXAMPLE AFFILIATE")).toEqual({ kind: "related", company: company() });
    expect(claim([card()], [company()], "WIRE FROM EXAMPLE AFFILIATE", 50000)).toEqual({ kind: "related", company: company() });
  });
  it("never lets a card claim money in", () => {
    expect(claim([card()], [], "EXAMPLE CARD REFUND", 50000)).toBeNull();
  });
  it("names every claimant when more than one claims the line, related companies first", () => {
    const both = "EXAMPLE CARD PAID BY EXAMPLE AFFILIATE";
    expect(claim([card()], [company()], both)).toEqual({ kind: "rivals", labels: ["Example Affiliate", "2050 Example Card"] });
    const other = company({ id: "rc2", name: "Other Affiliate", accountId: "due2", matchWords: "affiliate" });
    expect(claim([], [company(), other], "WIRE TO EXAMPLE AFFILIATE")).toEqual({
      kind: "rivals",
      labels: ["Example Affiliate", "Other Affiliate"],
    });
    const second = card({ id: "rp2", accountId: "card2", matchWords: "card epay" });
    expect(claim([card(), second], [], "EXAMPLE CARD EPAY")).toEqual({ kind: "rivals", labels: ["2050 Example Card", "2060 Other Card"] });
  });
  it("says nothing when nothing claims the line, or the bank is not in the base currency", () => {
    expect(claim([card()], [company()], "METRO REALTY RENT")).toBeNull();
    expect(
      registerClaim({ repayments: [card()], related: [company()], line: { ...line("WIRE TO EXAMPLE AFFILIATE"), inBaseCurrency: false }, accounts }),
    ).toBeNull();
  });
});

describe("rivalsWhy", () => {
  it("names two, and past two says how many more", () => {
    expect(rivalsWhy(["Example Affiliate", "2050 Example Card"])).toBe("Matches Example Affiliate and 2050 Example Card — code it yourself");
    expect(rivalsWhy(["A", "B", "C"])).toBe("Matches A, B and 1 more — code it yourself");
    expect(rivalsWhy(["A", "B", "C", "D"])).toBe("Matches A, B and 2 more — code it yourself");
  });
});

describe("the register-claim module", () => {
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/register-claim.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
```

In `tests/unit/repayments.test.ts`, add `repaymentHits,` to the import list from `@/lib/domain/repayments` (alphabetically after `repaymentFor,`), and add this block directly after the closing `});` of `describe("repaymentFor", …)`:

```ts
describe("repaymentHits", () => {
  it("returns every usable entry a payment out carries, and none for money in or a foreign-currency bank", () => {
    const other = card({ id: "r2", accountId: "card2", matchDigits: null });
    expect(repaymentHits([card(), other], out("EXAMPLE CARD EPAY"), accounts)).toEqual([card(), other]);
    expect(repaymentHits([card()], out("EXAMPLE CARD REFUND", 50000), accounts)).toEqual([]);
    expect(repaymentHits([card()], { ...out("EXAMPLE CARD EPAY"), inBaseCurrency: false }, accounts)).toEqual([]);
    expect(repaymentHits([card({ isActive: false })], out("EXAMPLE CARD EPAY"), accounts)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/register-claim.test.ts tests/unit/repayments.test.ts`
Expected: FAIL — `register-claim` does not resolve, and `repaymentHits is not a function`.

- [ ] **Step 3: `repaymentHits` in `lib/domain/repayments.ts`**

Replace the whole `repaymentFor` function (the doc comment line `/** The one entry a waiting payment out repays, … */` and the function below it) with:

```ts
/** Every usable entry a waiting payment out carries: its words or last four, on a bank in the base currency. */
export function repaymentHits(
  entries: readonly RepaymentAccount[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RepaymentAccount[] {
  if (line.amountMinor >= 0 || !line.inBaseCurrency) return [];
  return entries.filter((entry) => usableRepayment(entry, accounts) && repaymentMatches(entry, line.description));
}

/** The one entry a waiting payment out repays, how many claim it when several do, or nothing. */
export function repaymentFor(
  entries: readonly RepaymentAccount[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RepaymentFact | null {
  const hits = repaymentHits(entries, line, accounts);
  if (hits.length === 0) return null;
  return hits.length === 1 ? { kind: "one", entry: hits[0] } : { kind: "rivals", count: hits.length };
}
```

- [ ] **Step 4: Create `lib/domain/register-claim.ts`**

```ts
/**
 * What the person registered about a waiting line's other side: a card or a
 * loan it repays (repayments.ts), or a related company it names
 * (related-companies.ts). Both are weighed together, before any rule or
 * history, and the rule is the same for both — one claimant or nothing. A line
 * two claim gets no proposal at all, and says which, the way two open invoices
 * of one amount get none.
 *
 * Imported by scripts/*.mjs: relative imports only.
 */
import type { CodingAccount } from "./coding.ts";
import { relatedHits, type RelatedCompany } from "./related-companies.ts";
import { repaymentHits, type RepaymentAccount, type RepaymentLine } from "./repayments.ts";

export type RegisterClaim =
  | { kind: "repayment"; entry: RepaymentAccount }
  | { kind: "related"; company: RelatedCompany }
  | { kind: "rivals"; labels: string[] };

/** The one card, loan or related company that claims a waiting line; every claimant's label when several do; or nothing. */
export function registerClaim(input: {
  repayments: readonly RepaymentAccount[];
  related: readonly RelatedCompany[];
  line: RepaymentLine;
  accounts: ReadonlyMap<string, CodingAccount>;
}): RegisterClaim | null {
  const { line, accounts } = input;
  const repayments = repaymentHits(input.repayments, line, accounts);
  const related = relatedHits(input.related, line, accounts);
  const count = repayments.length + related.length;
  if (count === 0) return null;
  if (count === 1) {
    return repayments.length ? { kind: "repayment", entry: repayments[0] } : { kind: "related", company: related[0] };
  }
  const accountLabel = (id: string) => {
    const account = accounts.get(id);
    return account ? `${account.code} ${account.name}` : "an account not found";
  };
  return {
    kind: "rivals",
    labels: [...related.map((company) => company.name), ...repayments.map((entry) => accountLabel(entry.accountId))],
  };
}

/** "Matches Example Affiliate and 2050 Example Card — code it yourself"; past two, "and N more". */
export function rivalsWhy(labels: readonly string[]): string {
  const named = labels.length <= 2 ? labels.join(" and ") : `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
  return `Matches ${named} — code it yourself`;
}
```

- [ ] **Step 5: Read the related companies in `lib/services/repayment-register.ts`**

Replace the file's doc comment and add the reading. The whole file becomes:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { InterestMethod, RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { listBankAccounts } from "./banking";
import { readAllPages } from "./paging";

/**
 * Reading the register — cards and loans (migration 0129) and related
 * companies (0131) — and the facts recognition needs beside it. Writing lives
 * in repayments.ts and related-companies.ts; this module is kept free of them
 * so coding.ts can use it.
 */
export class RepaymentError extends Error {}
const fail = (message: string) => new RepaymentError(message);

const COLUMNS =
  "id,kind,account_id,match_words,match_digits,interest_account_id,interest_method,annual_rate,fixed_interest_minor,is_active";
const RELATED_COLUMNS = "id,name,account_id,match_words,is_active";
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export function repaymentFromRow(row: Record<string, unknown>): RepaymentAccount {
  return {
    id: row.id as string,
    kind: row.kind as RepaymentKind,
    accountId: row.account_id as string,
    matchWords: (row.match_words as string | null) ?? "",
    matchDigits: (row.match_digits as string | null) ?? null,
    interestAccountId: (row.interest_account_id as string | null) ?? null,
    interestMethod: (row.interest_method as InterestMethod | null) ?? null,
    annualRate: numberOrNull(row.annual_rate),
    fixedInterestMinor: numberOrNull(row.fixed_interest_minor),
    isActive: Boolean(row.is_active),
  };
}

export async function listRepayments(sb: SupabaseClient): Promise<RepaymentAccount[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_repayment_account").select(COLUMNS).order("created_at").order("id").range(from, to),
    fail,
  );
  return rows.map(repaymentFromRow);
}

export function relatedFromRow(row: Record<string, unknown>): RelatedCompany {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    accountId: row.account_id as string,
    matchWords: (row.match_words as string | null) ?? "",
    isActive: Boolean(row.is_active),
  };
}

/** Every related company, by name. */
export async function listRelatedCompanies(sb: SupabaseClient): Promise<RelatedCompany[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_related_company").select(RELATED_COLUMNS).order("name").order("id").range(from, to),
    fail,
  );
  return rows.map(relatedFromRow);
}

export interface RepaymentContext {
  repayments: RepaymentAccount[];
  related: RelatedCompany[];
  /** Bank accounts in the base currency: only their lines can be claimed by the register. */
  baseCurrencyBankIds: Set<string>;
}

/** Bank accounts in the base currency: only their lines can be claimed by the register. */
export async function baseCurrencyBankIds(sb: SupabaseClient): Promise<Set<string>> {
  const [banks, base] = await Promise.all([
    listBankAccounts(sb),
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
  ]);
  if (base.error) throw fail(base.error.message);
  const code = (base.data as { code: string } | null)?.code ?? null;
  return new Set(banks.filter((bank) => code !== null && bank.currency_code === code).map((bank) => bank.id));
}

export async function repaymentContext(sb: SupabaseClient): Promise<RepaymentContext> {
  const [repayments, related, ids] = await Promise.all([listRepayments(sb), listRelatedCompanies(sb), baseCurrencyBankIds(sb)]);
  return { repayments, related, baseCurrencyBankIds: ids };
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/register-claim.test.ts tests/unit/repayments.test.ts tests/unit/related-companies.test.ts`
Expected: PASS, 0 failed.
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/repayments.ts lib/domain/register-claim.ts tests/unit/register-claim.test.ts tests/unit/repayments.test.ts lib/services/repayment-register.ts
printf 'feat(banking): one register claim over cards, loans and related companies\n\nA line claimed by one card, loan or related company is that one'"'"'s; claimed\nby several, it gets no proposal and names them. The register read now\nincludes the related companies.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: The `related` suggestion in `suggestCoding`

**Files:**
- Modify: `lib/domain/coding.ts` (header comment lines 1–15; import line 20; `CodingSuggestion` lines 73–76; `suggestCoding` lines 78–117; `CodingSuggestionView.source` line 125; `codingView` lines 133–144)
- Modify: `lib/services/coding.ts` (imports lines 21–24; `CodingInputs` lines 84–95; `suggestionsFrom` lines 100–127; `codingSuggestions` lines 129–144)
- Modify: `tests/unit/coding.test.ts` (the `describe("suggestCoding with cards and loans", …)` block, lines 103–141)
- Modify: `tests/unit/coding-service.test.ts` (the `describe("suggestionsFrom with the register", …)` block, lines 85–113)

**Interfaces:**
- Consumes: from Task 3, `type RegisterClaim`, `registerClaim(...)`; from Task 2, `type RelatedCompany`.
- Produces:
  - `CodingSuggestion` gains `{ source: "related"; accountId: string; relatedId: string; companyName: string }`.
  - `suggestCoding` input: `claim?: RegisterClaim | null` replaces `repayment?: RepaymentFact | null`.
  - `CodingSuggestionView.source` is `"rule" | "history" | "card" | "related"`.
  - `CodingInputs` gains `related?: readonly RelatedCompany[]`.

- [ ] **Step 1: Change the tests first**

In `tests/unit/coding.test.ts`, replace the import line `import type { RepaymentAccount } from "@/lib/domain/repayments";` with:

```ts
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { RepaymentAccount } from "@/lib/domain/repayments";
```

Replace the whole `describe("suggestCoding with cards and loans", …)` block with:

```ts
describe("suggestCoding with the register", () => {
  const withRegister = new Map<string, CodingAccount>([
    ...accounts,
    ["card1", account("card1", { type: "credit_card", name: "Example Card" })],
    ["due", account("due", { type: "current_asset", name: "Due from/to Example Affiliate" })],
  ]);
  const entry = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
    id: "rp1",
    kind: "card",
    accountId: "card1",
    matchWords: "metro",
    matchDigits: null,
    interestAccountId: null,
    interestMethod: null,
    annualRate: null,
    fixedInterestMinor: null,
    isActive: true,
    ...over,
  });
  const company: RelatedCompany = { id: "rc1", name: "Example Affiliate", accountId: "due", matchWords: "metro", isActive: true };
  const ask = (claim: Parameters<typeof suggestCoding>[0]["claim"], hasMatch = false) =>
    suggestCoding({ line, rules: [rule({})], index: history, accounts: withRegister, hasMatch, claim });

  it("puts a card ahead of a rule and of history", () => {
    expect(ask({ kind: "repayment", entry: entry() })).toEqual({ source: "card", accountId: "card1", repaymentId: "rp1" });
  });
  it("puts a related company ahead of a rule and of history", () => {
    expect(ask({ kind: "related", company })).toEqual({
      source: "related",
      accountId: "due",
      relatedId: "rc1",
      companyName: "Example Affiliate",
    });
  });
  it("lets a loan, or rivals, silence rule and history", () => {
    const loan = entry({ kind: "loan", interestAccountId: "rent", interestMethod: "entered" });
    expect(ask({ kind: "repayment", entry: loan })).toBeNull();
    expect(ask({ kind: "rivals", labels: ["Example Affiliate", "CARD1 Example Card"] })).toBeNull();
  });
  it("still says nothing on a line that already has a match to the ledger", () => {
    expect(ask({ kind: "repayment", entry: entry() }, true)).toBeNull();
    expect(ask({ kind: "related", company }, true)).toBeNull();
  });
  it("says nothing for a related company whose account can no longer take the line", () => {
    expect(ask({ kind: "related", company: { ...company, accountId: "old" } })).toBeNull();
  });
  it("says why in the screen's words", () => {
    expect(codingView(line, { source: "card", accountId: "card1", repaymentId: "rp1" }, withRegister.get("card1")!)).toEqual({
      transactionId: "t1",
      accountId: "card1",
      accountLabel: "CARD1 — Example Card",
      source: "card",
      short: "Card",
      why: "Card payment — repays CARD1 Example Card. A card payment is never an expense.",
    });
    const related = codingView(
      line,
      { source: "related", accountId: "due", relatedId: "rc1", companyName: "Example Affiliate" },
      withRegister.get("due")!,
    );
    expect(related).toEqual({
      transactionId: "t1",
      accountId: "due",
      accountLabel: "DUE — Due from/to Example Affiliate",
      source: "related",
      short: "Related",
      why: "Names Example Affiliate, a related company. Money between your companies is owed, never income or a cost.",
    });
  });
});
```

In `tests/unit/coding-service.test.ts`, add the related companies to the register block. Replace the whole `describe("suggestionsFrom with the register", …)` block with:

```ts
describe("suggestionsFrom with the register", () => {
  const card = {
    id: "rp1",
    kind: "card" as const,
    accountId: "card1",
    matchWords: "metro",
    matchDigits: null,
    interestAccountId: null,
    interestMethod: null,
    annualRate: null,
    fixedInterestMinor: null,
    isActive: true,
  };
  const company = { id: "rc1", name: "Example Affiliate", accountId: "due", matchWords: "example affiliate", isActive: true };
  const chart = [
    acct("rent", "Rent"),
    acct("card1", "Example Card", { account_type: "credit_card" }),
    acct("due", "Due from/to Example Affiliate", { account_type: "current_asset" }),
  ];
  const line = txn("t1", "Metro Realty Partners", -420000, { bank_account_id: "bank1" });
  const base = new Set(["bank1"]);
  it("proposes the card ahead of history, on a bank in the base currency", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: base }));
    expect(views[0]).toMatchObject({ accountId: "card1", source: "card", short: "Card" });
  });
  it("leaves a line on a foreign-currency bank to history", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: new Set() }));
    expect(views[0]).toMatchObject({ accountId: "rent", source: "history" });
  });
  it("gives no suggestion when two entries claim the line", () => {
    const other = { ...card, id: "rp2", accountId: "card2" };
    const twoCards = [...chart, acct("card2", "Other Card", { account_type: "credit_card" })];
    expect(suggestionsFrom(inputs({ lines: [line], accounts: twoCards, repayments: [card, other], baseCurrencyBankIds: base }))).toEqual([]);
  });
  it("proposes a related company named on money in, ahead of history", () => {
    const wire = txn("t2", "WIRE FROM EXAMPLE AFFILIATE", 1500000, { bank_account_id: "bank1" });
    const views = suggestionsFrom(inputs({ lines: [wire], accounts: chart, related: [company], baseCurrencyBankIds: base }));
    expect(views).toEqual([
      expect.objectContaining({ transactionId: "t2", accountId: "due", source: "related", short: "Related" }),
    ]);
  });
  it("gives no suggestion when a related company and a card both claim the line", () => {
    const both = txn("t3", "METRO CARD PAID FOR EXAMPLE AFFILIATE", -50000, { bank_account_id: "bank1" });
    expect(
      suggestionsFrom(inputs({ lines: [both], accounts: chart, repayments: [card], related: [company], baseCurrencyBankIds: base })),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/coding.test.ts tests/unit/coding-service.test.ts`
Expected: FAIL — typecheck-level errors surface as failures: `claim` is not a known input and the `related` source is missing (for example `expected null to deeply equal { source: 'related', … }`).

- [ ] **Step 3: Change `lib/domain/coding.ts`**

Replace the header comment (lines 1–15) with:

```ts
/**
 * The one suggestion a waiting bank line gets, and how the screen says it.
 *
 * In order: a line already matched to the ledger gets none (coding it would
 * post a second entry for money already in the books, and
 * acc_categorise_bank_transaction refuses it anyway); then what the person
 * registered (register-claim.ts) — a card it repays, or a related company it
 * names; a loan, or a line two of them claim, gets no single-account
 * suggestion at all; then the first rule that matches; then history; then
 * nothing. Only an account a line can properly be coded to is ever suggested —
 * active, posting, not receivable or payable (money from a customer or to a
 * supplier is settled against a document), not a holding account.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
```

Replace `import type { RepaymentFact } from "./repayments.ts";` with:

```ts
import type { RegisterClaim } from "./register-claim.ts";
```

Replace the `CodingSuggestion` type with:

```ts
export type CodingSuggestion =
  | { source: "card"; accountId: string; repaymentId: string }
  | { source: "related"; accountId: string; relatedId: string; companyName: string }
  | { source: "rule"; accountId: string; ruleId: string; ruleNumber: number; ruleText: string }
  | { source: "history"; accountId: string; hits: number; of: number; key: string };
```

In `suggestCoding`, replace the input field

```ts
  /** What the register says this line repays (repayments.ts), when it says anything. */
  repayment?: RepaymentFact | null;
```

with

```ts
  /** What the register says about this line (register-claim.ts), when it says anything. */
  claim?: RegisterClaim | null;
```

and replace the start of the body, from `const { line, rules, index, accounts, hasMatch, repayment } = input;` down to and including the closing `}` of the `if (repayment) { … }` block, with:

```ts
  const { line, rules, index, accounts, hasMatch, claim } = input;
  if (hasMatch) return null;
  const usable = (accountId: string) => codableAccount(accounts.get(accountId));

  // What the person registered outranks what is inferred. A loan's split, or a
  // line two entries claim, is not one account — rule and history stay silent.
  if (claim) {
    if (claim.kind === "repayment" && claim.entry.kind === "card" && usable(claim.entry.accountId)) {
      return { source: "card", accountId: claim.entry.accountId, repaymentId: claim.entry.id };
    }
    if (claim.kind === "related" && usable(claim.company.accountId)) {
      return {
        source: "related",
        accountId: claim.company.accountId,
        relatedId: claim.company.id,
        companyName: claim.company.name,
      };
    }
    return null;
  }
```

In `CodingSuggestionView`, change `source: "rule" | "history" | "card";` to:

```ts
  source: "rule" | "history" | "card" | "related";
```

In `codingView`, directly after the `if (suggestion.source === "card") { … }` block, add:

```ts
  if (suggestion.source === "related") {
    return {
      transactionId: line.id,
      accountId: suggestion.accountId,
      accountLabel,
      source: "related",
      short: "Related",
      why: `Names ${suggestion.companyName}, a related company. Money between your companies is owed, never income or a cost.`,
    };
  }
```

- [ ] **Step 4: Change `lib/services/coding.ts`**

Replace the import `import { repaymentFor, type RepaymentAccount } from "@/lib/domain/repayments";` with:

```ts
import { registerClaim } from "@/lib/domain/register-claim";
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { RepaymentAccount } from "@/lib/domain/repayments";
```

In `CodingInputs`, replace the two register fields and their comments with:

```ts
  /** The register of cards and loans (0129). */
  repayments?: readonly RepaymentAccount[];
  /** The register of related companies (0131). */
  related?: readonly RelatedCompany[];
  /** Bank accounts in the base currency; a line elsewhere is never claimed by the register. */
  baseCurrencyBankIds?: ReadonlySet<string>;
```

In `suggestionsFrom`, replace the `const repayment = …;` statement and the `const suggestion = suggestCoding(…)` line with:

```ts
    const registered = Boolean(inputs.repayments?.length || inputs.related?.length);
    const claim = registered
      ? registerClaim({
          repayments: inputs.repayments ?? [],
          related: inputs.related ?? [],
          line: {
            description: line.description,
            amountMinor: line.amountMinor,
            inBaseCurrency: inputs.baseCurrencyBankIds?.has(row.bank_account_id) ?? false,
          },
          accounts,
        })
      : null;
    const suggestion = suggestCoding({ line, rules: inputs.rules, index, accounts, hasMatch: inputs.matchedLineIds.has(row.id), claim });
```

In `codingSuggestions`, after `repayments: context.repayments,` add:

```ts
    related: context.related,
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/coding.test.ts tests/unit/coding-service.test.ts`
Expected: PASS, 0 failed.
Run: `npm run typecheck`
Expected: 0 errors. (`repaymentFor` is still used by `lib/services/statement-review.ts` and `lib/domain/loan-interest.ts`; Task 5 moves them.)

- [ ] **Step 6: Commit**

```bash
git add lib/domain/coding.ts lib/services/coding.ts tests/unit/coding.test.ts tests/unit/coding-service.test.ts
printf 'feat(banking): suggest a related company ahead of rules and history\n\nA waiting line naming one related company, in or out, is suggested to its\naccount with the short label Related; a line the register claims twice gets\nno suggestion. Card suggestions read the same register claim.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Review import and loans read the claim

**Files:**
- Modify: `lib/domain/statement-review.ts` (header comment lines 1–20; `ReviewProposal` line 56; `reviewProposal` lines 60–141)
- Modify: `lib/domain/loan-interest.ts` (import line 14; `loanSuggestionsFrom` lines 161–182)
- Modify: `lib/domain/repayments.ts` (remove `RepaymentFact` and `repaymentFor`)
- Modify: `lib/services/statement-review.ts` (import line 13; the `suggestionsFrom` call lines 182–192; `repaymentRivalsOf` lines 274–284; the `loanSuggestionsFrom` call lines 286–303; the `reviewProposal` call line 332)
- Modify: `lib/services/loan-payments.ts` (the `loanSuggestionsFrom` call lines 63–77)
- Modify: `tests/unit/statement-review-cards.test.ts`, `tests/unit/statement-review-loans.test.ts`, `tests/unit/loan-interest.test.ts`, `tests/unit/repayments.test.ts`
- Create: `tests/unit/statement-review-related.test.ts`

**Interfaces:**
- Consumes: from Task 3, `registerClaim`, `rivalsWhy`; from Task 4, the `related` source on `CodingSuggestionView`; `RepaymentContext.related`.
- Produces:
  - `reviewProposal` input `registerRivals?: readonly string[]` replaces `repaymentRivals?: number`.
  - `ReviewProposal` account variant gains `related?: true`.
  - `loanSuggestionsFrom` input gains `related?: readonly RelatedCompany[]`.
  - `repaymentFor` and `RepaymentFact` no longer exist.

- [ ] **Step 1: Change and add the tests**

In `tests/unit/statement-review-cards.test.ts`, replace the four tests that pass `repaymentRivals` — "refuses to choose when two cards or loans claim the line", "lets a document and a named transfer speak before the refusal", "does not refuse on zero or one repayment rival" and "lets a transfer pair outrank two repayment rivals" — with:

```ts
  it("refuses to choose when two claim the line, and names them", () => {
    expect(
      reviewProposal({ line, match: null, documents: [], coding: null, registerRivals: ["2050 Example Card", "2060 Other Card"] }),
    ).toEqual({ kind: "none", why: "Matches 2050 Example Card and 2060 Other Card — code it yourself" });
  });
  it("lets a document and a named transfer speak before the refusal", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 50000, currencyCode: "USD", direction: "payable" as const };
    const rivals = ["2050 Example Card", "2060 Other Card"];
    expect(reviewProposal({ line, match: null, documents: [doc], coding: null, registerRivals: rivals }).kind).toBe("document");
    const named = { accountId: "acct-savings", label: "Transfer to Sample Savings · 1020", why: "Reads as a transfer…" };
    expect(reviewProposal({ line, match: null, documents: [], coding: null, namedTransfer: named, registerRivals: rivals }).kind).toBe("account");
  });
  it("does not refuse on no rival or one", () => {
    for (const registerRivals of [[], ["2050 Example Card"]]) {
      const withCard = reviewProposal({ line, match: null, documents: [], coding: card, registerRivals });
      expect(withCard).toEqual({ kind: "account", accountId: "acct-card", label: "Card payment · 2050 — Example Card", why: card.why, repayment: "card" });
      const withoutCoding = reviewProposal({ line, match: null, documents: [], coding: null, registerRivals });
      expect(withoutCoding).toEqual({ kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" });
    }
  });
  it("lets a transfer pair outrank rivals", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: null, pair: transfer, registerRivals: ["2050 Example Card", "2060 Other Card"] });
    expect(p).toEqual({ kind: "transfer", counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "…" });
  });
```

In `tests/unit/statement-review-loans.test.ts`, change

```ts
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, repaymentRivals: 2 }).kind).toBe("none");
```

to

```ts
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, registerRivals: ["2500 Example Loan", "Example Affiliate"] }).kind).toBe("none");
```

Create `tests/unit/statement-review-related.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const out = { id: "t1", status: "unmatched", pending: false, amountMinor: -1_500_000, currencyCode: "USD" };
const into = { ...out, amountMinor: 1_500_000 };
const related: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-due",
  accountLabel: "1460 — Due from/to Example Affiliate",
  source: "related",
  short: "Related",
  why: "Names Example Affiliate, a related company. Money between your companies is owed, never income or a cost.",
};
const funding = {
  kind: "funding" as const,
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by …",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};

describe("reviewProposal with a related company", () => {
  it("labels money out or in as between companies, marks it, and ticks it", () => {
    for (const line of [out, into]) {
      const p = reviewProposal({ line, match: null, documents: [], coding: related });
      expect(p).toEqual({
        kind: "account",
        accountId: "acct-due",
        label: "Between companies · 1460 — Due from/to Example Affiliate",
        why: related.why,
        related: true,
      });
      expect(startsTicked(p)).toBe(true);
    }
  });
  it("keeps a funding pair beside it as the second choice", () => {
    expect(reviewProposal({ line: out, match: null, documents: [], coding: related, pair: funding })).toMatchObject({
      kind: "account",
      related: true,
      alternative: funding,
    });
  });
  it("lets a document and a transfer pair speak first", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 1_500_000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line: out, match: null, documents: [doc], coding: related }).kind).toBe("document");
    const transfer = { kind: "transfer" as const, counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "…", also: "" };
    expect(reviewProposal({ line: out, match: null, documents: [], coding: related, pair: transfer }).kind).toBe("transfer");
  });
  it("refuses, naming both, when a related company and a card claim the line", () => {
    expect(
      reviewProposal({ line: out, match: null, documents: [], coding: null, registerRivals: ["Example Affiliate", "2050 Example Card"] }),
    ).toEqual({ kind: "none", why: "Matches Example Affiliate and 2050 Example Card — code it yourself" });
  });
});
```

In `tests/unit/loan-interest.test.ts`, inside `describe("loanSuggestionsFrom", …)` and after its last `it(…)`, add:

```ts
  it("proposes no split when a related company also claims the line", () => {
    const withDue = new Map<string, CodingAccount>([...accounts, ["due", acct("due", "1460", "Due from/to Example Affiliate", "current_asset")]]);
    const company = { id: "rc1", name: "Example Affiliate", accountId: "due", matchWords: "example loan", isActive: true };
    expect(loanSuggestionsFrom({ ...base, accounts: withDue, related: [company], lines: [line("t1", "EXAMPLE LOAN PMT")] })).toEqual([]);
  });
```

In `tests/unit/repayments.test.ts`, remove `repaymentFor,` from the import list and delete the whole `describe("repaymentFor", …)` block. The `repaymentHits` block from Task 3 stays; rivals are now covered in `tests/unit/register-claim.test.ts`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement-review-cards.test.ts tests/unit/statement-review-loans.test.ts tests/unit/statement-review-related.test.ts tests/unit/loan-interest.test.ts tests/unit/repayments.test.ts`
Expected: FAIL — the refusal still counts ("Matches 2 cards or loans…" is not produced for `registerRivals`), the related label is missing, and the loan line naming a related company is still proposed.

- [ ] **Step 3: Change `lib/domain/statement-review.ts`**

This file imports without extensions (`"./coding"`); keep its style. Add, after `import type { LoanSuggestionView } from "./loan-interest";`:

```ts
import { rivalsWhy } from "./register-claim";
```

In the header comment, replace

```
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75) or loan (1.76), or nothing when two cards or loans
 * claim the line; then a rule or history (1.70). A loan payment is never
```

with

```
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75), loan (1.76) or related company (1.77), or nothing —
 * naming them — when two of those claim the line; then a rule or history
 * (1.70). A loan payment is never
```

In `ReviewProposal`, change the account variant to:

```ts
  | {
      kind: "account";
      accountId: string;
      label: string;
      why: string;
      alternative?: ReviewPairView;
      repayment?: "card";
      /** A related company's account (related-companies.ts). */
      related?: true;
    }
```

In `reviewProposal`'s input, replace

```ts
  /** How many registered cards or loans claim this line, when more than one does. */
  repaymentRivals?: number;
```

with

```ts
  /** Who claims this line in the register, when more than one does (register-claim.ts). */
  registerRivals?: readonly string[];
```

In the destructuring line, replace `repaymentRivals` with `registerRivals`. Replace the refusal block

```ts
  // Two registered cards or loans claim this line: which balance it repays is
  // a person's call, and a rule or history must not guess it as a cost.
  if (repaymentRivals && repaymentRivals > 1) {
    return { kind: "none", why: `Matches ${repaymentRivals} cards or loans — code it yourself` };
  }
```

with

```ts
  // Two registered cards, loans or related companies claim this line: which is
  // a person's call, and a rule or history must not guess it as a cost.
  if (registerRivals && registerRivals.length > 1) {
    return { kind: "none", why: rivalsWhy(registerRivals) };
  }
```

Replace the `if (coding) { … }` block with:

```ts
  if (coding) {
    const isCard = coding.source === "card";
    const isRelated = coding.source === "related";
    const proposal = {
      kind: "account" as const,
      accountId: coding.accountId,
      label: isCard
        ? `Card payment · ${coding.accountLabel}`
        : isRelated
          ? `Between companies · ${coding.accountLabel}`
          : coding.accountLabel,
      why: coding.why,
      ...(isCard ? { repayment: "card" as const } : {}),
      ...(isRelated ? { related: true as const } : {}),
    };
    return funding ? { ...proposal, why: `${coding.why}. Also: ${funding.also}`, alternative: funding } : proposal;
  }
```

- [ ] **Step 4: Change `lib/domain/loan-interest.ts`**

Replace `import { repaymentFor, type InterestMethod, type RepaymentAccount } from "./repayments.ts";` with:

```ts
import { registerClaim } from "./register-claim.ts";
import type { RelatedCompany } from "./related-companies.ts";
import type { InterestMethod, RepaymentAccount } from "./repayments.ts";
```

In `loanSuggestionsFrom`'s input, after `repayments: readonly RepaymentAccount[];` add:

```ts
  /** Related companies: a line one of them also names is not a loan payment to propose. */
  related?: readonly RelatedCompany[];
```

Replace the `const fact = repaymentFor(…);` statement and the `if (fact?.kind !== "one" || …) continue;` line, and the `loanLines.push(…)` line below them, with:

```ts
    const claim = registerClaim({
      repayments: input.repayments,
      related: input.related ?? [],
      line: { description: line.description, amountMinor: line.amountMinor, inBaseCurrency: input.baseCurrencyBankIds.has(line.bankAccountId) },
      accounts: input.accounts,
    });
    if (claim?.kind !== "repayment" || claim.entry.kind !== "loan") continue;
    loanLines.push({ id: line.id, date: line.date, paymentMinor: Math.abs(line.amountMinor), entry: claim.entry });
```

- [ ] **Step 5: Remove `repaymentFor` from `lib/domain/repayments.ts`**

Delete the line `export type RepaymentFact = { kind: "one"; entry: RepaymentAccount } | { kind: "rivals"; count: number };` and the whole `repaymentFor` function with its doc comment. In the file's header comment, replace the paragraph

```
 * One entry or nothing: a line two entries claim gets no proposal at all, the
 * way two open invoices of one amount get none.
```

with

```
 * One claimant or nothing: register-claim.ts weighs these entries together
 * with the related companies, and a line two of them claim gets no proposal.
```

- [ ] **Step 6: Change `lib/services/statement-review.ts`**

Replace `import { repaymentFor } from "@/lib/domain/repayments";` with:

```ts
import { registerClaim } from "@/lib/domain/register-claim";
```

In the `suggestionsFrom({ … })` call, after `repayments: context.repayments,` add `related: context.related,`.

Replace the `repaymentRivalsOf` block (from the comment `// Two cards or loans claiming one line: …` to the end of the arrow function) with:

```ts
  // Two of the register claiming one line: Review import names them instead of guessing.
  const chart = new Map(accountRows.map((row) => [row.id, codingAccountOf(row)]));
  const inBase = context.baseCurrencyBankIds.has(batch.bank_account_id);
  const registerRivalsOf = (row: BankTransactionRow): string[] => {
    const claim = registerClaim({
      repayments: context.repayments,
      related: context.related,
      line: { description: row.description ?? "", amountMinor: Number(row.amount_minor), inBaseCurrency: inBase },
      accounts: chart,
    });
    return claim?.kind === "rivals" ? claim.labels : [];
  };
```

In the `loanSuggestionsFrom({ … })` call, after `repayments: context.repayments,` add `related: context.related,`.

In the `reviewProposal({ … })` call, replace `repaymentRivals: repaymentRivalsOf(row),` with:

```ts
          registerRivals: registerRivalsOf(row),
```

- [ ] **Step 7: Change `lib/services/loan-payments.ts`**

In the `loanSuggestionsFrom({ … })` call inside `loanSuggestions`, after `repayments: context.repayments,` add:

```ts
    related: context.related,
```

- [ ] **Step 8: Run the tests, the typecheck and the lint**

Run: `npx vitest run tests/unit/statement-review-cards.test.ts tests/unit/statement-review-loans.test.ts tests/unit/statement-review-related.test.ts tests/unit/loan-interest.test.ts tests/unit/repayments.test.ts tests/unit/register-claim.test.ts tests/unit/coding.test.ts tests/unit/coding-service.test.ts`
Expected: PASS, 0 failed.
Run: `npm run typecheck && npm run lint`
Expected: 0 errors. `grep -rn "repaymentFor\|RepaymentFact\|repaymentRivals" lib app tests scripts` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add lib/domain/statement-review.ts lib/domain/loan-interest.ts lib/domain/repayments.ts lib/services/statement-review.ts lib/services/loan-payments.ts tests/unit/statement-review-cards.test.ts tests/unit/statement-review-loans.test.ts tests/unit/statement-review-related.test.ts tests/unit/loan-interest.test.ts tests/unit/repayments.test.ts
printf 'feat(banking): Review import proposes related companies, names rivals\n\nA line naming a related company is Between companies, to its account,\nticked. A line the register claims twice says which: "Matches A and B —\ncode it yourself". A loan line a related company also names is no split.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Writing the register — service, schemas, actions

**Files:**
- Create: `lib/services/related-companies.ts`
- Modify: `lib/services/repayments.ts` (`saveRepayment`, lines 115–155; imports)
- Modify: `lib/domain/schemas.ts` (after `loanPaymentSchema`)
- Modify: `app/(app)/banking/rules/actions.ts`
- Create: `tests/unit/related-companies-service.test.ts`

**Interfaces:**
- Consumes: from Task 2, `relatedAccountProblem`, `relatedMatches`, `validateRelatedInput`, `type RelatedCompany`, `type RelatedCompanyInput`; from Task 3, `listRepayments`, `listRelatedCompanies`, `baseCurrencyBankIds`.
- Produces:
  - `class RelatedCompanyError extends Error`
  - `interface RelatedWaitingLine { date: string; description: string; amountMinor: number }`
  - `interface RelatedPreview { waiting: number; lines: RelatedWaitingLine[] }`
  - `relatedPreviewFrom(company: Pick<RelatedCompany, "matchWords">, waiting: readonly { date: string; description: string; amountMinor: number; inBaseCurrency: boolean }[]): RelatedPreview`
  - `previewRelated(sb, input: { matchWords: string }): Promise<RelatedPreview>`
  - `relatedWaitingCounts(sb, companies: readonly RelatedCompany[], lines: readonly BankTransactionRow[]): Promise<Record<string, number>>`
  - `relatedBalances(sb, accountIds: readonly string[], asOf?: string): Promise<Record<string, number>>` — debit less credit per account, minor units
  - `relatedDuplicateMessage(dbMessage: string): string`
  - `saveRelatedCompany(sb, id: string | null, input: RelatedCompanyInput): Promise<string>`
  - `deleteRelatedCompany(sb, id: string): Promise<void>`
  - schemas `relatedCompanyPreviewSchema`, `relatedCompanyInputSchema`
  - actions `previewRelatedCompanyAction(raw)`, `saveRelatedCompanyAction(id, raw)`, `deleteRelatedCompanyAction(id)`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/related-companies-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { relatedCompanyInputSchema, relatedCompanyPreviewSchema } from "@/lib/domain/schemas";
import { relatedDuplicateMessage, relatedPreviewFrom } from "@/lib/services/related-companies";

const waiting = (date: string, description: string, amountMinor: number, inBaseCurrency = true) => ({
  date,
  description,
  amountMinor,
  inBaseCurrency,
});

describe("relatedPreviewFrom", () => {
  it("counts the waiting lines the words name, in or out, on base-currency banks", () => {
    const preview = relatedPreviewFrom({ matchWords: "example affiliate, exa" }, [
      waiting("2026-09-02", "WIRE TO EXAMPLE AFFILIATE", -1_500_000),
      waiting("2026-09-05", "WIRE FROM EXA", 700_000),
      waiting("2026-09-06", "WIRE FROM EXA", 700_000, false),
      waiting("2026-09-07", "EXAMPLE SUPPLY", -10_000),
      waiting("2026-09-08", "EXA ZERO", 0),
    ]);
    expect(preview).toEqual({
      waiting: 2,
      lines: [
        { date: "2026-09-05", description: "WIRE FROM EXA", amountMinor: 700_000 },
        { date: "2026-09-02", description: "WIRE TO EXAMPLE AFFILIATE", amountMinor: -1_500_000 },
      ],
    });
  });
  it("lists at most the newest ten", () => {
    const many = Array.from({ length: 12 }, (_, i) => waiting(`2026-09-${String(i + 1).padStart(2, "0")}`, "WIRE TO EXA", -100));
    const preview = relatedPreviewFrom({ matchWords: "exa" }, many);
    expect(preview.waiting).toBe(12);
    expect(preview.lines).toHaveLength(10);
    expect(preview.lines[0].date).toBe("2026-09-12");
  });
});

describe("relatedDuplicateMessage", () => {
  it("says which of the two unique rules a save broke", () => {
    expect(relatedDuplicateMessage('duplicate key value violates unique constraint "acc_related_company_account_id_key"')).toBe(
      "This account already belongs to a related company",
    );
    expect(relatedDuplicateMessage('duplicate key value violates unique constraint "acc_related_company_name_key"')).toBe(
      "A related company of this name is already here",
    );
  });
});

describe("related company schemas", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("take a company with a name, an account, words and a switch", () => {
    const parsed = relatedCompanyInputSchema.safeParse({ name: "  Example Affiliate, LLC ", accountId: id, matchWords: "exa", isActive: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe("Example Affiliate, LLC");
  });
  it("refuse a blank or long name, a missing account and long words", () => {
    const ok = { name: "Example Affiliate", accountId: id, matchWords: "exa", isActive: true };
    expect(relatedCompanyInputSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, name: "x".repeat(121) }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, accountId: "" }).success).toBe(false);
    expect(relatedCompanyInputSchema.safeParse({ ...ok, matchWords: "x".repeat(201) }).success).toBe(false);
    expect(relatedCompanyPreviewSchema.safeParse({ matchWords: "x".repeat(201) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/related-companies-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/services/related-companies"`.

- [ ] **Step 3: The schemas**

In `lib/domain/schemas.ts`, directly after `loanPaymentSchema`, add:

```ts
/** The words a related company's preview tries against the lines waiting now. */
export const relatedCompanyPreviewSchema = z.object({
  matchWords: z.string().max(200, "Words are at most 200 characters"),
});

/** A related company, as the Related companies form saves it. */
export const relatedCompanyInputSchema = relatedCompanyPreviewSchema.extend({
  name: z.string().trim().min(1, "Give the company's name").max(120, "The name is at most 120 characters"),
  accountId: z.uuid("Choose the account it owes or is owed on"),
  isActive: z.boolean(),
});
```

- [ ] **Step 4: The service**

Create `lib/services/related-companies.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankTransactionRow } from "@/lib/db/types";
import { codingAccountOf } from "@/lib/domain/coding";
import {
  relatedAccountProblem,
  relatedMatches,
  validateRelatedInput,
  type RelatedCompany,
  type RelatedCompanyInput,
} from "@/lib/domain/related-companies";
import { phrasesOf } from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { readAllPages } from "./paging";
import { baseCurrencyBankIds, listRepayments } from "./repayment-register";

/**
 * Related companies on Banking › Rules: saving an entry; the lines waiting now
 * that name it — "Names 3 waiting lines", with the lines, so a short word that
 * catches too much is seen before it is saved; and the balance with each
 * company today, read from its one account.
 */
export class RelatedCompanyError extends Error {}
const fail = (message: string) => new RelatedCompanyError(message);

export interface RelatedWaitingLine {
  date: string;
  description: string;
  amountMinor: number;
}

export interface RelatedPreview {
  /** Waiting lines the words name, in or out, on base-currency banks. */
  waiting: number;
  /** The newest of them, at most ten. */
  lines: RelatedWaitingLine[];
}

type WaitingRow = { bank_account_id: string; txn_date: string; description: string | null; amount_minor: number };
type WaitingLine = RelatedWaitingLine & { inBaseCurrency: boolean };

/** Every line waiting now, in or out. Read narrowly: only what the preview needs. */
async function waitingRows(sb: SupabaseClient): Promise<WaitingRow[]> {
  return readAllPages<WaitingRow>(
    (from, to) =>
      sb
        .from("acc_bank_transaction")
        .select("id,bank_account_id,txn_date,description,amount_minor")
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .neq("amount_minor", 0)
        .order("id")
        .range(from, to),
    fail,
  );
}

const waitingFrom = (rows: readonly WaitingRow[], bankIds: ReadonlySet<string>): WaitingLine[] =>
  rows.map((row) => ({
    date: String(row.txn_date).slice(0, 10),
    description: row.description ?? "",
    amountMinor: Number(row.amount_minor),
    inBaseCurrency: bankIds.has(row.bank_account_id),
  }));

/** Pure: the waiting lines a company's words name, in or out, on base-currency banks; the newest ten listed. */
export function relatedPreviewFrom(company: Pick<RelatedCompany, "matchWords">, waiting: readonly WaitingLine[]): RelatedPreview {
  const named = waiting.filter((line) => line.amountMinor !== 0 && line.inBaseCurrency && relatedMatches(company, line.description));
  return {
    waiting: named.length,
    lines: [...named]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(({ date, description, amountMinor }) => ({ date, description, amountMinor })),
  };
}

export async function previewRelated(sb: SupabaseClient, input: { matchWords: string }): Promise<RelatedPreview> {
  const [rows, bankIds] = await Promise.all([waitingRows(sb), baseCurrencyBankIds(sb)]);
  return relatedPreviewFrom(input, waitingFrom(rows, bankIds));
}

/** For the Rules page, from the lines it already read: how many waiting lines name each company. */
export async function relatedWaitingCounts(
  sb: SupabaseClient,
  companies: readonly RelatedCompany[],
  lines: readonly BankTransactionRow[],
): Promise<Record<string, number>> {
  if (!companies.length) return {};
  const bankIds = await baseCurrencyBankIds(sb);
  const waiting = waitingFrom(
    lines
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({
        bank_account_id: row.bank_account_id,
        txn_date: row.txn_date,
        description: row.description,
        amount_minor: Number(row.amount_minor),
      })),
    bankIds,
  );
  return Object.fromEntries(companies.map((company) => [company.id, relatedPreviewFrom(company, waiting).waiting]));
}

/** Debit less credit on each account, from posted entries dated on or before `asOf`, in the base currency. */
export async function relatedBalances(
  sb: SupabaseClient,
  accountIds: readonly string[],
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<Record<string, number>> {
  if (!accountIds.length) return {};
  const rows = await readAllPages<{ account_id: string; debit_base: number; credit_base: number }>(
    (from, to) =>
      sb
        .rpc("acc_ledger_balances", { p_from: null, p_to: asOf })
        .in("account_id", [...accountIds])
        .order("account_id")
        .range(from, to),
    fail,
  );
  return Object.fromEntries(rows.map((row) => [row.account_id, Number(row.debit_base) - Number(row.credit_base)]));
}

/** Which of the two unique rules a save broke, in the screen's words. */
export function relatedDuplicateMessage(dbMessage: string): string {
  return /account_id/.test(dbMessage)
    ? "This account already belongs to a related company"
    : "A related company of this name is already here";
}

export async function saveRelatedCompany(sb: SupabaseClient, id: string | null, input: RelatedCompanyInput): Promise<string> {
  const problem = validateRelatedInput(input);
  if (problem) throw fail(problem);
  const [accounts, repayments] = await Promise.all([listAccounts(sb), listRepayments(sb)]);
  const chart = new Map(accounts.map((row) => [row.id, codingAccountOf(row)]));
  const accountProblem = relatedAccountProblem(
    chart.get(input.accountId),
    repayments.some((entry) => entry.accountId === input.accountId),
  );
  if (accountProblem) throw fail(accountProblem);
  const fields = {
    name: input.name.trim().replace(/\s+/g, " "),
    account_id: input.accountId,
    match_words: phrasesOf(input.matchWords).join(", "),
    is_active: input.isActive,
  };
  const result = id
    ? await sb.from("acc_related_company").update(fields).eq("id", id).select("id").single()
    : await sb.from("acc_related_company").insert(fields).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") throw fail(relatedDuplicateMessage(result.error.message));
    if (result.error.code === "PGRST116") throw fail("This related company is no longer in the list");
    throw fail(result.error.message);
  }
  return (result.data as { id: string }).id;
}

export async function deleteRelatedCompany(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_related_company").delete().eq("id", id);
  if (error) throw fail(error.message);
}
```

- [ ] **Step 5: Cards and loans refuses a related company's account**

In `lib/services/repayments.ts`, change the import `import { RepaymentError, baseCurrencyBankIds } from "./repayment-register";` to:

```ts
import { RepaymentError, baseCurrencyBankIds, listRelatedCompanies } from "./repayment-register";
```

In `saveRepayment`, replace

```ts
  const chart = new Map((await listAccounts(sb)).map((row) => [row.id, codingAccountOf(row)]));
```

with

```ts
  const [chartRows, related] = await Promise.all([listAccounts(sb), listRelatedCompanies(sb)]);
  const chart = new Map(chartRows.map((row) => [row.id, codingAccountOf(row)]));
  if (related.some((company) => company.accountId === input.accountId)) {
    throw new RepaymentError("This account belongs to a related company — a card or loan needs an account of its own");
  }
```

- [ ] **Step 6: The actions**

In `app/(app)/banking/rules/actions.ts`, add `relatedCompanyInputSchema,` and `relatedCompanyPreviewSchema,` to the import from `@/lib/domain/schemas` (alphabetically, after `bankRuleInputSchema,`), add this import after the repayments import:

```ts
import {
  deleteRelatedCompany,
  previewRelated,
  saveRelatedCompany,
  type RelatedPreview,
} from "@/lib/services/related-companies";
```

and append at the end of the file:

```ts
export async function previewRelatedCompanyAction(raw: unknown): Promise<ActionResult<RelatedPreview>> {
  const parsed = relatedCompanyPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid words" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewRelated(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function saveRelatedCompanyAction(id: string | null, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = relatedCompanyInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid related company" };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveRelatedCompany(sb, id, parsed.data);
    refresh();
    return { ok: true, data: { id: saved } };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function deleteRelatedCompanyAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await deleteRelatedCompany(sb, id);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}
```

- [ ] **Step 7: Run the tests, the typecheck and the lint**

Run: `npx vitest run tests/unit/related-companies-service.test.ts tests/unit/repayments-service.test.ts`
Expected: PASS, 0 failed.
Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/services/related-companies.ts lib/services/repayments.ts lib/domain/schemas.ts "app/(app)/banking/rules/actions.ts" tests/unit/related-companies-service.test.ts
printf 'feat(banking): save, preview and balance related companies\n\nSave checks the account against the chart and Cards and loans, and says\nwhich unique rule a duplicate broke. The preview lists the waiting lines the\nwords name. Cards and loans refuses a related company'"'"'s account.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: The Related companies section, and the Review import count

**Files:**
- Create: `app/(app)/banking/rules/related-columns.ts`
- Create: `tests/unit/related-columns.test.ts`
- Create: `app/(app)/banking/rules/RelatedCompanyFormModal.tsx`
- Create: `app/(app)/banking/rules/RelatedCompaniesSection.tsx`
- Modify: `app/(app)/banking/rules/repayments.module.css` (line 1, the comment)
- Modify: `app/(app)/banking/rules/page.tsx`
- Modify: `app/(app)/banking/imports/[id]/ReviewImportClient.tsx` (around lines 66 and 259)

**Interfaces:**
- Consumes: from Task 2, `balanceWords`, `relatedAccountAllowed`, `seedRelatedWords`, `usableRelated`, `type RelatedCompany`; from Task 3, `listRelatedCompanies`; from Task 5, `ReviewProposal` account `related?: true`; from Task 6, `relatedBalances`, `relatedWaitingCounts`, `type RelatedPreview`, and the three actions.
- Produces: `RELATED_COLUMN_WIDTH`; `RelatedListRow`; the two components.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/related-columns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RELATED_COLUMN_WIDTH } from "@/app/(app)/banking/rules/related-columns";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";

describe("the Related companies columns", () => {
  it("fit the table's box at 1280px, with Matches on given the text floor", () => {
    const measured = Object.values(RELATED_COLUMN_WIDTH).reduce((sum, width) => sum + width, 0);
    expect(fitsBox(measured, COLUMN.TEXT_MIN)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/related-columns.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/(app)/banking/rules/related-columns"`.

- [ ] **Step 3: The widths**

Create `app/(app)/banking/rules/related-columns.ts`:

```ts
import { COLUMN } from "@/lib/design/table-metrics";

/** Fixed widths of the Related companies table; Matches on carries none and takes what is left. */
export const RELATED_COLUMN_WIDTH = {
  name: COLUMN.PICKER,
  account: COLUMN.PICKER + COLUMN.ACTION,
  balance: COLUMN.PICKER,
  waiting: COLUMN.QTY,
  active: COLUMN.ACTION * 1.5,
  actions: COLUMN.ACTION * 2,
} as const;
```

Run: `npx vitest run tests/unit/related-columns.test.ts`
Expected: PASS (718 + 200 ≤ 984).

- [ ] **Step 4: The form**

Create `app/(app)/banking/rules/RelatedCompanyFormModal.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, Modal, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { seedRelatedWords } from "@/lib/domain/related-companies";
import { formatMoney } from "@/lib/format";
import type { RelatedPreview } from "@/lib/services/related-companies";
import { previewRelatedCompanyAction, saveRelatedCompanyAction } from "./actions";
import styles from "./repayments.module.css";

export interface RelatedFormValues {
  name: string;
  matchWords: string;
  accountId: string | null;
  isActive: boolean;
}

export const EMPTY_RELATED: RelatedFormValues = { name: "", matchWords: "", accountId: null, isActive: true };

export function toRelatedInput(values: RelatedFormValues) {
  return {
    name: (values.name ?? "").trim(),
    matchWords: (values.matchWords ?? "").trim(),
    accountId: values.accountId ?? "",
    isActive: values.isActive,
  };
}

/**
 * Add or change a related company. Typing the name fills in the words its bank
 * is likely to print, until the person types their own; the preview then lists
 * the lines waiting now that those words name, so a short word that catches
 * too much is seen before anything is saved.
 */
export default function RelatedCompanyFormModal({
  open,
  relatedId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  relatedId: string | null;
  initial: RelatedFormValues;
  /** Current asset and liability accounts no other related company or card or loan uses, plus this one's own. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RelatedFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RelatedPreview | null>(null);
  const watchedWords = Form.useWatch("matchWords", form) as string | undefined;
  const words = (watchedWords ?? initial.matchWords).trim();

  useEffect(() => {
    if (!open || !words) return;
    const timer = setTimeout(() => {
      void previewRelatedCompanyAction({ matchWords: words }).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, words]);

  const options = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [accounts],
  );

  function close() {
    setPreview(null);
    onClose();
  }

  // A new company takes its words from its name, until the person types their own.
  function onValuesChange(changed: Partial<RelatedFormValues>) {
    if (relatedId || !("name" in changed)) return;
    if (!form.isFieldTouched("matchWords")) form.setFieldValue("matchWords", seedRelatedWords(changed.name ?? ""));
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveRelatedCompanyAction(relatedId, toRelatedInput({ ...EMPTY_RELATED, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the related company");
      return;
    }
    message.success(`Related company ${relatedId ? "saved" : "added"}`);
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={`${relatedId ? "Edit" : "Add"} related company`}
      okText={relatedId ? "Save" : "Add related company"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item
          name="name"
          label="Company name"
          rules={[
            { required: true, whitespace: true, message: "Give the company's name" },
            { max: 120, message: "The name is at most 120 characters" },
          ]}
        >
          <Input placeholder="Example Affiliate, LLC" />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for this company"
          extra="Separate several with commas. Each is matched as whole words, in any case — a short one such as EXA does not match EXAMPLE."
          rules={[
            { required: true, whitespace: true, message: "Give the words your bank prints for this company" },
            { max: 200, message: "Words are at most 200 characters" },
          ]}
        >
          <Input placeholder="example affiliate, exa" />
        </Form.Item>
        <Form.Item
          name="accountId"
          label="Account it owes or is owed on"
          extra="Money out to this company debits it and money in credits it, so its balance says who owes whom. A current asset or a liability — never income or an expense."
          rules={[{ required: true, message: "Choose the account it owes or is owed on" }]}
        >
          <Select showSearch optionFilterProp="label" placeholder="Choose a current asset or liability account" options={options} />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview && words ? (
        <div className={styles.preview}>
          <Typography.Text strong>
            Names {preview.waiting} waiting line{s(preview.waiting)}
          </Typography.Text>
          {preview.lines.map((line, i) => (
            <Typography.Text key={`${line.date}-${i}`} type="secondary" className={styles.missed}>
              {line.date} · {line.description} · {formatMoney(line.amountMinor, USD_CURRENCY_CODE, 2)}
            </Typography.Text>
          ))}
          {preview.waiting > preview.lines.length ? (
            <Typography.Text type="secondary" className={styles.missed}>
              and {preview.waiting - preview.lines.length} more
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 5: The section**

Create `app/(app)/banking/rules/RelatedCompaniesSection.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { balanceWords, type RelatedCompany } from "@/lib/domain/related-companies";
import { formatMoney } from "@/lib/format";
import RelatedCompanyFormModal, { EMPTY_RELATED, toRelatedInput, type RelatedFormValues } from "./RelatedCompanyFormModal";
import { deleteRelatedCompanyAction, saveRelatedCompanyAction } from "./actions";
import { RELATED_COLUMN_WIDTH } from "./related-columns";
import styles from "./repayments.module.css";

export interface RelatedListRow extends RelatedCompany {
  accountLabel: string;
  /** False when the account is no longer an active posting current asset or liability. */
  accountUsable: boolean;
  /** Waiting lines its words name. */
  waiting: number;
  /** Debit less credit on its account today, in minor units: above zero, it owes us. */
  balanceMinor: number;
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

const valuesOf = (row: RelatedCompany): RelatedFormValues => ({
  name: row.name,
  matchWords: row.matchWords,
  accountId: row.accountId,
  isActive: row.isActive,
});

/**
 * Related companies: other companies the same owners run. Money to or from
 * one is a loan between the two, never income or a cost; a line naming one,
 * in or out, is offered to its account before any rule. Its own books are not
 * written here.
 */
export default function RelatedCompaniesSection({
  rows,
  accounts,
  canWrite,
}: {
  rows: RelatedListRow[];
  /** Current asset and liability accounts a related company may use: not in Cards and loans. */
  accounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RelatedFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const free = accounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);
  const allTaken = accounts.every((account) => taken.has(account.id));

  async function setActive(row: RelatedListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRelatedCompanyAction(row.id, toRelatedInput({ ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the related company");
      return;
    }
    router.refresh();
  }

  function remove(row: RelatedListRow) {
    modal.confirm({
      title: "Remove this related company?",
      content: `${row.name}. Lines already posted stay as they are; new ones naming it are no longer offered to ${row.accountLabel}.`,
      okText: "Remove related company",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRelatedCompanyAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not remove the related company");
          return;
        }
        message.success("Related company removed");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RelatedListRow> = [
    {
      title: "Company",
      key: "name",
      width: RELATED_COLUMN_WIDTH.name,
      render: (_: unknown, row: RelatedListRow) => <Typography.Text ellipsis={{ tooltip: row.name }}>{row.name}</Typography.Text>,
    },
    {
      ...flexColumn<RelatedListRow>({
        title: "Matches on",
        key: "match",
        render: (_: unknown, row: RelatedListRow) => <Typography.Text code>{row.matchWords}</Typography.Text>,
      }),
    },
    {
      title: "Account",
      key: "account",
      width: RELATED_COLUMN_WIDTH.account,
      render: (_: unknown, row: RelatedListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or no longer a current asset or liability. Nothing is offered to it for this company until it is changed.">
            <Tag color="orange">{row.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      title: "Balance today",
      key: "balance",
      width: RELATED_COLUMN_WIDTH.balance,
      align: "right",
      render: (_: unknown, row: RelatedListRow) => (
        <Typography.Text type={row.balanceMinor === 0 ? "secondary" : undefined}>{balanceWords(row.balanceMinor, money)}</Typography.Text>
      ),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: RELATED_COLUMN_WIDTH.waiting,
      align: "right",
      render: (_: unknown, row: RelatedListRow) => row.waiting,
    },
    {
      title: "On",
      key: "active",
      width: RELATED_COLUMN_WIDTH.active,
      render: (_: unknown, row: RelatedListRow) => (
        <Switch size="small" checked={row.isActive} disabled={!canWrite} loading={busy === row.id} onChange={(checked) => void setActive(row, checked)} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: RELATED_COLUMN_WIDTH.actions,
            align: "right" as const,
            render: (_: unknown, row: RelatedListRow) => (
              <Space size={2}>
                <IconActionButton label="Edit related company" icon={<EditOutlined />} onClick={() => setEditing({ id: row.id, values: valuesOf(row) })} />
                <IconActionButton label="Remove related company" icon={<DeleteOutlined />} onClick={() => remove(row)} />
              </Space>
            ),
          } as TableColumnsType<RelatedListRow>[number],
        ]
      : []),
  ];

  return (
    <section className={styles.section} aria-labelledby="related-heading">
      <Typography.Text strong id="related-heading">
        Related companies
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        Money sent to or received from another company the same owners run is a loan between the two — never income or a
        cost. Add each one with the words your bank prints for it and the one account that carries what it owes you or you
        owe it, and a line naming it, in or out, is offered to that account before any rule. The other company&apos;s books are
        not written here: record its side there.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button icon={<PlusOutlined />} disabled={allTaken} onClick={() => setEditing({ id: null, values: EMPTY_RELATED })}>
            Add related company
          </Button>
          {accounts.length === 0 ? (
            <Typography.Text type="secondary">
              Add a current asset or liability account in Chart of Accounts, such as Due from/to Example Affiliate, to register a
              related company.
            </Typography.Text>
          ) : allTaken ? (
            <Typography.Text type="secondary">Every current asset and liability account that can take one already has a related company.</Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RelatedListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No related companies yet"
        emptyDescription="Until a company is added here, a line naming it is suggested by rules and history like any other line — which can make it income or a cost."
      />
      {editing ? (
        <RelatedCompanyFormModal
          key={editing.id ?? "new"}
          open
          relatedId={editing.id}
          initial={editing.values}
          accounts={free}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: The page**

In `app/(app)/banking/rules/repayments.module.css`, change the first line to:

```css
/* The Cards and loans and Related companies sections, between Pairs and the rule list. */
```

Replace `app/(app)/banking/rules/page.tsx` with:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { fundingAccountAllowed, suggestFundingAccount } from "@/lib/domain/bank-pairs";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { relatedAccountAllowed, usableRelated } from "@/lib/domain/related-companies";
import { interestAccountAllowed, repaysAccountAllowed, usableRepayment } from "@/lib/domain/repayments";
import { suggestInterestAccount } from "@/lib/domain/loan-interest";
import { listAccounts } from "@/lib/services/accounts";
import { listBankTransactions } from "@/lib/services/banking";
import { getBankingPreference } from "@/lib/services/banking-preference";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import { relatedBalances, relatedWaitingCounts } from "@/lib/services/related-companies";
import { listRelatedCompanies, listRepayments } from "@/lib/services/repayment-register";
import { repaymentStats } from "@/lib/services/repayments";
import PageHeader from "@/components/PageHeader";
import PairsPreference from "./PairsPreference";
import RelatedCompaniesSection, { type RelatedListRow } from "./RelatedCompaniesSection";
import RepaymentsSection, { type RepaymentListRow } from "./RepaymentsSection";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts, preference, repayments, related, lines] = await Promise.all([
    getUserRole(),
    listBankRules(sb),
    listAccounts(sb),
    getBankingPreference(sb),
    listRepayments(sb),
    listRelatedCompanies(sb),
    listBankTransactions(sb, null),
  ]);
  const liabilities = accounts
    .filter(fundingAccountAllowed)
    .map((account) => ({ id: account.id, label: `${account.account_code} — ${account.name}` }));
  const [waiting, stats, relatedWaiting, balances] = await Promise.all([
    ruleWaitingCounts(sb, rules, lines),
    repaymentStats(sb, repayments, lines),
    relatedWaitingCounts(sb, related, lines),
    relatedBalances(sb, related.map((company) => company.accountId)),
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const chart = new Map(accounts.map((account) => [account.id, codingAccountOf(account)]));
  const labelOf = (id: string) => {
    const account = byId.get(id);
    return account ? `${account.account_code} — ${account.name}` : "Account not found";
  };
  // An account is a card's, a loan's or a related company's — never two of them.
  const repaymentAccountIds = new Set(repayments.map((entry) => entry.accountId));
  const relatedAccountIds = new Set(related.map((company) => company.accountId));
  const rows: RuleListRow[] = rules.map((rule) => {
    const account = byId.get(rule.accountId);
    return {
      ...rule,
      accountLabel: labelOf(rule.accountId),
      accountUsable: codableAccount(account ? codingAccountOf(account) : undefined),
      waiting: waiting[rule.id] ?? 0,
    };
  });
  const repaymentRows: RepaymentListRow[] = repayments.map((entry) => ({
    ...entry,
    accountLabel: labelOf(entry.accountId),
    interestLabel: entry.interestAccountId ? labelOf(entry.interestAccountId) : null,
    accountUsable: usableRepayment({ ...entry, isActive: true }, chart),
    stats: stats[entry.id] ?? { past: 0, caught: 0, waiting: 0, missed: [] },
  }));
  const relatedRows: RelatedListRow[] = related.map((company) => ({
    ...company,
    accountLabel: labelOf(company.accountId),
    accountUsable: usableRelated({ ...company, isActive: true }, chart),
    waiting: relatedWaiting[company.id] ?? 0,
    balanceMinor: balances[company.accountId] ?? 0,
  }));
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="What says which account a bank line belongs to. A card, loan or related company registered here is recognized first; then the first rule that matches; history speaks only when none does. Nothing is posted until someone uses a suggestion."
      />
      <PairsPreference
        initial={preference}
        suggestedFundingId={suggestFundingAccount(accounts)}
        accounts={liabilities}
        canWrite={canWrite(role)}
      />
      <RepaymentsSection
        rows={repaymentRows}
        cardAccounts={accounts.filter((account) => repaysAccountAllowed("card", codingAccountOf(account)))}
        loanAccounts={accounts.filter(
          (account) => repaysAccountAllowed("loan", codingAccountOf(account)) && !relatedAccountIds.has(account.id),
        )}
        interestAccounts={accounts.filter((account) => interestAccountAllowed(codingAccountOf(account)))}
        suggestedInterestId={suggestInterestAccount([...chart.values()])}
        canWrite={canWrite(role)}
      />
      <RelatedCompaniesSection
        rows={relatedRows}
        accounts={accounts.filter(
          (account) => relatedAccountAllowed(codingAccountOf(account)) && !repaymentAccountIds.has(account.id),
        )}
        canWrite={canWrite(role)}
      />
      <RulesClient
        rules={rows}
        accounts={accounts.filter((account) => codableAccount(codingAccountOf(account)))}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 7: The Review import count**

In `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`, directly after the line that defines `cardPayments`, add:

```ts
  const betweenCompanies = lines.filter((l) => l.proposal.kind === "account" && l.proposal.related).length;
```

In the header text, replace

```tsx
          {counts.transfer === 1 ? "" : "s"} · {cardPayments} card payment{cardPayments === 1 ? "" : "s"} · {counts.loan} loan payment
          {counts.loan === 1 ? "" : "s"} · {counts.account - cardPayments} have an
```

with

```tsx
          {counts.transfer === 1 ? "" : "s"} · {cardPayments} card payment{cardPayments === 1 ? "" : "s"} · {betweenCompanies} between
          companies · {counts.loan} loan payment
          {counts.loan === 1 ? "" : "s"} · {counts.account - cardPayments - betweenCompanies} have an
```

- [ ] **Step 8: Run the gates for this task**

Run: `npx vitest run tests/unit/related-columns.test.ts && npm run typecheck && npm run lint`
Expected: PASS and 0 errors.
Run: `npm run build`
Expected: the build succeeds; `/banking/rules` is listed as a dynamic route.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/banking/rules/related-columns.ts" tests/unit/related-columns.test.ts "app/(app)/banking/rules/RelatedCompanyFormModal.tsx" "app/(app)/banking/rules/RelatedCompaniesSection.tsx" "app/(app)/banking/rules/repayments.module.css" "app/(app)/banking/rules/page.tsx" "app/(app)/banking/imports/[id]/ReviewImportClient.tsx"
printf 'feat(banking): Related companies section on Banking > Rules\n\nEach related company with its words, its account, the balance today (Owes\nus / We owe / Settled) and the waiting lines naming it; add and edit with a\nlive preview of those lines. Review import counts lines between companies.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 8: `scripts/verify-related-companies.mjs` — 0131 on every company, rolled back

**Files:**
- Create: `scripts/verify-related-companies.mjs`

**Interfaces:**
- Consumes: migration 0131 (Task 1); `planCompanySchema` from `../lib/domain/schema-template.ts`; the live RPCs `acc_categorise_bank_transaction(uuid, uuid)`, `acc_uncategorise_bank_transaction(uuid, text)`, `acc_ledger_balances(date, date)`.

- [ ] **Step 1: Write the script**

Create `scripts/verify-related-companies.mjs`:

```js
/**
 * Behavioural verification of migration 0131 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0131 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and bank line the checks need is made there
 * too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-related-companies.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0131_related_company.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 6 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function refused(sql, params) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("release savepoint probe");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint probe");
    return error.message;
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) => client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const { rows: companies } = await client.query(`select schema_name from onebook.company where status = 'active' order by display_order, schema_name`);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0131 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-CK", "Verify checking", "bank");
      const due = await account("ZZ-VERIFY-RC", "Verify Due from/to Affiliate", "current_asset");
      const due2 = await account("ZZ-VERIFY-RD", "Verify Due to Other Affiliate", "current_liability");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const bankLine = async (description, amount) =>
        (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
           values ($1, current_date, $2, $3, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
          [bank, description, amount],
        )).id;
      const lineOut = await bankLine("WIRE TO VERIFY AFFILIATE", -12345);
      const lineIn = await bankLine("WIRE FROM VERIFY AFFILIATE", 6789);

      await client.query("set local role authenticated");
      await as(admin.id);

      const insert = `insert into acc_related_company (name, account_id, match_words) values ($1, $2, $3) returning id`;
      const company = await one(insert, ["Verify Affiliate, LLC", due, "verify affiliate"]);
      check("staff register a related company", Boolean(company?.id));

      const expectRefusal = async (label, params, pattern) => {
        const message = await refused(insert, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      await expectRefusal("a blank name is refused", ["   ", due2, "other"], /name_ck/);
      await expectRefusal("a name over 120 characters is refused", ["x".repeat(121), due2, "other"], /name_ck/);
      await expectRefusal("blank words are refused", ["Verify Other", due2, "  "], /words_ck/);
      await expectRefusal("words over 200 characters are refused", ["Verify Other", due2, "x".repeat(201)], /words_ck/);
      await expectRefusal("the same name in another case is refused", ["VERIFY AFFILIATE, LLC ", due2, "other"], /acc_related_company_name_key/);
      await expectRefusal("the same account twice is refused", ["Verify Other", due, "other"], /acc_related_company_account_id_key/);

      await as(OUTSIDER);
      await expectRefusal("someone who is not staff cannot register", ["Verify Other", due2, "other"], /row-level security/);
      const seen = await one(`select count(*)::int n from acc_related_company`);
      check("someone who is not staff reads nothing", seen.n === 0, String(seen.n));

      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`);
      if (viewer) {
        await as(viewer.id);
        const read = await one(`select count(*)::int n from acc_related_company`);
        check("a viewer reads the register", read.n === 1, String(read.n));
        await expectRefusal("a viewer cannot register", ["Verify Other", due2, "other"], /row-level security/);
      } else {
        console.log("  SKIP  no active viewer to authenticate as");
      }
      await as(admin.id);

      const legsOf = async (entryNumber) =>
        (
          await client.query(
            `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr
               from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
              where e.entry_number = $1`,
            [entryNumber],
          )
        ).rows;

      // Money out debits the related company's account; money in credits it.
      const postedOut = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lineOut, due]);
      const outLegs = await legsOf(postedOut.r.entry_number);
      check(
        "money out debits the related account and credits the bank",
        outLegs.find((l) => l.account_id === due)?.dr === 12345 && outLegs.find((l) => l.account_id === gl)?.cr === 12345,
        JSON.stringify(outLegs),
      );
      const postedIn = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lineIn, due]);
      const inLegs = await legsOf(postedIn.r.entry_number);
      check(
        "money in credits the related account and debits the bank",
        inLegs.find((l) => l.account_id === due)?.cr === 6789 && inLegs.find((l) => l.account_id === gl)?.dr === 6789,
        JSON.stringify(inLegs),
      );
      const balance = await one(
        `select (debit_base - credit_base)::int as net from acc_ledger_balances(null, current_date) where account_id = $1`,
        [due],
      );
      check("the balance nets the two: the affiliate owes 55.56", balance?.net === 5556, String(balance?.net));

      await one(`select acc_uncategorise_bank_transaction($1, 'verify') as n`, [lineIn]);
      const back = await one(`select status from acc_bank_transaction where id = $1`, [lineIn]);
      check("Change takes a line back", back.status === "unmatched", back.status);

      await client.query(`update acc_related_company set match_words = 'verify affiliate, vfa' where id = $1`, [company.id]);
      await client.query(`delete from acc_related_company where id = $1`, [company.id]);

      await client.query("reset role");
      const audited = (await one(`select count(*)::int n from acc_audit_log where table_name = 'acc_related_company'`)).n;
      check("insert, update and delete are in the audit log", audited >= 3, String(audited));
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `node --env-file=.env.local scripts/verify-related-companies.mjs`
Expected: each company prints `(0131 applied inside the transaction, never committed)` (0131 is not live yet), every check `ok` (viewer checks may print `SKIP`), and the last line `N passed, 0 failed`.

If a check fails, read the detail and fix the cause. When the cause is in the script, fix the script. When it is in the migration, stop and report: Task 1 is done and reviewed.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-related-companies.mjs
printf 'test(banking): verify 0131 on every company, rolled back\n\nRLS, the name and words checks, unique name and account, audit, and posting\nmoney out and in to a related company'"'"'s account with Change taking it back.\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 9: Changelog 1.77 and the guide step

**Files:**
- Modify: `lib/domain/changelog.ts` (insert at the top of `RELEASES`, before the `version: "1.76"` object)
- Modify: `lib/domain/system-guide.ts` (after the step whose `control` is `"Split…"`)

- [ ] **Step 1: The release**

In `lib/domain/changelog.ts`, add as the first element of `RELEASES`:

```ts
  {
    version: "1.77",
    date: "2026-10-02",
    headline: "Money between your own companies is owed, never income or a cost.",
    changes: [
      {
        kind: "added",
        title: "Related companies in Bank Rules",
        detail:
          "Add each company the same owners run with the words your bank prints for it and the one account that carries what it owes you or you owe it — a current asset or a liability, never income or an expense. The table shows the balance with each today: Owes us, We owe, or Settled.",
        route: "/banking/rules",
      },
      {
        kind: "added",
        title: "Lines naming a related company go to its account",
        detail:
          "On Review import and Bank Transactions, money in or out that names a related company is offered as Between companies, to that company's account, before any rule or history. Lines coded before 1.77 are not changed, and the other company's books are not written: record its side there.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "A line two registered entries claim names them",
        detail:
          "When two cards, loans or related companies claim one line, it gets no suggestion and says which: \"Matches Example Affiliate and 2050 Example Card — code it yourself\".",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: The guide step**

In `lib/domain/system-guide.ts`, directly after the step object whose `control` is `"Split…"`, add:

```ts
      {
        action: "Tell OneBook which companies are your own",
        control: "Add related company",
        route: "/banking/rules",
        note:
          "Money sent to or received from another company the same owners run is a loan between the two, " +
          "never income or a cost. Add each with the words your bank prints for it and the one account that " +
          "carries what it owes or is owed; a line naming it, in or out, is offered to that account before any " +
          "rule or history. The table shows who owes whom today. The other company's books are not written — " +
          "record its side there.",
      },
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.77 related companies; guide step Add related company\n' > ../.superpowers/sdd/commit-msg.txt
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 10: Prove it, apply it, show it

No new code. Every step has to report real output.

- [ ] **Step 1: The four gates**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; `Tests  N passed` with **0 failed**; typecheck and lint report 0 errors. Paste the summary lines, untrimmed.

- [ ] **Step 2: The verify scripts, before going live**

Run: `node --env-file=.env.local scripts/verify-related-companies.mjs`
Expected: `0 failed`.
Run: `node --env-file=.env.local scripts/verify-card-loan.mjs` and `node --env-file=.env.local scripts/verify-loan-payment.mjs`
Expected: both `0 failed`. Cards and loans are unchanged in the database.

- [ ] **Step 3: Ask the user before applying 0131 live**

Say: "Migration 0131 only adds a table (nothing existing changes). Apply it to all six companies?" Wait for yes. Then:

Run: `node --env-file=.env.local scripts/migrate.mjs`
Expected: 0131 applied to every company in the register. Then run `scripts/verify-related-companies.mjs` again: the "(0131 applied inside the transaction…)" note must be gone, and `0 failed`.

- [ ] **Step 4: Smoke against a built server**

Start the build detached (PowerShell, because `npm start` dies under the Bash tool):

```powershell
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden
```

Run: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`
Expected: every page OK, including `/banking/rules` and `/banking`.

- [ ] **Step 5: Live on PC-Test only**

On the sample company PC-Test (`co_pc`, `is_sample = true`):
1. Add `1460 Due from/to Example Affiliate` (Current Asset) in Chart of Accounts if it has none.
2. Banking › Rules › **Add related company**: type `Example Affiliate, LLC`; the words fill in as `Example Affiliate`; add `, EXA`; choose 1460. Save. The row reads `Settled`.
3. Import a made-up CSV on `1010 Operating Bank Account` with:
   - `WIRE TO EXAMPLE AFFILIATE`, -1,500.00;
   - `WIRE FROM EXA REF 0042`, 700.00;
   - `EXAMPLE CARD EPAY PAID FOR EXAMPLE AFFILIATE`, -80.00 (PC-Test already has `2050 Example Card 4321` in Cards and loans with the words `Example Card`);
   - one ordinary line.
4. On Review import, the first two read `Between companies · 1460 — Due from/to Example Affiliate` and are ticked; the third reads `Matches Example Affiliate and 2050 Example Card 4321 — code it yourself`; the header counts 2 between companies.
5. Post. Banking › Rules shows `Owes us $800.00` for Example Affiliate.
6. Take the posts back with **Change** on Bank Transactions, then **Undo import**, as the earlier releases' PC-Test runs did. The related company and account 1460 stay as demo data.

- [ ] **Step 6: Screenshots for the user**

Capture, in light and dark, at 1440 and 1280, on PC-Test only:
- Banking › Rules with the Related companies section, and the Add related company form showing its preview;
- Review import with the three lines above;
- the Category cell on Bank Transactions with the `Related` suggestion.

Put them in one local HTML page outside the repository (`C:\Users\pit010\OneBook-1.77-anh-duyet.html`) and ask the user to look before anything is pushed.

- [ ] **Step 7: Push, after the user approves the screenshots**

```bash
git push -u origin feat/related-companies
```

Then tell the user the branch is pushed and ready for a PR. Update the memory file `related-companies-177.md` with what shipped.

---

## Self-review notes

- **Spec coverage:**
  - 3.1 register fields, the account rule and the cross-check with Cards and loans: Tasks 1, 2, 6 and 7.
  - 3.1 default words: Task 2 (`seedRelatedWords`), Task 7 (the form).
  - 3.2 recognition, in and out, whole words, base currency, usability: Task 2.
  - 3.3 one claim and the named rivals, replacing the count: Tasks 3 and 5.
  - 3.4 precedence on Review import and Bank Transactions; funding alongside: Tasks 4 and 5.
  - 3.5 label, why, short label, ticking, Code all, posting through categorise: Tasks 4 and 5. Code all follows from the `related` source being a `CodingSuggestionView`.
  - 3.6 the section, its columns at 1280px, the preview and the Review import count: Tasks 6 and 7.
  - 4.1 migration and export: Task 1. 4.4 changelog and guide: Task 9.
  - 5 proving it: unit tests in Tasks 1–7, the verify script in Task 8, PC-Test and screenshots in Task 10.
- **One order of tasks keeps every commit green:** `repaymentFor` stays, built on `repaymentHits`, until Task 5 moves its last two callers.
