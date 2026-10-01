# Card payments (1.75) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each company register its credit cards on Banking › Rules, so a bank payment to a card is proposed as a card payment, posted whole to the card account, before any rule or history. Without it, the payment can be coded to an expense.

**Architecture:** A new table `acc_repayment_account` (migration 0129) holds the register. It is built for cards and loans, but 1.75 only lets people register cards. A pure module `lib/domain/repayments.ts` decides which entry a waiting line repays. `suggestCoding` gives a card match the new source `card` ahead of rules and history, so the existing posting path (`acc_categorise_bank_transaction`) and every existing screen (Review import, the Category cell, Code all) carry it. A line that two entries claim gets no suggestion at all.

**Tech Stack:** Next.js App Router, React 19 + Ant Design, Supabase (Postgres, PostgREST, RLS), Zod 4, Vitest, `pg` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-10-01-card-loan-payments-design.md`. This plan covers the 1.75 half. Loans (1.76) get their own plan once this ships.

## Global Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads (`readAllPages`).
- Nothing is posted without a person's click.
- Money is in minor units end to end.
- `lib/domain/*.ts` files that scripts import use relative `.ts` imports only (`"./bank-rules.ts"`), never `@/`.
- Stage files by name; never `git add -A` (the repo is public and has untracked client files). No Co-Authored-By trailer. Write commit messages to a file and use `git commit -F`.
- No real client names, account digits or figures in repository files. Fixtures are invented ("Example Card 4321").
- Migration 0129 goes live only with the user's approval. Writes to live data happen only on the sample company PC-Test.
- Run everything from `ctyhp-accounting/`.
- Never pipe test output through `tail`/`head` before a push; read the pass/fail lines.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0129_repayment_register.sql` (new) | The register table, its checks, RLS, grants and audit. |
| `tests/unit/repayment-register-migration.test.ts` (new) | A static reading of 0129. |
| `lib/domain/company-export.ts` (modify) | Export the register with the rest of a company. |
| `lib/domain/repayments.ts` (new) | Pure rules: entry type, word and digit matching, one-or-rivals, usability, defaults, validation. |
| `tests/unit/repayments.test.ts` (new) | Tests for the above. |
| `lib/domain/coding.ts` (modify) | The `card` source, ahead of rules and history; a loan or rivals silence both. |
| `tests/unit/coding.test.ts` (modify) | Tests for the card source. |
| `lib/domain/statement-review.ts` (modify) | The "N cards or loans" refusal, the card label and the `repayment` marker. |
| `tests/unit/statement-review-cards.test.ts` (new) | Tests for Review import precedence with cards. |
| `lib/services/repayment-register.ts` (new) | Reading the register, and which bank accounts are in the base currency. |
| `lib/services/coding.ts` (modify) | `suggestionsFrom` and `codingSuggestions` take the register. |
| `lib/services/statement-review.ts` (modify) | Review import reads the register and passes rivals. |
| `tests/unit/coding-service.test.ts` (modify) | `suggestionsFrom` with the register. |
| `lib/services/repayments.ts` (new) | Save, delete, the preview and per-entry stats. |
| `tests/unit/repayments-service.test.ts` (new) | `repaymentStatsFrom` and the schemas. |
| `lib/domain/schemas.ts` (modify) | `repaymentPreviewSchema`, `repaymentInputSchema`. |
| `app/(app)/banking/rules/actions.ts` (modify) | Preview, save and delete actions. |
| `app/(app)/banking/rules/RepaymentFormModal.tsx` (new) | Add or edit a card, with the live preview. |
| `app/(app)/banking/rules/RepaymentsSection.tsx` (new) | The Cards and loans section. |
| `app/(app)/banking/rules/repayments.module.css` (new) | Its frame. |
| `app/(app)/banking/rules/page.tsx` (modify) | Loads the register and renders the section. |
| `app/(app)/banking/imports/[id]/ReviewImportClient.tsx` (modify) | Header count of card payments. |
| `scripts/verify-card-loan.mjs` (new) | A rolled-back behavioural check of 0129 on every company. |
| `lib/domain/changelog.ts`, `lib/domain/system-guide.ts` (modify) | Release 1.75 and a guide step. |

---

### Task 1: Migration 0129 — the register table

**Files:**
- Create: `supabase/migrations/0129_repayment_register.sql`
- Create: `tests/unit/repayment-register-migration.test.ts`
- Modify: `lib/domain/company-export.ts` (the `EXPORT_TABLES` list, after `"acc_bank_account"`)

**Interfaces:**
- Produces: table `acc_repayment_account` with the columns `id, kind, account_id, match_words, match_digits, interest_account_id, interest_method, annual_rate, fixed_interest_minor, is_active, created_by, created_at, updated_by, updated_at`.

- [ ] **Step 1: Write the failing static test**

`tests/unit/repayment-register-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/domain/company-export";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0129_repayment_register.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0129 repayment register", () => {
  const sql = body();
  it("keeps one entry per account, a card or a loan", () => {
    expect(sql).toMatch(/create table if not exists acc_repayment_account/i);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/kind\s+text not null check \(kind in \('card', 'loan'\)\)/i);
    expect(sql).toMatch(/account_id\s+uuid not null unique references acc_account \(id\)/i);
    expect(sql).toMatch(/match_digits\s+text check \(match_digits ~ '\^\[0-9\]\{4\}\$'\)/i);
  });
  it("needs words or digits, and keeps interest off a card and on a loan", () => {
    expect(sql).toMatch(/constraint acc_repayment_account_says_how_ck\s+check \(btrim\(match_words\) <> '' or match_digits is not null\)/i);
    expect(sql).toMatch(/constraint acc_repayment_account_card_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_loan_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_rate_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_fixed_ck/i);
  });
  it("is staff-written, viewer-readable and audited", () => {
    expect(sql).toMatch(/after insert or update or delete on acc_repayment_account\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/before insert or update on acc_repayment_account\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_repayment_account from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_repayment_account to authenticated/i);
  });
  it("travels with the company export", () => {
    expect(EXPORT_TABLES).toContain("acc_repayment_account");
    expect(EXPORT_TABLES.indexOf("acc_repayment_account")).toBeGreaterThan(EXPORT_TABLES.indexOf("acc_account"));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/repayment-register-migration.test.ts`
Expected: FAIL with `ENOENT … 0129_repayment_register.sql`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0129_repayment_register.sql`:

```sql
-- ============================================================================
-- 0129 — Cards and loans: what a payment out of the bank repays.
--
-- Paying a credit card repays a balance; it is never an expense — the costs
-- were the card's own charges. A loan instalment is principal and interest,
-- and only the interest is an expense. Each company lists its cards and loans
-- with the words its bank prints for their payments, or their last four
-- digits; lib/domain/repayments.ts recognises such a line before any rule or
-- history. A card posts through acc_categorise_bank_transaction as before.
-- A loan's interest settings are kept here; the split is posted by a later
-- migration.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_repayment_account (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('card', 'loan')),
  account_id           uuid not null unique references acc_account (id),
  match_words          text not null default '' check (length(match_words) <= 200),
  match_digits         text check (match_digits ~ '^[0-9]{4}$'),
  interest_account_id  uuid references acc_account (id),
  interest_method      text check (interest_method in ('rate', 'fixed', 'entered')),
  annual_rate          numeric(6,3) check (annual_rate >= 0 and annual_rate <= 100),
  fixed_interest_minor bigint check (fixed_interest_minor >= 0),
  is_active            boolean not null default true,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id),
  updated_at           timestamptz not null default now(),
  constraint acc_repayment_account_says_how_ck
    check (btrim(match_words) <> '' or match_digits is not null),
  constraint acc_repayment_account_card_ck
    check (kind <> 'card' or (interest_account_id is null and interest_method is null
                              and annual_rate is null and fixed_interest_minor is null)),
  constraint acc_repayment_account_loan_ck
    check (kind <> 'loan' or (interest_account_id is not null and interest_method is not null)),
  constraint acc_repayment_account_rate_ck
    check (interest_method is distinct from 'rate' or annual_rate is not null),
  constraint acc_repayment_account_fixed_ck
    check (interest_method is distinct from 'fixed' or fixed_interest_minor is not null)
);

drop trigger if exists acc_repayment_account_actor_stamp on acc_repayment_account;
create trigger acc_repayment_account_actor_stamp
  before insert or update on acc_repayment_account
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_repayment_account_atomic_audit on acc_repayment_account;
create trigger acc_repayment_account_atomic_audit
  after insert or update or delete on acc_repayment_account
  for each row execute function acc_audit_row_change();

alter table acc_repayment_account enable row level security;

drop policy if exists acc_repayment_account_sel on acc_repayment_account;
create policy acc_repayment_account_sel on acc_repayment_account
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_repayment_account_ins on acc_repayment_account;
create policy acc_repayment_account_ins on acc_repayment_account
  for insert with check (acc_is_staff());
drop policy if exists acc_repayment_account_upd on acc_repayment_account;
create policy acc_repayment_account_upd on acc_repayment_account
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_repayment_account_del on acc_repayment_account;
create policy acc_repayment_account_del on acc_repayment_account
  for delete using (acc_is_staff());

revoke all on acc_repayment_account from public, anon;
grant select, insert, update, delete on acc_repayment_account to authenticated;
grant all on acc_repayment_account to service_role;
```

- [ ] **Step 4: Add the table to the company export**

In `lib/domain/company-export.ts`, inside `EXPORT_TABLES`, change

```ts
  "acc_bank_account",
  "acc_bank_connection",
```

to

```ts
  "acc_bank_account",
  // Cards and loans (0129): which accounts a bank payment repays.
  "acc_repayment_account",
  "acc_bank_connection",
```

- [ ] **Step 5: Run the static tests and the export tests**

Run: `npx vitest run tests/unit/repayment-register-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/backup-restore.test.ts tests/unit/schema-template.test.ts`
Expected: all PASS. If `schema-template.test.ts` fails, read its message: a new way of naming the schema has to be taught to `retargetToSchema()`. The migration above only uses `set search_path = public`, which it already handles.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0129_repayment_register.sql tests/unit/repayment-register-migration.test.ts lib/domain/company-export.ts
printf '%s\n' "feat(banking): a register of cards and loans (0129)" "" "One entry per liability account, with the words or last four digits the" "bank prints for its payments. Loans carry their interest settings for a" "later release. Exported with the company." > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 2: The pure rules — `lib/domain/repayments.ts`

**Files:**
- Create: `lib/domain/repayments.ts`
- Test: `tests/unit/repayments.test.ts`

**Interfaces:**
- Consumes: `lastFourDigits` from `./bank-pairs.ts`; `wordPattern` from `./bank-rules.ts`; the type `CodingAccount` from `./coding.ts` (`{ id, code, name, type: AccountType, active, posting }`).
- Produces:
  - `type RepaymentKind = "card" | "loan"`;
  - `type InterestMethod = "rate" | "fixed" | "entered"`;
  - `interface RepaymentAccount { id; kind; accountId; matchWords: string; matchDigits: string | null; interestAccountId: string | null; interestMethod: InterestMethod | null; annualRate: number | null; fixedInterestMinor: number | null; isActive: boolean }`;
  - `type RepaymentInput = Omit<RepaymentAccount, "id">`;
  - `interface RepaymentLine { description: string; amountMinor: number; inBaseCurrency: boolean }`;
  - `type RepaymentFact = { kind: "one"; entry: RepaymentAccount } | { kind: "rivals"; count: number }`;
  - `phrasesOf(words): string[]`;
  - `seedWords(accountName): string`;
  - `seedDigits(accountName): string | null`;
  - `repaysAccountAllowed(kind, account): boolean`;
  - `interestAccountAllowed(account): boolean`;
  - `usableRepayment(entry, accounts): boolean`;
  - `repaymentMatches(entry, description): boolean`;
  - `repaymentFor(entries, line, accounts): RepaymentFact | null`;
  - `validateRepaymentInput(input): string | null`;
  - `REPAYMENT_WORDS_MAX = 200`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/repayments.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  interestAccountAllowed,
  phrasesOf,
  repaymentFor,
  repaymentMatches,
  repaysAccountAllowed,
  seedDigits,
  seedWords,
  usableRepayment,
  validateRepaymentInput,
  type RepaymentAccount,
  type RepaymentInput,
} from "@/lib/domain/repayments";

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
    acct("card1", "credit_card"),
    acct("card2", "credit_card"),
    acct("loan1", "long_term_liability"),
    acct("int", "other_expense"),
    acct("rent", "expense"),
    acct("closed", "credit_card", { active: false }),
  ].map((a) => [a.id, a]),
);
const card = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "r1",
  kind: "card",
  accountId: "card1",
  matchWords: "example card",
  matchDigits: "4321",
  interestAccountId: null,
  interestMethod: null,
  annualRate: null,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const loan = (over: Partial<RepaymentAccount> = {}): RepaymentAccount =>
  card({ id: "l1", kind: "loan", accountId: "loan1", matchWords: "example loan", matchDigits: null, interestAccountId: "int", interestMethod: "rate", annualRate: 4, ...over });
const out = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });

describe("phrasesOf", () => {
  it("splits on commas, trims, squeezes spaces and keeps each phrase once", () => {
    expect(phrasesOf(" example card ,EXAMPLE  CARD, card epay,, ")).toEqual(["example card", "card epay"]);
    expect(phrasesOf("")).toEqual([]);
  });
});

describe("defaults from the account name", () => {
  it("takes the name without its trailing digits as the words", () => {
    expect(seedWords("Example Card 4321")).toBe("Example Card");
    expect(seedWords("Example Visa ••4321")).toBe("Example Visa");
    expect(seedWords("Example Card x3388")).toBe("Example Card");
    expect(seedWords("Example Loan")).toBe("Example Loan");
  });
  it("takes the last four digits in the name, when there are any", () => {
    expect(seedDigits("Example Card 4321")).toBe("4321");
    expect(seedDigits("Example Card x3388")).toBe("3388");
    expect(seedDigits("Example Loan")).toBeNull();
  });
});

describe("which accounts an entry may use", () => {
  it("lets a card repay only an active posting credit card account", () => {
    expect(repaysAccountAllowed("card", accounts.get("card1"))).toBe(true);
    expect(repaysAccountAllowed("card", accounts.get("loan1"))).toBe(false);
    expect(repaysAccountAllowed("card", accounts.get("closed"))).toBe(false);
    expect(repaysAccountAllowed("card", undefined)).toBe(false);
  });
  it("lets a loan repay a current or long-term liability, and charge interest to an expense", () => {
    expect(repaysAccountAllowed("loan", accounts.get("loan1"))).toBe(true);
    expect(repaysAccountAllowed("loan", accounts.get("card1"))).toBe(false);
    expect(interestAccountAllowed(accounts.get("int"))).toBe(true);
    expect(interestAccountAllowed(accounts.get("rent"))).toBe(true);
    expect(interestAccountAllowed(accounts.get("loan1"))).toBe(false);
  });
  it("counts an entry only while it is on and its accounts are still the right kind", () => {
    expect(usableRepayment(card(), accounts)).toBe(true);
    expect(usableRepayment(card({ isActive: false }), accounts)).toBe(false);
    expect(usableRepayment(card({ accountId: "closed" }), accounts)).toBe(false);
    expect(usableRepayment(loan(), accounts)).toBe(true);
    expect(usableRepayment(loan({ interestAccountId: "loan1" }), accounts)).toBe(false);
  });
});

describe("repaymentMatches", () => {
  it("finds a phrase held to word boundaries, in any case", () => {
    expect(repaymentMatches(card({ matchDigits: null }), "EXAMPLE CARD EPAY 0928")).toBe(true);
    expect(repaymentMatches(card({ matchDigits: null }), "EXAMPLECARDS")).toBe(false);
  });
  it("finds the last four only as a run of exactly four digits", () => {
    expect(repaymentMatches(card({ matchWords: "" }), "Payment to card ending in 4321")).toBe(true);
    expect(repaymentMatches(card({ matchWords: "" }), "REF 143210")).toBe(false);
  });
  it("matches any one of several phrases", () => {
    expect(repaymentMatches(card({ matchWords: "example card, xyz bank epay", matchDigits: null }), "XYZ BANK EPAY")).toBe(true);
  });
});

describe("repaymentFor", () => {
  it("names the one entry a payment out repays", () => {
    expect(repaymentFor([card()], out("EXAMPLE CARD EPAY"), accounts)).toEqual({ kind: "one", entry: card() });
  });
  it("ignores money in, a foreign-currency bank, an entry switched off and an unusable account", () => {
    expect(repaymentFor([card()], out("EXAMPLE CARD REFUND", 50000), accounts)).toBeNull();
    expect(repaymentFor([card()], { ...out("EXAMPLE CARD EPAY"), inBaseCurrency: false }, accounts)).toBeNull();
    expect(repaymentFor([card({ isActive: false })], out("EXAMPLE CARD EPAY"), accounts)).toBeNull();
    expect(repaymentFor([card({ accountId: "closed" })], out("EXAMPLE CARD EPAY"), accounts)).toBeNull();
  });
  it("refuses to choose when two entries claim the line", () => {
    const other = card({ id: "r2", accountId: "card2", matchWords: "epay", matchDigits: null });
    expect(repaymentFor([card(), other], out("EXAMPLE CARD EPAY"), accounts)).toEqual({ kind: "rivals", count: 2 });
  });
  it("says nothing when no entry matches", () => {
    expect(repaymentFor([card()], out("METRO REALTY RENT"), accounts)).toBeNull();
  });
});

describe("validateRepaymentInput", () => {
  const input = (over: Partial<RepaymentInput> = {}): RepaymentInput => {
    const { id: _id, ...rest } = card();
    return { ...rest, ...over };
  };
  it("accepts a card with words, digits or both", () => {
    expect(validateRepaymentInput(input())).toBeNull();
    expect(validateRepaymentInput(input({ matchWords: "" }))).toBeNull();
    expect(validateRepaymentInput(input({ matchDigits: null }))).toBeNull();
  });
  it("needs words or digits, and exactly four digits", () => {
    expect(validateRepaymentInput(input({ matchWords: " , ", matchDigits: null }))).toBe(
      "Give the words your bank prints for these payments, or the last four digits",
    );
    expect(validateRepaymentInput(input({ matchDigits: "432" }))).toBe("The last four are exactly four digits");
    expect(validateRepaymentInput(input({ matchWords: "x".repeat(201) }))).toBe("Words are at most 200 characters");
    expect(validateRepaymentInput(input({ accountId: "" }))).toBe("Choose the card account");
  });
  it("keeps interest off a card", () => {
    expect(validateRepaymentInput(input({ interestMethod: "rate" }))).toBe("A card payment has no interest to split");
  });
  it("needs a loan's interest account and method, a rate within 0–100 with three decimals, and a fixed amount", () => {
    const { id: _id, ...base } = loan();
    expect(validateRepaymentInput(base)).toBeNull();
    expect(validateRepaymentInput({ ...base, interestAccountId: null })).toBe("Choose the account interest posts to");
    expect(validateRepaymentInput({ ...base, interestMethod: null })).toBe("Say how the interest is worked out");
    expect(validateRepaymentInput({ ...base, annualRate: 101 })).toBe("The rate a year is between 0 and 100%");
    expect(validateRepaymentInput({ ...base, annualRate: 1.0005 })).toBe("The rate a year has at most three decimals");
    expect(validateRepaymentInput({ ...base, annualRate: 1.005 })).toBeNull();
    expect(validateRepaymentInput({ ...base, interestMethod: "fixed", fixedInterestMinor: null })).toBe("Give the fixed interest per payment");
    expect(validateRepaymentInput({ ...base, interestMethod: "fixed", fixedInterestMinor: 40000 })).toBeNull();
    expect(validateRepaymentInput({ ...base, interestMethod: "entered" })).toBeNull();
  });
});

describe("the repayments module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/repayments.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/repayments.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/domain/repayments"`.

- [ ] **Step 3: Write the module**

`lib/domain/repayments.ts`:

```ts
/**
 * Cards and loans: what a payment out of the bank repays.
 *
 * Paying a card is not a cost — the costs were the card's own charges, already
 * in the books — and a loan instalment is principal plus interest, of which
 * only the interest belongs on the Profit and Loss. Each company lists its
 * cards and loans with the words its bank prints for their payments, or their
 * last four digits. A waiting payment out that carries them is that entry's
 * repayment, recognised before any rule or history (coding.ts).
 *
 * One entry or nothing: a line two entries claim gets no proposal at all, the
 * way two open invoices of one amount get none.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import type { AccountType } from "./accounts.ts";
import { lastFourDigits } from "./bank-pairs.ts";
import { wordPattern } from "./bank-rules.ts";
import type { CodingAccount } from "./coding.ts";

export type RepaymentKind = "card" | "loan";
export type InterestMethod = "rate" | "fixed" | "entered";

export interface RepaymentAccount {
  id: string;
  kind: RepaymentKind;
  /** The liability the payment repays. */
  accountId: string;
  /** Phrases the bank prints, comma-separated: "example card, example epay". */
  matchWords: string;
  /** Four digits the bank prints, or null. */
  matchDigits: string | null;
  interestAccountId: string | null;
  interestMethod: InterestMethod | null;
  /** Percent a year: 4.25 is 4.25%. */
  annualRate: number | null;
  fixedInterestMinor: number | null;
  isActive: boolean;
}

export type RepaymentInput = Omit<RepaymentAccount, "id">;

/** A waiting bank line, as recognition needs it. */
export interface RepaymentLine {
  description: string;
  amountMinor: number;
  /** Its bank account is in the company's base currency. */
  inBaseCurrency: boolean;
}

export type RepaymentFact = { kind: "one"; entry: RepaymentAccount } | { kind: "rivals"; count: number };

export const REPAYMENT_WORDS_MAX = 200;
const CARD_ACCOUNT_TYPES: readonly AccountType[] = ["credit_card"];
const LOAN_ACCOUNT_TYPES: readonly AccountType[] = ["current_liability", "long_term_liability"];
const INTEREST_ACCOUNT_TYPES: readonly AccountType[] = ["expense", "other_expense"];

/** The phrases of a words field: trimmed, inner spaces squeezed, blanks dropped, each once. */
export function phrasesOf(words: string): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const raw of words.split(",")) {
    const phrase = raw.trim().replace(/\s+/g, " ");
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

/** "Example Card 4321" → "Example Card": the name without its trailing number. */
export function seedWords(accountName: string): string {
  return accountName.replace(/\s+[•*#.(]*x?\d{2,}\)?\s*$/i, "").trim();
}

/** The last four digits in an account's name, if it has any. */
export function seedDigits(accountName: string): string | null {
  return lastFourDigits(accountName);
}

const allowed = (types: readonly AccountType[], account: CodingAccount | undefined) =>
  Boolean(account && account.active && account.posting && types.includes(account.type));

/** Whether an account can be what an entry of this kind repays. */
export function repaysAccountAllowed(kind: RepaymentKind, account: CodingAccount | undefined): boolean {
  return allowed(kind === "card" ? CARD_ACCOUNT_TYPES : LOAN_ACCOUNT_TYPES, account);
}

/** Whether a loan's interest may post to this account. */
export function interestAccountAllowed(account: CodingAccount | undefined): boolean {
  return allowed(INTEREST_ACCOUNT_TYPES, account);
}

/** An entry that can speak: switched on, and its accounts still the kind it needs. */
export function usableRepayment(entry: RepaymentAccount, accounts: ReadonlyMap<string, CodingAccount>): boolean {
  if (!entry.isActive || !repaysAccountAllowed(entry.kind, accounts.get(entry.accountId))) return false;
  return entry.kind === "card" || interestAccountAllowed(accounts.get(entry.interestAccountId ?? ""));
}

/** Whether a description carries one of the entry's phrases, or its last four as a run of exactly four digits. */
export function repaymentMatches(entry: Pick<RepaymentAccount, "matchWords" | "matchDigits">, description: string): boolean {
  const digits = entry.matchDigits;
  if (digits && /^\d{4}$/.test(digits) && new RegExp(`(^|\\D)${digits}(\\D|$)`).test(description)) return true;
  return phrasesOf(entry.matchWords).some((phrase) => wordPattern(phrase).test(description));
}

/** The one entry a waiting payment out repays, how many claim it when several do, or nothing. */
export function repaymentFor(
  entries: readonly RepaymentAccount[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RepaymentFact | null {
  if (line.amountMinor >= 0 || !line.inBaseCurrency) return null;
  const hits = entries.filter((entry) => usableRepayment(entry, accounts) && repaymentMatches(entry, line.description));
  if (hits.length === 0) return null;
  return hits.length === 1 ? { kind: "one", entry: hits[0] } : { kind: "rivals", count: hits.length };
}

/**
 * What is wrong with an entry as typed, or null. Whether its accounts are of
 * the right kind is checked against the chart by the service.
 */
export function validateRepaymentInput(input: RepaymentInput): string | null {
  if (input.kind !== "card" && input.kind !== "loan") return "Say whether this is a card or a loan";
  if (!input.accountId) return input.kind === "card" ? "Choose the card account" : "Choose the loan account";
  if (input.matchWords.length > REPAYMENT_WORDS_MAX) return `Words are at most ${REPAYMENT_WORDS_MAX} characters`;
  if (input.matchDigits !== null && !/^\d{4}$/.test(input.matchDigits)) return "The last four are exactly four digits";
  if (phrasesOf(input.matchWords).length === 0 && input.matchDigits === null) {
    return "Give the words your bank prints for these payments, or the last four digits";
  }
  if (input.kind === "card") {
    const hasInterest =
      input.interestAccountId !== null || input.interestMethod !== null || input.annualRate !== null || input.fixedInterestMinor !== null;
    return hasInterest ? "A card payment has no interest to split" : null;
  }
  if (!input.interestAccountId) return "Choose the account interest posts to";
  if (input.interestMethod === null) return "Say how the interest is worked out";
  if (input.interestMethod === "rate") {
    const rate = input.annualRate;
    if (rate === null || !(rate >= 0 && rate <= 100)) return "The rate a year is between 0 and 100%";
    if (Math.abs(rate * 1000 - Math.round(rate * 1000)) > 1e-6) return "The rate a year has at most three decimals";
  }
  if (input.interestMethod === "fixed") {
    const fixed = input.fixedInterestMinor;
    if (fixed === null || !Number.isInteger(fixed) || fixed < 0) return "Give the fixed interest per payment";
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/repayments.test.ts`
Expected: PASS (all). If `seedWords("Example Visa ••4321")` fails, check that the file is saved as UTF-8: the `•` in the character class must survive.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/repayments.ts tests/unit/repayments.test.ts
printf '%s\n' "feat(banking): recognise a card or loan payment by its words or last four" "" "One entry or nothing: a line two entries claim gets no proposal." > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 3: The `card` suggestion in `suggestCoding`

**Files:**
- Modify: `lib/domain/coding.ts` (the `CodingSuggestion` type, `suggestCoding`, `CodingSuggestionView`, `codingView`, the header comment)
- Test: `tests/unit/coding.test.ts`

**Interfaces:**
- Consumes: `RepaymentFact` (type) from Task 2.
- Produces:
  - `suggestCoding({ line, rules, index, accounts, hasMatch, repayment? })`. `repayment?: RepaymentFact | null`.
  - `CodingSuggestion` gains `{ source: "card"; accountId: string; repaymentId: string }`.
  - `CodingSuggestionView.source` is `"rule" | "history" | "card"`.
  - For a card, `codingView` returns `short: "Card"` and `why: "Card payment — repays <code> <name>. A card payment is never an expense."`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/coding.test.ts`. Extend the imports:

```ts
import type { RepaymentAccount } from "@/lib/domain/repayments";
```

Add after the existing `describe("suggestCoding", …)` block:

```ts
describe("suggestCoding with cards and loans", () => {
  const withCard = new Map<string, CodingAccount>([...accounts, ["card1", account("card1", { type: "credit_card", name: "Example Card" })]]);
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
  it("puts a card ahead of a rule and of history", () => {
    const s = suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "one", entry: entry() } });
    expect(s).toEqual({ source: "card", accountId: "card1", repaymentId: "rp1" });
  });
  it("lets a loan, or two entries, silence rule and history", () => {
    const loan = entry({ kind: "loan", interestAccountId: "rent", interestMethod: "entered" });
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "one", entry: loan } })).toBeNull();
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "rivals", count: 2 } })).toBeNull();
  });
  it("still says nothing on a line that already has a match to the ledger", () => {
    expect(suggestCoding({ line, rules: [], index: history, accounts: withCard, hasMatch: true, repayment: { kind: "one", entry: entry() } })).toBeNull();
  });
  it("says why in the screen's words", () => {
    const view = codingView(line, { source: "card", accountId: "card1", repaymentId: "rp1" }, withCard.get("card1")!);
    expect(view).toEqual({
      transactionId: "t1",
      accountId: "card1",
      accountLabel: "CARD1 — Example Card",
      source: "card",
      short: "Card",
      why: "Card payment — repays CARD1 Example Card. A card payment is never an expense.",
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/coding.test.ts`
Expected: FAIL. The card case returns the rule suggestion `{ source: "rule", … }`, and TypeScript reports that `repayment` is not a known property. Vitest does not typecheck, so the failure you will see is the assertion.

- [ ] **Step 3: Implement**

In `lib/domain/coding.ts`:

1. Header comment, replace the paragraph's first sentence:

```ts
 * In order: a line already matched to the ledger gets none (coding it would
 * post a second entry for money already in the books, and
 * acc_categorise_bank_transaction refuses it anyway); then a registered card
 * (repayments.ts) — a loan, or a line two cards or loans claim, gets no
 * single-account suggestion at all; then the first rule that matches; then
 * history; then nothing. Only an account a line can properly be
```

2. Add the import below the existing ones:

```ts
import type { RepaymentFact } from "./repayments.ts";
```

3. Replace the `CodingSuggestion` type:

```ts
export type CodingSuggestion =
  | { source: "card"; accountId: string; repaymentId: string }
  | { source: "rule"; accountId: string; ruleId: string; ruleNumber: number; ruleText: string }
  | { source: "history"; accountId: string; hits: number; of: number; key: string };
```

4. In `suggestCoding`, add `repayment` to the input and handle it right after `hasMatch`:

```ts
export function suggestCoding(input: {
  line: CodingLine;
  rules: readonly BankRule[];
  index: HistoryIndex;
  accounts: ReadonlyMap<string, CodingAccount>;
  hasMatch: boolean;
  /** What the register says this line repays (repayments.ts), when it says anything. */
  repayment?: RepaymentFact | null;
}): CodingSuggestion | null {
  const { line, rules, index, accounts, hasMatch, repayment } = input;
  if (hasMatch) return null;
  const usable = (accountId: string) => codableAccount(accounts.get(accountId));

  // What the person registered outranks what is inferred. A loan's split, or a
  // line two entries claim, is not one account — rule and history stay silent.
  if (repayment) {
    if (repayment.kind === "one" && repayment.entry.kind === "card" && usable(repayment.entry.accountId)) {
      return { source: "card", accountId: repayment.entry.accountId, repaymentId: repayment.entry.id };
    }
    return null;
  }

  const ordered = [...rules].sort((a, b) => a.position - b.position);
```

(The rest of the function is unchanged.)

5. `CodingSuggestionView.source`:

```ts
  source: "rule" | "history" | "card";
```

6. In `codingView`, before the `if (suggestion.source === "rule")` branch:

```ts
  if (suggestion.source === "card") {
    return {
      transactionId: line.id,
      accountId: suggestion.accountId,
      accountLabel,
      source: "card",
      short: "Card",
      why: `Card payment — repays ${named}. A card payment is never an expense.`,
    };
  }
```

- [ ] **Step 4: Run the coding tests and the typecheck**

Run: `npx vitest run tests/unit/coding.test.ts tests/unit/coding-service.test.ts && npm run typecheck`
Expected: PASS, and typecheck reports 0 errors. `CategoriseCell.tsx` already shows `→ <account>` for any source other than history, so it needs no change.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/coding.ts tests/unit/coding.test.ts
printf '%s\n' "feat(banking): a registered card speaks before rules and history" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 4: Review import — the card label and the "N cards or loans" refusal

**Files:**
- Modify: `lib/domain/statement-review.ts` (header comment, `ReviewProposal` account variant, `reviewProposal`)
- Test: `tests/unit/statement-review-cards.test.ts` (new)

**Interfaces:**
- Consumes: `CodingSuggestionView` with `source: "card"` (Task 3).
- Produces:
  - `reviewProposal` takes `repaymentRivals?: number`.
  - The account proposal gains `repayment?: "card"`.
  - A card proposal's `label` is `` `Card payment · ${accountLabel}` ``.

- [ ] **Step 1: Write the failing tests**

`tests/unit/statement-review-cards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -50000, currencyCode: "USD" };
const card: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-card",
  accountLabel: "2050 — Example Card",
  source: "card",
  short: "Card",
  why: "Card payment — repays 2050 Example Card. A card payment is never an expense.",
};
const funding = {
  kind: "funding" as const,
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by …",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};

describe("reviewProposal with cards", () => {
  it("labels a card payment as one, marks it, and ticks it", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: card });
    expect(p).toEqual({ kind: "account", accountId: "acct-card", label: "Card payment · 2050 — Example Card", why: card.why, repayment: "card" });
    expect(startsTicked(p)).toBe(true);
  });
  it("keeps a funding pair beside a card as the second choice", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: card, pair: funding });
    expect(p).toMatchObject({ kind: "account", repayment: "card", alternative: funding });
  });
  it("refuses to choose when two cards or loans claim the line", () => {
    expect(reviewProposal({ line, match: null, documents: [], coding: null, repaymentRivals: 2 })).toEqual({
      kind: "none",
      why: "Matches 2 cards or loans — code it yourself",
    });
  });
  it("lets a document and a named transfer speak before the refusal", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 50000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line, match: null, documents: [doc], coding: null, repaymentRivals: 2 }).kind).toBe("document");
    const named = { accountId: "acct-savings", label: "Transfer to Sample Savings · 1020", why: "Reads as a transfer…" };
    expect(reviewProposal({ line, match: null, documents: [], coding: null, namedTransfer: named, repaymentRivals: 2 }).kind).toBe("account");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement-review-cards.test.ts`
Expected: FAIL. The label is `"2050 — Example Card"` with no `repayment`, and the rivals case returns `kind: "none"` with the generic "Nothing to go on yet" text.

- [ ] **Step 3: Implement**

In `lib/domain/statement-review.ts`:

1. Header comment, replace "then a rule or history (1.70)." with:

```ts
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75), or nothing when two cards or loans claim the line;
 * then a rule or history (1.70).
```

2. The account variant of `ReviewProposal`:

```ts
  | { kind: "account"; accountId: string; label: string; why: string; alternative?: ReviewPairView; repayment?: "card" }
```

3. Add `repaymentRivals` to the input and destructuring:

```ts
  /** Another of the company's bank accounts this line names as a transfer. */
  namedTransfer?: { accountId: string; label: string; why: string } | null;
  /** How many registered cards or loans claim this line, when more than one does. */
  repaymentRivals?: number;
}): ReviewProposal {
  const { line, match, documents, coding, pair, pairRivals, namedTransfer, repaymentRivals } = input;
```

4. Between the `namedTransfer` branch and the `// Funding is only ever a suggestion` comment:

```ts
  // Two registered cards or loans claim this line: which balance it repays is
  // a person's call, and a rule or history must not guess it as a cost.
  if (repaymentRivals && repaymentRivals > 1) {
    return { kind: "none", why: `Matches ${repaymentRivals} cards or loans — code it yourself` };
  }
```

5. Replace the `if (coding) { … }` block:

```ts
  if (coding) {
    const isCard = coding.source === "card";
    const proposal = {
      kind: "account" as const,
      accountId: coding.accountId,
      label: isCard ? `Card payment · ${coding.accountLabel}` : coding.accountLabel,
      why: coding.why,
      ...(isCard ? { repayment: "card" as const } : {}),
    };
    return funding ? { ...proposal, why: `${coding.why}. Also: ${funding.also}`, alternative: funding } : proposal;
  }
```

- [ ] **Step 4: Run all the review tests**

Run: `npx vitest run tests/unit/statement-review-cards.test.ts tests/unit/statement-review.test.ts tests/unit/statement-review-pairs.test.ts`
Expected: PASS. The two older files must pass unchanged: a rule or history proposal still has no `repayment` key and keeps `accountLabel` as its label.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/statement-review.ts tests/unit/statement-review-cards.test.ts
printf '%s\n' "feat(banking): Review import names card payments and refuses to guess between two" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 5: Services read the register

**Files:**
- Create: `lib/services/repayment-register.ts`
- Modify: `lib/services/coding.ts` (`CodingInputs`, `suggestionsFrom`, `codingSuggestions`)
- Modify: `lib/services/statement-review.ts` (`loadImportReview`)
- Test: `tests/unit/coding-service.test.ts`

**Interfaces:**
- Consumes: `repaymentFor`, `RepaymentAccount`, `RepaymentKind`, `InterestMethod` (Task 2); `suggestCoding` with `repayment` (Task 3); `reviewProposal` with `repaymentRivals` (Task 4).
- Produces:
  - `class RepaymentError extends Error`;
  - `repaymentFromRow(row): RepaymentAccount`;
  - `listRepayments(sb): Promise<RepaymentAccount[]>`;
  - `interface RepaymentContext { repayments: RepaymentAccount[]; baseCurrencyBankIds: Set<string> }`;
  - `repaymentContext(sb): Promise<RepaymentContext>`;
  - `CodingInputs` gains optional `repayments` and `baseCurrencyBankIds`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/coding-service.test.ts`, after the existing `describe("suggestionsFrom", …)`:

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
  const chart = [acct("rent", "Rent"), acct("card1", "Example Card", { account_type: "credit_card" })];
  const line = txn("t1", "Metro Realty Partners", -420000, { bank_account_id: "bank1" });
  it("proposes the card ahead of history, on a bank in the base currency", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: new Set(["bank1"]) }));
    expect(views[0]).toMatchObject({ accountId: "card1", source: "card", short: "Card" });
  });
  it("leaves a line on a foreign-currency bank to history", () => {
    const views = suggestionsFrom(inputs({ lines: [line], accounts: chart, repayments: [card], baseCurrencyBankIds: new Set() }));
    expect(views[0]).toMatchObject({ accountId: "rent", source: "history" });
  });
  it("gives no suggestion when two entries claim the line", () => {
    const other = { ...card, id: "rp2", accountId: "card2" };
    const twoCards = [...chart, acct("card2", "Other Card", { account_type: "credit_card" })];
    expect(suggestionsFrom(inputs({ lines: [line], accounts: twoCards, repayments: [card, other], baseCurrencyBankIds: new Set(["bank1"]) }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/coding-service.test.ts`
Expected: FAIL. The first case gets `source: "history"`, because the register is ignored.

- [ ] **Step 3: Write `lib/services/repayment-register.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterestMethod, RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { listBankAccounts } from "./banking";
import { readAllPages } from "./paging";

/**
 * Reading the register of cards and loans (migration 0129), and the facts
 * recognition needs beside it. Writing lives in repayments.ts, which reads
 * coding history; this module is kept free of that so coding.ts can use it.
 */
export class RepaymentError extends Error {}
const fail = (message: string) => new RepaymentError(message);

const COLUMNS =
  "id,kind,account_id,match_words,match_digits,interest_account_id,interest_method,annual_rate,fixed_interest_minor,is_active";
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

export interface RepaymentContext {
  repayments: RepaymentAccount[];
  /** Bank accounts in the base currency: only their lines can be repayments. */
  baseCurrencyBankIds: Set<string>;
}

export async function repaymentContext(sb: SupabaseClient): Promise<RepaymentContext> {
  const [repayments, banks, base] = await Promise.all([
    listRepayments(sb),
    listBankAccounts(sb),
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
  ]);
  if (base.error) throw fail(base.error.message);
  const code = (base.data as { code: string } | null)?.code ?? null;
  return {
    repayments,
    baseCurrencyBankIds: new Set(banks.filter((bank) => code !== null && bank.currency_code === code).map((bank) => bank.id)),
  };
}
```

- [ ] **Step 4: Wire `lib/services/coding.ts`**

1. Imports. Add these:

```ts
import { repaymentFor, type RepaymentAccount } from "@/lib/domain/repayments";
import { repaymentContext } from "./repayment-register";
```

2. `CodingInputs` gains two optional fields:

```ts
  /** Lines with a match suggestion to the ledger: they get no coding suggestion. */
  matchedLineIds: ReadonlySet<string>;
  /** The register of cards and loans (0129). */
  repayments?: readonly RepaymentAccount[];
  /** Bank accounts in the base currency; a line elsewhere is never a repayment. */
  baseCurrencyBankIds?: ReadonlySet<string>;
}
```

3. In `suggestionsFrom`, replace the line that calls `suggestCoding`:

```ts
    const repayment = inputs.repayments?.length
      ? repaymentFor(
          inputs.repayments,
          { description: line.description, amountMinor: line.amountMinor, inBaseCurrency: inputs.baseCurrencyBankIds?.has(row.bank_account_id) ?? false },
          accounts,
        )
      : null;
    const suggestion = suggestCoding({ line, rules: inputs.rules, index, accounts, hasMatch: inputs.matchedLineIds.has(row.id), repayment });
```

4. `codingSuggestions` reads the context:

```ts
export async function codingSuggestions(sb: SupabaseClient, bankAccountId: string | null): Promise<CodingSuggestionView[]> {
  const [lines, rules, history, accounts, matches, context] = await Promise.all([
    listBankTransactions(sb, bankAccountId),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
    listSuggestions(sb, bankAccountId),
    repaymentContext(sb),
  ]);
  return suggestionsFrom({
    lines,
    rules,
    history,
    accounts,
    matchedLineIds: new Set(matches.map((match) => match.bank_transaction_id)),
    repayments: context.repayments,
    baseCurrencyBankIds: context.baseCurrencyBankIds,
  });
}
```

- [ ] **Step 5: Wire `lib/services/statement-review.ts`**

1. Imports:

```ts
import { repaymentFor } from "@/lib/domain/repayments";
import { repaymentContext } from "./repayment-register";
```

2. Add `context` to the end of the destructured `Promise.all` and `repaymentContext(sb)` to the end of its array:

```ts
  const [banks, lines, matches, documents, rules, history, accountRows, waiting, preference, baseRow, context] = await Promise.all([
```

```ts
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
    repaymentContext(sb),
  ]);
```

3. Pass the register to `suggestionsFrom`:

```ts
  const coding = new Map(
    suggestionsFrom({
      lines,
      rules,
      history,
      accounts: accountRows,
      matchedLineIds: new Set(bestMatch.keys()),
      repayments: context.repayments,
      baseCurrencyBankIds: context.baseCurrencyBankIds,
    }).map((s) => [s.transactionId, s]),
  );
```

4. Before `return {`, add:

```ts
  // Two cards or loans claiming one line: Review import says so instead of guessing.
  const chart = new Map(accountRows.map((row) => [row.id, codingAccountOf(row)]));
  const inBase = context.baseCurrencyBankIds.has(batch.bank_account_id);
  const repaymentRivalsOf = (row: BankTransactionRow) => {
    const fact = repaymentFor(
      context.repayments,
      { description: row.description ?? "", amountMinor: Number(row.amount_minor), inBaseCurrency: inBase },
      chart,
    );
    return fact?.kind === "rivals" ? fact.count : 0;
  };
```

5. In the `reviewProposal({ … })` call, after `namedTransfer: namedFor(row),`:

```ts
          repaymentRivals: repaymentRivalsOf(row),
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/coding-service.test.ts tests/unit/banking-paged-reads.test.ts tests/unit/statement-review-service.test.ts && npm run typecheck`
Expected: PASS, and typecheck reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/services/repayment-register.ts lib/services/coding.ts lib/services/statement-review.ts tests/unit/coding-service.test.ts
printf '%s\n' "feat(banking): Bank Transactions and Review import read the card register" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 6: Writing the register — service, schemas, actions

**Files:**
- Create: `lib/services/repayments.ts`
- Modify: `lib/domain/schemas.ts` (after `bankingPreferenceSchema`)
- Modify: `app/(app)/banking/rules/actions.ts`
- Test: `tests/unit/repayments-service.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 (`validateRepaymentInput`, `repaysAccountAllowed`, `interestAccountAllowed`, `repaymentMatches`, `phrasesOf`) and Task 5 (`RepaymentError`, `repaymentContext`); `loadHistory` from `./coding`; `listBankTransactions` from `./banking`.
- Produces:
  - `interface RepaymentStats { past: number; caught: number; waiting: number; missed: { date: string; text: string }[] }`;
  - `repaymentStatsFrom(entry, history, waiting): RepaymentStats`;
  - `repaymentStats(sb, entries): Promise<Record<string, RepaymentStats>>`;
  - `previewRepayment(sb, input): Promise<RepaymentStats>`;
  - `saveRepayment(sb, id, input): Promise<string>`;
  - `deleteRepayment(sb, id): Promise<void>`;
  - schemas `repaymentPreviewSchema` and `repaymentInputSchema` (the latter is `kind: "card"` only in 1.75);
  - actions `previewRepaymentAction(raw)`, `saveRepaymentAction(id, raw)`, `deleteRepaymentAction(id)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/repayments-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { repaymentInputSchema, repaymentPreviewSchema } from "@/lib/domain/schemas";
import { repaymentStatsFrom } from "@/lib/services/repayments";

const entry = { accountId: "card1", matchWords: "example card", matchDigits: "4321" };
const past = (id: string, date: string, text: string, accountId = "card1", direction: "in" | "out" = "out") => ({
  entryId: id,
  date,
  direction,
  accountId,
  texts: [text],
});

describe("repaymentStatsFrom", () => {
  it("counts past payments to the account it catches, and lists the newest it misses", () => {
    const stats = repaymentStatsFrom(
      entry,
      [
        past("1", "2026-01-05", "EXAMPLE CARD EPAY"),
        past("2", "2026-02-05", "Payment to card ending in 4321"),
        past("3", "2026-03-05", "XYZ BANK BILL PAY"),
        past("4", "2026-04-05", "EXAMPLE CARD EPAY", "rent"),
        past("5", "2026-05-05", "EXAMPLE CARD REFUND", "card1", "in"),
      ],
      [],
    );
    expect(stats).toEqual({ past: 3, caught: 2, waiting: 0, missed: [{ date: "2026-03-05", text: "XYZ BANK BILL PAY" }] });
  });
  it("counts waiting payments out on base-currency banks only", () => {
    const stats = repaymentStatsFrom(entry, [], [
      { description: "EXAMPLE CARD EPAY", amountMinor: -100, inBaseCurrency: true },
      { description: "EXAMPLE CARD EPAY", amountMinor: 100, inBaseCurrency: true },
      { description: "EXAMPLE CARD EPAY", amountMinor: -100, inBaseCurrency: false },
    ]);
    expect(stats.waiting).toBe(1);
  });
  it("lists at most ten misses", () => {
    const many = Array.from({ length: 12 }, (_, i) => past(String(i), `2026-01-${String(i + 1).padStart(2, "0")}`, "OTHER"));
    expect(repaymentStatsFrom(entry, many, []).missed).toHaveLength(10);
  });
});

describe("repayment schemas", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("take a card with words, digits or both", () => {
    expect(repaymentInputSchema.safeParse({ kind: "card", accountId: id, matchWords: "example card", matchDigits: "4321", isActive: true }).success).toBe(true);
    expect(repaymentInputSchema.safeParse({ kind: "card", accountId: id, matchWords: "", matchDigits: "4321", isActive: true }).success).toBe(true);
  });
  it("refuse a loan until loans ship, and digits that are not four", () => {
    expect(repaymentInputSchema.safeParse({ kind: "loan", accountId: id, matchWords: "x", matchDigits: null, isActive: true }).success).toBe(false);
    expect(repaymentPreviewSchema.safeParse({ accountId: id, matchWords: "", matchDigits: "12a4" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/repayments-service.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/services/repayments"`.

- [ ] **Step 3: Add the schemas**

In `lib/domain/schemas.ts`, after `bankingPreferenceSchema`:

```ts
/** A card or loan as the preview reads it: the account, and how the bank names its payments. */
export const repaymentPreviewSchema = z.object({
  accountId: z.uuid("Choose the account"),
  matchWords: z.string().max(200, "Words are at most 200 characters"),
  matchDigits: z.string().regex(/^\d{4}$/, "The last four are exactly four digits").nullable(),
});

/** 1.75 registers cards. Loans, with their interest, arrive in 1.76. */
export const repaymentInputSchema = repaymentPreviewSchema.extend({
  kind: z.literal("card"),
  isActive: z.boolean(),
});
```

- [ ] **Step 4: Write `lib/services/repayments.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { codingAccountOf } from "@/lib/domain/coding";
import type { HistorySource } from "@/lib/domain/coding-history";
import {
  interestAccountAllowed,
  phrasesOf,
  repaymentMatches,
  repaysAccountAllowed,
  validateRepaymentInput,
  type RepaymentAccount,
  type RepaymentInput,
} from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { listBankTransactions } from "./banking";
import { loadHistory } from "./coding";
import { RepaymentError, repaymentContext } from "./repayment-register";

/**
 * Cards and loans on Banking › Rules: saving an entry, and how its words do —
 * against the payments already posted to its account, and the lines waiting
 * now. "Catches 12 of 12 past payments" is the check that the words are right.
 */
export interface RepaymentStats {
  /** Finished payments out to this account, one bank leg and this one. */
  past: number;
  caught: number;
  waiting: number;
  /** The newest past payments the words miss, at most ten. */
  missed: { date: string; text: string }[];
}

type WaitingLine = { description: string; amountMinor: number; inBaseCurrency: boolean };

/** Pure: how an entry's words do against past payments to its account and the lines waiting now. */
export function repaymentStatsFrom(
  entry: Pick<RepaymentAccount, "accountId" | "matchWords" | "matchDigits">,
  history: readonly HistorySource[],
  waiting: readonly WaitingLine[],
): RepaymentStats {
  const past = history.filter((source) => source.accountId === entry.accountId && source.direction === "out");
  const missed = past.filter((source) => !source.texts.some((text) => repaymentMatches(entry, text)));
  return {
    past: past.length,
    caught: past.length - missed.length,
    waiting: waiting.filter((line) => line.amountMinor < 0 && line.inBaseCurrency && repaymentMatches(entry, line.description)).length,
    missed: [...missed]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map((source) => ({ date: source.date, text: source.texts[0] ?? "" })),
  };
}

async function statsGround(sb: SupabaseClient): Promise<{ history: HistorySource[]; waiting: WaitingLine[] }> {
  const [history, lines, context] = await Promise.all([loadHistory(sb), listBankTransactions(sb, null), repaymentContext(sb)]);
  const waiting = lines
    .filter((row) => row.status === "unmatched" && !row.pending)
    .map((row) => ({
      description: row.description ?? "",
      amountMinor: Number(row.amount_minor),
      inBaseCurrency: context.baseCurrencyBankIds.has(row.bank_account_id),
    }));
  return { history, waiting };
}

export async function repaymentStats(sb: SupabaseClient, entries: readonly RepaymentAccount[]): Promise<Record<string, RepaymentStats>> {
  if (!entries.length) return {};
  const { history, waiting } = await statsGround(sb);
  return Object.fromEntries(entries.map((entry) => [entry.id, repaymentStatsFrom(entry, history, waiting)]));
}

export async function previewRepayment(
  sb: SupabaseClient,
  input: { accountId: string; matchWords: string; matchDigits: string | null },
): Promise<RepaymentStats> {
  const { history, waiting } = await statsGround(sb);
  return repaymentStatsFrom(input, history, waiting);
}

export async function saveRepayment(sb: SupabaseClient, id: string | null, input: RepaymentInput): Promise<string> {
  const problem = validateRepaymentInput(input);
  if (problem) throw new RepaymentError(problem);
  const chart = new Map((await listAccounts(sb)).map((row) => [row.id, codingAccountOf(row)]));
  if (!repaysAccountAllowed(input.kind, chart.get(input.accountId))) {
    throw new RepaymentError(
      input.kind === "card"
        ? "A card repays an active posting Credit Card account"
        : "A loan repays an active posting current or long-term liability account",
    );
  }
  if (input.kind === "loan" && !interestAccountAllowed(chart.get(input.interestAccountId ?? ""))) {
    throw new RepaymentError("Interest posts to an active posting expense or other expense account");
  }
  const fields = {
    kind: input.kind,
    account_id: input.accountId,
    match_words: phrasesOf(input.matchWords).join(", "),
    match_digits: input.matchDigits,
    interest_account_id: input.kind === "loan" ? input.interestAccountId : null,
    interest_method: input.kind === "loan" ? input.interestMethod : null,
    annual_rate: input.kind === "loan" && input.interestMethod === "rate" ? input.annualRate : null,
    fixed_interest_minor: input.kind === "loan" && input.interestMethod === "fixed" ? input.fixedInterestMinor : null,
    is_active: input.isActive,
  };
  const result = id
    ? await sb.from("acc_repayment_account").update(fields).eq("id", id).select("id").single()
    : await sb.from("acc_repayment_account").insert(fields).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") throw new RepaymentError("This account is already in Cards and loans");
    throw new RepaymentError(result.error.message);
  }
  return (result.data as { id: string }).id;
}

export async function deleteRepayment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_repayment_account").delete().eq("id", id);
  if (error) throw new RepaymentError(error.message);
}
```

- [ ] **Step 5: Add the actions**

In `app/(app)/banking/rules/actions.ts`:

1. Extend the imports:

```ts
import {
  bankingPreferenceSchema,
  bankRuleInputSchema,
  repaymentInputSchema,
  repaymentPreviewSchema,
  rulePreviewInputSchema,
} from "@/lib/domain/schemas";
import { deleteRepayment, previewRepayment, saveRepayment, type RepaymentStats } from "@/lib/services/repayments";
```

2. Append:

```ts
export async function previewRepaymentAction(raw: unknown): Promise<ActionResult<RepaymentStats>> {
  const parsed = repaymentPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid entry" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewRepayment(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function saveRepaymentAction(id: string | null, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = repaymentInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid entry" };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveRepayment(sb, id, {
      ...parsed.data,
      interestAccountId: null,
      interestMethod: null,
      annualRate: null,
      fixedInterestMinor: null,
    });
    refresh();
    return { ok: true, data: { id: saved } };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function deleteRepaymentAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await deleteRepayment(sb, id);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}
```

`guard()` says "You do not have permission to change bank rules". That is the same permission (`canWrite`), and the section sits on the Bank Rules page, so the message stays as it is.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/repayments-service.test.ts && npm run typecheck`
Expected: PASS, and typecheck reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/services/repayments.ts lib/domain/schemas.ts "app/(app)/banking/rules/actions.ts" tests/unit/repayments-service.test.ts
printf '%s\n' "feat(banking): save, delete and preview cards in the register" "" "The preview counts the past payments to the account its words catch, and" "lists the newest it misses." > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 7: The Cards and loans section on Banking › Rules, and the Review import count

**Files:**
- Create: `app/(app)/banking/rules/RepaymentFormModal.tsx`
- Create: `app/(app)/banking/rules/RepaymentsSection.tsx`
- Create: `app/(app)/banking/rules/repayments.module.css`
- Modify: `app/(app)/banking/rules/page.tsx`
- Modify: `app/(app)/banking/imports/[id]/ReviewImportClient.tsx` (the `counts` memo and the header sentence)

**Interfaces:**
- Consumes: the Task 6 actions; `RepaymentStats` (type); `seedWords` and `seedDigits` (Task 2); `listRepayments` (Task 5); `repaymentStats` (Task 6); `usableRepayment` and `repaysAccountAllowed` (Task 2).
- Produces: `RepaymentListRow` (exported from `RepaymentsSection.tsx`) and the default component `RepaymentsSection({ rows, cardAccounts, canWrite })`.

- [ ] **Step 1: Write `repayments.module.css`**

```css
/* The Cards and loans section, between Pairs and the rule list. */
.section {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--ob-border-default);
  border-radius: 8px;
  background: var(--ob-surface-card);
}

.lede {
  margin: 4px 0 12px;
  max-width: 80ch;
}

.preview {
  margin-top: 4px;
}

.missed {
  display: block;
  font-size: 12px;
}
```

- [ ] **Step 2: Write `RepaymentFormModal.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, Modal, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { seedDigits, seedWords } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import { previewRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentFormValues {
  accountId: string | null;
  matchWords: string;
  matchDigits: string;
  isActive: boolean;
}

export const EMPTY_CARD: RepaymentFormValues = { accountId: null, matchWords: "", matchDigits: "", isActive: true };

export function toRepaymentInput(values: RepaymentFormValues) {
  const digits = (values.matchDigits ?? "").trim();
  return {
    kind: "card" as const,
    accountId: values.accountId ?? "",
    matchWords: (values.matchWords ?? "").trim(),
    matchDigits: digits === "" ? null : digits,
    isActive: values.isActive,
  };
}

/**
 * Add or change a card. Choosing the account fills in the words and last four
 * from its name; the preview then says how many past payments to that account
 * those words catch, and which they miss, before anything is saved.
 */
export default function RepaymentFormModal({
  open,
  repaymentId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  repaymentId: string | null;
  initial: RepaymentFormValues;
  /** Credit card accounts not yet registered, plus this entry's own. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RepaymentFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RepaymentStats | null>(null);
  const watched = Form.useWatch([], form) as RepaymentFormValues | undefined;

  const previewKey = useMemo(() => {
    if (!watched?.accountId) return "";
    const { accountId, matchWords, matchDigits } = toRepaymentInput({ ...EMPTY_CARD, ...watched });
    if (!matchWords && !matchDigits) return "";
    if (matchDigits && !/^\d{4}$/.test(matchDigits)) return "";
    return JSON.stringify({ accountId, matchWords, matchDigits });
  }, [watched]);

  useEffect(() => {
    if (!open || !previewKey) return;
    const timer = setTimeout(() => {
      void previewRepaymentAction(JSON.parse(previewKey)).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, previewKey]);

  const options = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [accounts],
  );

  function close() {
    setPreview(null);
    onClose();
  }

  // A new entry takes its words and digits from the account's name, until the person types their own.
  function onValuesChange(changed: Partial<RepaymentFormValues>) {
    if (repaymentId || !("accountId" in changed)) return;
    const account = accounts.find((a) => a.id === changed.accountId);
    if (!account) return;
    if (!form.isFieldTouched("matchWords")) form.setFieldValue("matchWords", seedWords(account.name));
    if (!form.isFieldTouched("matchDigits")) form.setFieldValue("matchDigits", seedDigits(account.name) ?? "");
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveRepaymentAction(repaymentId, toRepaymentInput({ ...EMPTY_CARD, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the card");
      return;
    }
    message.success(repaymentId ? "Card saved" : "Card added");
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={repaymentId ? "Edit card" : "Add card"}
      okText={repaymentId ? "Save card" : "Add card"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item name="accountId" label="Card account" rules={[{ required: true, message: "Choose the card account" }]}>
          <Select showSearch optionFilterProp="label" placeholder="Choose a Credit Card account" options={options} disabled={repaymentId !== null} />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for these payments"
          extra="Separate several with commas. Each is matched as whole words, in any case."
          rules={[{ max: 200, message: "Words are at most 200 characters" }]}
        >
          <Input placeholder="example card, example card epay" />
        </Form.Item>
        <Form.Item
          name="matchDigits"
          label="Last four digits (optional)"
          rules={[{ pattern: /^\d{4}$/, message: "The last four are exactly four digits" }]}
        >
          <Input maxLength={4} inputMode="numeric" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview ? (
        <div className={styles.preview}>
          <Typography.Text strong>
            {preview.past === 0
              ? "No past payments to this account yet"
              : `Catches ${preview.caught} of ${preview.past} past payment${s(preview.past)} to this account`}
            {` · ${preview.waiting} waiting line${s(preview.waiting)}`}
          </Typography.Text>
          {preview.missed.length ? (
            <>
              <Typography.Text type="secondary" className={styles.missed}>
                Missed — add the words these use:
              </Typography.Text>
              {preview.missed.map((miss, i) => (
                <Typography.Text key={`${miss.date}-${i}`} type="secondary" className={styles.missed}>
                  {miss.date} · {miss.text}
                </Typography.Text>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 3: Write `RepaymentsSection.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AccountRow } from "@/lib/db/types";
import type { RepaymentAccount } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import RepaymentFormModal, { EMPTY_CARD, toRepaymentInput, type RepaymentFormValues } from "./RepaymentFormModal";
import { deleteRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentListRow extends RepaymentAccount {
  accountLabel: string;
  /** False when the account is no longer an active posting account of the right type. */
  accountUsable: boolean;
  stats: RepaymentStats;
}

const valuesOf = (entry: RepaymentAccount): RepaymentFormValues => ({
  accountId: entry.accountId,
  matchWords: entry.matchWords,
  matchDigits: entry.matchDigits ?? "",
  isActive: entry.isActive,
});

/**
 * Cards and loans: which payments out of the bank repay a balance. A line that
 * carries an entry's words or last four is offered as a card payment before
 * any rule, because a payment to a card is never an expense.
 */
export default function RepaymentsSection({
  rows,
  cardAccounts,
  canWrite,
}: {
  rows: RepaymentListRow[];
  cardAccounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RepaymentFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const choosable = cardAccounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);

  async function setActive(row: RepaymentListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRepaymentAction(row.id, toRepaymentInput({ ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the card");
      return;
    }
    router.refresh();
  }

  function remove(row: RepaymentListRow) {
    modal.confirm({
      title: "Remove this card?",
      content: `${row.accountLabel}. Lines already posted stay as they are; new ones are no longer recognised as payments to it.`,
      okText: "Remove card",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRepaymentAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not remove the card");
          return;
        }
        message.success("Card removed");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RepaymentListRow> = [
    { title: "Kind", key: "kind", width: COLUMN.ACTION * 2, render: () => <Tag>Card</Tag> },
    {
      title: "Account",
      key: "account",
      width: COLUMN.PICKER + COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or no longer a Credit Card account. Nothing is recognised as a payment to it until it is changed.">
            <Tag color="orange">{row.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      ...flexColumn<RepaymentListRow>({
        title: "Matches on",
        key: "match",
        render: (_: unknown, row: RepaymentListRow) => (
          <Space size={6} wrap>
            {row.matchWords ? <Typography.Text code>{row.matchWords}</Typography.Text> : null}
            {row.matchDigits ? <Typography.Text code>••{row.matchDigits}</Typography.Text> : null}
          </Space>
        ),
      }),
    },
    {
      title: "Past payments caught",
      key: "past",
      width: COLUMN.PICKER,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => (row.stats.past === 0 ? "—" : `${row.stats.caught} of ${row.stats.past}`),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: COLUMN.STATUS,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => row.stats.waiting,
    },
    {
      title: "On",
      key: "active",
      width: COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) => (
        <Switch size="small" checked={row.isActive} disabled={!canWrite} loading={busy === row.id} onChange={(checked) => void setActive(row, checked)} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
            render: (_: unknown, row: RepaymentListRow) => (
              <Space size={2}>
                <IconActionButton label="Edit card" icon={<EditOutlined />} onClick={() => setEditing({ id: row.id, values: valuesOf(row) })} />
                <IconActionButton label="Remove card" icon={<DeleteOutlined />} onClick={() => remove(row)} />
              </Space>
            ),
          } as TableColumnsType<RepaymentListRow>[number],
        ]
      : []),
  ];

  return (
    <section className={styles.section} aria-labelledby="repayments-heading">
      <Typography.Text strong id="repayments-heading">
        Cards and loans
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        A payment to a credit card repays its balance — the costs were the card&apos;s own charges, so the payment is
        never an expense. Add each card with the words your bank prints for its payments, or its last four digits, and
        such a line is offered as a card payment before any rule.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} disabled={cardAccounts.every((a) => taken.has(a.id))} onClick={() => setEditing({ id: null, values: EMPTY_CARD })}>
            Add card
          </Button>
          {cardAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add a Credit Card account in Chart of Accounts first.</Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RepaymentListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No cards yet"
        emptyDescription="Until a card is added here, its payments are suggested by rules and history like any other line."
      />
      <RepaymentFormModal
        open={editing !== null}
        repaymentId={editing?.id ?? null}
        initial={editing?.values ?? EMPTY_CARD}
        accounts={choosable}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </section>
  );
}
```

- [ ] **Step 4: Wire `page.tsx`**

Replace `app/(app)/banking/rules/page.tsx` with:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { fundingAccountAllowed, suggestFundingAccount } from "@/lib/domain/bank-pairs";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { repaysAccountAllowed, usableRepayment } from "@/lib/domain/repayments";
import { listAccounts } from "@/lib/services/accounts";
import { getBankingPreference } from "@/lib/services/banking-preference";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import { listRepayments } from "@/lib/services/repayment-register";
import { repaymentStats } from "@/lib/services/repayments";
import PageHeader from "@/components/PageHeader";
import PairsPreference from "./PairsPreference";
import RepaymentsSection, { type RepaymentListRow } from "./RepaymentsSection";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts, preference, repayments] = await Promise.all([
    getUserRole(),
    listBankRules(sb),
    listAccounts(sb),
    getBankingPreference(sb),
    listRepayments(sb),
  ]);
  const liabilities = accounts
    .filter(fundingAccountAllowed)
    .map((account) => ({ id: account.id, label: `${account.account_code} — ${account.name}` }));
  const [waiting, stats] = await Promise.all([ruleWaitingCounts(sb, rules), repaymentStats(sb, repayments)]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const chart = new Map(accounts.map((account) => [account.id, codingAccountOf(account)]));
  const labelOf = (id: string) => {
    const account = byId.get(id);
    return account ? `${account.account_code} — ${account.name}` : "Account not found";
  };
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
    accountUsable: usableRepayment({ ...entry, isActive: true }, chart),
    stats: stats[entry.id] ?? { past: 0, caught: 0, waiting: 0, missed: [] },
  }));
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="What says which account a bank line belongs to. A card in Cards and loans is recognised first; then the first rule that matches; history speaks only when neither does. Nothing is posted until someone uses a suggestion."
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

- [ ] **Step 5: Count card payments on Review import**

In `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`, add after the `possibleFunding` declaration:

```tsx
  const cardPayments = lines.filter((l) => l.proposal.kind === "account" && l.proposal.repayment === "card").length;
```

In the header sentence, replace

```tsx
          {counts.transfer === 1 ? "" : "s"} · {counts.account} have an account · {possibleFunding} possible funding · {counts.none} need
```

with

```tsx
          {counts.transfer === 1 ? "" : "s"} · {cardPayments} card payment{cardPayments === 1 ? "" : "s"} · {counts.account - cardPayments} have an
          account · {possibleFunding} possible funding · {counts.none} need
```

- [ ] **Step 6: Run the gates that cover UI**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/rsc-antd.test.ts`
Expected: 0 errors. The RSC test passes because `page.tsx` reads no Ant Design sub-component.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/banking/rules/RepaymentFormModal.tsx" "app/(app)/banking/rules/RepaymentsSection.tsx" "app/(app)/banking/rules/repayments.module.css" "app/(app)/banking/rules/page.tsx" "app/(app)/banking/imports/[id]/ReviewImportClient.tsx"
printf '%s\n' "feat(banking): Cards and loans on Banking > Rules; card payments counted on Review import" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 8: `scripts/verify-card-loan.mjs` — 0129 on every company, rolled back

**Files:**
- Create: `scripts/verify-card-loan.mjs`

**Interfaces:**
- Consumes: migration 0129 (Task 1); `acc_categorise_bank_transaction(p_transaction_id uuid, p_account_id uuid) returns jsonb` with `entry_number` (migration 0111).

- [ ] **Step 1: Write the script**

```js
/**
 * Behavioural verification of migration 0129 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0129 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and bank line the checks need is made there
 * too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-card-loan.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0129_repayment_register.sql";
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
        console.log("  (0129 applied inside the transaction, never committed)");
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
      const cardGl = await account("ZZ-VERIFY-CC", "Verify Card 4321", "credit_card");
      const otherCard = await account("ZZ-VERIFY-CD", "Verify Card 8765", "credit_card");
      const loanGl = await account("ZZ-VERIFY-LN", "Verify Loan", "long_term_liability");
      const interest = await account("ZZ-VERIFY-IE", "Verify Interest Expense", "other_expense");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const line = (await one(
        `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
         values ($1, current_date, 'VERIFY CARD EPAY 4321', -12345, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
        [bank],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);

      const insert = `insert into acc_repayment_account
          (kind, account_id, match_words, match_digits, interest_account_id, interest_method, annual_rate, fixed_interest_minor)
        values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`;
      const card = await one(insert, ["card", cardGl, "verify card", "4321", null, null, null, null]);
      check("staff register a card", Boolean(card?.id));
      const loan = await one(insert, ["loan", loanGl, "verify loan", null, interest, "rate", 4.25, null]);
      check("staff register a loan with its interest", Boolean(loan?.id));

      const expectRefusal = async (label, params, pattern) => {
        const message = await refused(insert, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      await expectRefusal("an entry with neither words nor digits is refused", ["card", otherCard, "  ", null, null, null, null, null], /says_how_ck/);
      await expectRefusal("digits that are not four are refused", ["card", otherCard, "x", "876", null, null, null, null], /match_digits_check/);
      await expectRefusal("a card with interest is refused", ["card", otherCard, "x", null, interest, "rate", 4, null], /card_ck/);
      await expectRefusal("a loan without an interest account is refused", ["loan", otherCard, "x", null, null, "entered", null, null], /loan_ck/);
      await expectRefusal("a rate loan without a rate is refused", ["loan", otherCard, "x", null, interest, "rate", null, null], /rate_ck/);
      await expectRefusal("a fixed loan without an amount is refused", ["loan", otherCard, "x", null, interest, "fixed", null, null], /fixed_ck/);
      await expectRefusal("the same account twice is refused", ["card", cardGl, "again", null, null, null, null, null], /duplicate key|unique/);

      await as(OUTSIDER);
      await expectRefusal("someone who is not staff cannot register", ["card", otherCard, "x", null, null, null, null, null], /row-level security/);
      const seen = await one(`select count(*)::int n from acc_repayment_account`);
      check("someone who is not staff reads nothing", seen.n === 0, String(seen.n));
      await as(admin.id);

      // A card payment posts through the existing categorise call to the card account.
      const posted = await one(`select acc_categorise_bank_transaction($1, $2) as r`, [line, cardGl]);
      const legs = (
        await client.query(
          `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr
             from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
            where e.entry_number = $1`,
          [posted.r.entry_number],
        )
      ).rows;
      const cardLeg = legs.find((l) => l.account_id === cardGl);
      const bankLeg = legs.find((l) => l.account_id === gl);
      check("a card payment debits the card and credits the bank", cardLeg?.dr === 12345 && bankLeg?.cr === 12345, JSON.stringify(legs));
      const lineStatus = await one(`select status from acc_bank_transaction where id = $1`, [line]);
      check("the line is matched", lineStatus.status === "matched", lineStatus.status);

      await client.query("reset role");
      const audited = (await one(`select count(*)::int n from acc_audit_log where table_name = 'acc_repayment_account'`)).n;
      check("register changes are in the audit log", audited >= 2, String(audited));
      const stamped = await one(`select created_by from acc_repayment_account where id = $1`, [card.id]);
      check("the creator is stamped by the trigger", stamped.created_by === admin.id, String(stamped.created_by));
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

- [ ] **Step 2: Run it (read-only: every company is rolled back)**

Run: `node --env-file=.env.local scripts/verify-card-loan.mjs`
Expected: `0 failed` on the last line, with 15 `ok` lines for every company that has an administrator. If the Postgres port is blocked from this network, say so and do not claim the check passed.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-card-loan.mjs
printf '%s\n' "test(banking): verify the card and loan register on every company, rolled back" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 9: Changelog 1.75 and the guide step

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first element of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (the `banking` flow, after the Category step)

- [ ] **Step 1: Add the release**

Insert at the top of `RELEASES` in `lib/domain/changelog.ts`:

```ts
  {
    version: "1.75",
    date: "2026-10-01",
    headline: "A payment to a credit card is recognised as one, and never suggested as an expense.",
    changes: [
      {
        kind: "added",
        title: "Cards and loans on Bank Rules",
        detail:
          "Add each credit card with the words your bank prints for its payments, or its last four digits — both are filled in from the account's name. While you type, the form shows how many past payments to that card the words catch and lists the ones they miss.",
        route: "/banking/rules",
      },
      {
        kind: "added",
        title: "Card payments on Review import and Bank Transactions",
        detail:
          "A payment out that carries a card's words or last four is offered as a card payment and posted whole to the card account, before any rule or history — paying a card repays a balance, and the costs were the card's own charges. A line that two cards claim gets no suggestion, so nobody's guess decides which balance it repays.",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: Add the guide step**

In `lib/domain/system-guide.ts`, in the `banking` flow, insert after the step whose `control` is `"Category"`:

```ts
      {
        action: "Tell OneBook which payments repay a credit card",
        control: "Add card",
        route: "/banking/rules",
        note:
          "A payment to a card is never an expense: the costs were the card's own charges. " +
          "Add the card with the words your bank prints for its payments, or its last four " +
          "digits, and such a line is offered as a card payment before any rule or history. " +
          "A line two cards claim gets no suggestion.",
      },
```

- [ ] **Step 3: Run the changelog and guide tests**

Run: `npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts`
Expected: PASS. The routes `/banking/rules` and `/banking` both exist.

- [ ] **Step 4: Commit**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf '%s\n' "docs(changelog): 1.75 card payments; guide step for adding a card" > ../.git/COMMIT_MSG_TMP
git commit -q -F ../.git/COMMIT_MSG_TMP
```

---

### Task 10: Prove it, apply it, show it

No new code. Every step has to report real output.

- [ ] **Step 1: The four gates**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; `Tests  N passed` with **0 failed** (N is the 2,685 tests on main plus this plan's new ones); typecheck and lint report 0 errors. Paste the summary lines, untrimmed.

- [ ] **Step 2: The verify script, before going live**

Run: `node --env-file=.env.local scripts/verify-card-loan.mjs`
Expected: `0 failed`.

- [ ] **Step 3: Ask the user before applying 0129 live**

Say: "Migration 0129 only adds a table (nothing existing changes). Apply it to all six companies?" Wait for yes. Then:

Run: `node --env-file=.env.local scripts/migrate.mjs`
Expected: 0129 applied to every company in the register. Then run `scripts/verify-card-loan.mjs` again and check that every company reports 0129 as already applied: the "(0129 applied inside the transaction…)" note must be gone, and `0 failed`.

- [ ] **Step 4: Smoke against a built server**

Start the build detached (PowerShell, because `npm start` dies under the Bash tool):

```powershell
Start-Process -FilePath "npm" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden
```

Run: `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`
Expected: every page OK, including `/banking/rules`.

- [ ] **Step 5: Live on PC-Test only**

On the sample company PC-Test (`co_pc`, `is_sample = true`):
1. Add `2050 Example Card 4321` (Credit Card) in Chart of Accounts if it has none.
2. Banking › Rules › **Add card**, choose it; words and digits fill themselves in. Save.
3. Import a made-up CSV on `1010 Operating Bank Account` with:
   - `EXAMPLE CARD EPAY`, -250.00;
   - `PAYMENT TO CARD ENDING IN 4321`, -80.00;
   - one ordinary line.
4. On Review import, both card lines read `Card payment · 2050 — Example Card`, are ticked, and the header counts 2 card payments.
5. Post. Each entry debits 2050 and credits 1010.
6. Take both back with **Change** on Bank Transactions, then **Undo import**, as the earlier releases' PC-Test runs did.

- [ ] **Step 6: Screenshots for the user**

Capture Banking › Rules (the section with the card, and the Add card form showing its preview) and Review import, in light and dark, at 1440 and 1280, on PC-Test only. Put them in one local HTML page outside the repository (`C:\Users\pit010\OneBook-1.75-anh-duyet.html`) and ask the user to look before anything is pushed.

- [ ] **Step 7: The acceptance check on the client's book, read-only**

Run this script from the scratchpad directory, never from the repository. Pass the client's schema name as the argument; it is in the private notes. Register each of the book's credit card accounts in memory with its seeded words and digits. Report, per card, "caught N of M" and the missed texts. Then add the words the misses use, and report again. The target is every past card payment caught, and none proposed to an expense account:

```js
// scratchpad/acceptance-cards.mjs — read-only; not committed.
import { createRequire } from "node:module";
const ROOT = "file:///C:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting/";
const require = createRequire(new URL("package.json", ROOT));
const { Client } = require("pg");
const { buildHistoryIndex } = await import(new URL("lib/domain/coding-history.ts", ROOT));
const { codableAccount, codingAccountOf, suggestCoding } = await import(new URL("lib/domain/coding.ts", ROOT));
const { repaymentFor, seedDigits, seedWords } = await import(new URL("lib/domain/repayments.ts", ROOT));

const schema = process.argv[2];
const extraWords = JSON.parse(process.argv[3] ?? "{}"); // {"<account code>": "more, words"}
if (!/^[a-z_][a-z0-9_]*$/.test(schema ?? "")) throw new Error("usage: node acceptance-cards.mjs <schema> [extraWordsJson]");
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin read only");
await c.query(`set local search_path to ${schema}, extensions`);
const chartRows = (await c.query("select id, account_code, name, account_type::text account_type, status::text status, is_posting_account from acc_account")).rows;
const rows = (await c.query("select * from acc_coding_history()")).rows;
await c.query("rollback");
await c.end();

const accounts = new Map(chartRows.map((r) => [r.id, codingAccountOf(r)]));
const sources = rows.map((r) => ({
  entryId: r.entry_id, date: String(r.entry_date), direction: r.direction, accountId: r.account_id,
  texts: [r.bank_description, r.entry_description, r.other_memo].filter((t) => typeof t === "string" && t.trim() !== ""),
}));
const cards = chartRows.filter((r) => r.account_type === "credit_card" && r.status === "active").map((r) => ({
  id: r.id, kind: "card", accountId: r.id,
  matchWords: [seedWords(r.name), extraWords[r.account_code]].filter(Boolean).join(", "),
  matchDigits: seedDigits(r.name), interestAccountId: null, interestMethod: null, annualRate: null, fixedInterestMinor: null, isActive: true,
}));
const index = buildHistoryIndex(sources, (id) => codableAccount(accounts.get(id)));
for (const card of cards) {
  const past = sources.filter((s) => s.accountId === card.accountId && s.direction === "out");
  let caught = 0, expense = 0;
  const missed = [];
  for (const s of past) {
    const text = s.texts[0] ?? "";
    const fact = repaymentFor(cards, { description: text, amountMinor: -1, inBaseCurrency: true }, accounts);
    const suggestion = suggestCoding({ line: { id: s.entryId, amountMinor: -1, description: text, merchantName: null }, rules: [], index, accounts, hasMatch: false, repayment: fact });
    if (suggestion?.accountId === card.accountId) caught += 1; else missed.push(text);
    const type = suggestion ? accounts.get(suggestion.accountId)?.type : null;
    if (type === "expense" || type === "other_expense") expense += 1;
  }
  console.log(`${accounts.get(card.accountId).code}: caught ${caught} of ${past.length}; proposed to an expense ${expense}`);
  for (const m of missed.slice(0, 10)) console.log(`   missed: ${m}`);
}
```

Run: `node --env-file=C:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting/.env.local <scratchpad>/acceptance-cards.mjs <schema>`
Expected: every card reports `proposed to an expense 0`. When something is missed, rerun with `'{"<code>": "<words seen in the misses>"}'` until each card reads `caught M of M`, then report the words needed to the user. Those are the words they will type when registering the real cards. Do not register them on the real company yourself.

- [ ] **Step 8: Push, after the user approves the screenshots**

```bash
git push -u origin feat/card-loan-payments
```

Then tell the user the branch is pushed and ready for a PR. Update the memory file `card-loan-payments-next.md` with what shipped and what the acceptance run found.

---

## Self-review notes

- **Spec coverage (1.75 half):**
  - Register fields, defaults and audit: Tasks 1, 2, 6 and 7.
  - Recognition (words, digits, money out, base currency, usability, rivals): Task 2.
  - Precedence on Bank Transactions and Review import: Tasks 3, 4 and 5.
  - Card label, ticking and Code all: Tasks 3 and 4. Code all follows from the `card` source being a `CodingSuggestionView`.
  - The rules screen with the past-payments-caught preview: Tasks 6 and 7.
  - The header count: Task 7.
  - Verify: Task 8. Changelog and guide: Task 9.
  - PC-Test run, screenshots and the acceptance check on the client's book: Task 10.
- **Deferred to the 1.76 plan:** interest estimation, `acc_post_bank_loan_payment` (0130), the Split… dialog, Add loan, the interest column, and the `loan` post item.
- **Beyond the spec:** the register joins `EXPORT_TABLES`, so a company export carries it. Bank rules, the banking preference and bank categories are not exported today. That is an existing gap, to report to the user, not to fix here.
