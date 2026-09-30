# Transfers and Shareholder Funding Pairs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review import recognises a transfer between two of the company's bank accounts and a shareholder funding pair, proposes them with the reason, and posts a pair in one database call whose entry says what the pair was.

**Architecture:** A pure pairing module (`lib/domain/bank-pairs.ts`) finds unambiguous pairs among every waiting line; `statement-review.ts` turns them into proposals in the agreed order; migration 0127 adds a one-row banking preference, `acc_post_bank_pair`, and a Change that releases every line of a voided entry; the Rules page sets the preference.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, Zod 4, Supabase Postgres, Vitest, `pg`.

**Spec:** `docs/superpowers/specs/2026-09-30-bank-pairs-design.md`. Branch `feat/bank-pairs` from `main` at 1.71. Release **1.72**.

## Global Constraints

- Nothing is posted without a person's click. A funding pair **never** starts ticked; a transfer pair and a named transfer start ticked.
- Proposal order: handled → ledger match → one open document (two or more: no proposal, nothing below consulted) → transfer pair → named transfer → rule → history (with the funding pair as an alternative choice) → funding pair → rival pairs ("N lines could be the other side") → needs coding.
- A pair is offered only when each line is the other's **only** candidate: opposite signs, equal absolute amount, dates at most the window apart. Transfers: different bank accounts. Funding: the **same** bank account. Lines with a pending flag, a suggested ledger match, or an open document of exactly their amount never pair. Only bank accounts in the base currency pair.
- Window options `0, 1, 3, 7, 14, 30`, default **7**. The funding account is an active posting account of type `current_liability` or `long_term_liability`, chosen once per company; with none chosen, no funding pair is proposed.
- `acc_post_bank_pair`: transfer = one entry dated the money-out line, Dr receiving bank / Cr paying bank, both lines reconciled and matched; funding = two entries on the preference's funding account (never the caller's), each description `<description>, answered by <other description> on <other date>`.
- `acc_uncategorise_bank_transaction` releases every line reconciled to the voided entry.
- Migration 0127 goes live only with the user's approval. US English UI, no hex colours, `DataTable`, paged reads. Stage by name, no trailer, `printf` messages. Invented fixtures only. Write files with backslashes via Write/Edit.

---

### Task 1: Finding pairs

**Files:** Create `ctyhp-accounting/lib/domain/bank-pairs.ts`; Test `ctyhp-accounting/tests/unit/bank-pairs.test.ts`.

**Produces:** `PAIR_WINDOW_OPTIONS`, `DEFAULT_PAIR_WINDOW`, `PairLine`, `PairFact`, `daysApart`, `findBankPairs(lines, windowDays, { fundingEnabled })`, `PairBank`, `lastFourDigits(...values)`, `namedTransferTarget(line, banks)`, `FUNDING_ACCOUNT_TYPES`, `FundingCandidate`, `fundingAccountAllowed`, `suggestFundingAccount(accounts)`.

- [ ] **Step 1: Failing test** — `tests/unit/bank-pairs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  daysApart,
  DEFAULT_PAIR_WINDOW,
  findBankPairs,
  fundingAccountAllowed,
  lastFourDigits,
  namedTransferTarget,
  PAIR_WINDOW_OPTIONS,
  suggestFundingAccount,
  type PairBank,
  type PairLine,
} from "@/lib/domain/bank-pairs";

const line = (id: string, bankAccountId: string, txnDate: string, amountMinor: number, description = id): PairLine => ({
  id,
  bankAccountId,
  txnDate,
  amountMinor,
  description,
});

describe("daysApart", () => {
  it("counts whole days either way", () => {
    expect(daysApart("2026-09-30", "2026-10-02")).toBe(2);
    expect(daysApart("2026-10-02", "2026-09-30")).toBe(2);
    expect(daysApart("2026-09-30", "2026-09-30")).toBe(0);
  });
});

describe("findBankPairs", () => {
  it("pairs money out of one account with the same money into another as a transfer", () => {
    const facts = findBankPairs([line("out", "chk", "2026-09-10", -100000), line("in", "sav", "2026-09-11", 100000)], 7, { fundingEnabled: true });
    expect(facts.get("out")).toMatchObject({ kind: "transfer", counterpart: { id: "in" } });
    expect(facts.get("in")).toMatchObject({ kind: "transfer", counterpart: { id: "out" } });
  });
  it("pairs a deposit and a payment of the same amount on one account as funding, when funding is on", () => {
    const lines = [line("wire", "chk", "2026-02-09", 38994147), line("cheque", "chk", "2026-02-11", -38994147)];
    expect(findBankPairs(lines, 7, { fundingEnabled: true }).get("cheque")).toMatchObject({ kind: "funding", counterpart: { id: "wire" } });
    expect(findBankPairs(lines, 7, { fundingEnabled: false }).size).toBe(0);
  });
  it("offers nothing outside the window, or for two lines going the same way", () => {
    expect(findBankPairs([line("a", "chk", "2026-09-01", -500), line("b", "sav", "2026-09-20", 500)], 7, { fundingEnabled: true }).size).toBe(0);
    expect(findBankPairs([line("a", "chk", "2026-09-01", -500), line("b", "sav", "2026-09-02", -500)], 7, { fundingEnabled: true }).size).toBe(0);
  });
  it("offers no pair when a line has two candidates, and says how many", () => {
    const facts = findBankPairs(
      [line("out", "chk", "2026-09-10", -100000), line("in1", "sav", "2026-09-11", 100000), line("in2", "mm", "2026-09-12", 100000)],
      7,
      { fundingEnabled: true },
    );
    expect(facts.get("out")).toEqual({ kind: "ambiguous", rivals: 2 });
    expect(facts.get("in1")?.kind).not.toBe("transfer");
  });
  it("never uses a line twice, and never offers a transfer pair as funding", () => {
    const facts = findBankPairs(
      [line("out", "chk", "2026-09-10", -100000), line("in", "sav", "2026-09-10", 100000), line("dep", "chk", "2026-09-10", 100000)],
      7,
      { fundingEnabled: true },
    );
    // "out" has one transfer candidate ("in") and one funding candidate ("dep"): the transfer wins.
    expect(facts.get("out")).toMatchObject({ kind: "transfer", counterpart: { id: "in" } });
    expect(facts.get("dep")).toBeUndefined();
  });
  it("ignores zero amounts", () => {
    expect(findBankPairs([line("a", "chk", "2026-09-10", 0), line("b", "sav", "2026-09-10", 0)], 7, { fundingEnabled: true }).size).toBe(0);
  });
  it("knows its window options", () => {
    expect(PAIR_WINDOW_OPTIONS).toEqual([0, 1, 3, 7, 14, 30]);
    expect(DEFAULT_PAIR_WINDOW).toBe(7);
  });
});

describe("namedTransferTarget", () => {
  const banks: PairBank[] = [
    { id: "chk", glAccountId: "gl-chk", label: "Sample Bank · 1010", accountName: "Operating Bank Account", digits: "4821" },
    { id: "sav", glAccountId: "gl-sav", label: "Sample Savings · 1020", accountName: "Savings Account", digits: "7755" },
  ];
  it("finds the other account by its last four digits, or by its full name", () => {
    expect(namedTransferTarget({ bankAccountId: "chk", description: "ONLINE TRANSFER TO SAVINGS 7755" }, banks)?.id).toBe("sav");
    expect(namedTransferTarget({ bankAccountId: "sav", description: "Online transfer from Operating Bank Account" }, banks)?.id).toBe("chk");
  });
  it("needs a transfer word, and never names the line's own account", () => {
    expect(namedTransferTarget({ bankAccountId: "chk", description: "PAYMENT 7755" }, banks)).toBeNull();
    expect(namedTransferTarget({ bankAccountId: "sav", description: "TRANSFER 7755" }, banks)).toBeNull();
  });
  it("reads the last four digits from a masked number or a name", () => {
    expect(lastFourDigits("••4821")).toBe("4821");
    expect(lastFourDigits(null, "Chase 2859")).toBe("2859");
    expect(lastFourDigits("", "Savings")).toBeNull();
  });
});

describe("the funding account", () => {
  const acct = (id: string, account_code: string, name: string, account_type = "current_liability", status = "active", is_posting_account = true) => ({
    id,
    account_code,
    name,
    account_type,
    status,
    is_posting_account,
  });
  it("is an active posting liability", () => {
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan"))).toBe(true);
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan", "equity"))).toBe(false);
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan", "long_term_liability", "inactive"))).toBe(false);
  });
  it("is suggested by name, first by code", () => {
    const accounts = [
      acct("x", "2100", "Sales Tax Payable"),
      acct("b", "2650", "Loan from Owner", "long_term_liability"),
      acct("a", "2600", "Shareholder Loan"),
    ];
    expect(suggestFundingAccount(accounts)).toBe("a");
    expect(suggestFundingAccount([acct("x", "2100", "Sales Tax Payable")])).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/bank-pairs.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write** `lib/domain/bank-pairs.ts` (Write tool):

```ts
/**
 * Two bank lines that are one movement of money.
 *
 * A transfer between two of the company's own bank accounts shows up twice —
 * money out of one, money in to the other — and coding each half to income or
 * expense would invent both. A deposit answered by a payment of the same amount
 * on the same account is, as often as not, the owner putting money in and
 * taking it out; coded as spending it would "invent a cost and hide a loan".
 *
 * A pair is offered only when it is unambiguous: each line is the other's only
 * candidate. Equal amounts also happen by coincidence, which is why a funding
 * pair is only ever a suggestion (statement-review.ts never ticks it).
 */
export const PAIR_WINDOW_OPTIONS = [0, 1, 3, 7, 14, 30] as const;
export const DEFAULT_PAIR_WINDOW = 7;

export interface PairLine {
  id: string;
  bankAccountId: string;
  txnDate: string;
  amountMinor: number;
  description: string;
}

export type PairFact =
  | { kind: "transfer"; counterpart: PairLine }
  | { kind: "funding"; counterpart: PairLine }
  | { kind: "ambiguous"; rivals: number };

const dayOf = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

export function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(dayOf(a) - dayOf(b)) / 86_400_000);
}

export function findBankPairs(
  lines: readonly PairLine[],
  windowDays: number,
  options: { fundingEnabled: boolean },
): Map<string, PairFact> {
  const facts = new Map<string, PairFact>();
  const bySize = new Map<number, PairLine[]>();
  for (const l of lines) {
    const size = Math.abs(l.amountMinor);
    if (size === 0) continue;
    const group = bySize.get(size) ?? [];
    group.push(l);
    bySize.set(size, group);
  }
  const taken = (l: PairLine) => {
    const kind = facts.get(l.id)?.kind;
    return kind === "transfer" || kind === "funding";
  };
  const candidates = (a: PairLine, sameBank: boolean) =>
    (bySize.get(Math.abs(a.amountMinor)) ?? []).filter(
      (b) =>
        b.id !== a.id &&
        b.amountMinor === -a.amountMinor &&
        (b.bankAccountId === a.bankAccountId) === sameBank &&
        daysApart(a.txnDate, b.txnDate) <= windowDays &&
        !taken(b),
    );

  const pass = (sameBank: boolean, kind: "transfer" | "funding") => {
    for (const a of lines) {
      if (Math.abs(a.amountMinor) === 0 || facts.has(a.id)) continue;
      const mine = candidates(a, sameBank);
      if (mine.length === 1) {
        const [b] = mine;
        const theirs = candidates(b, sameBank);
        if (theirs.length === 1 && theirs[0].id === a.id && !facts.has(b.id)) {
          facts.set(a.id, { kind, counterpart: b });
          facts.set(b.id, { kind, counterpart: a });
          continue;
        }
      }
      if (mine.length > 1) facts.set(a.id, { kind: "ambiguous", rivals: mine.length });
    }
  };

  pass(false, "transfer");
  if (options.fundingEnabled) pass(true, "funding");
  return facts;
}

export interface PairBank {
  id: string;
  glAccountId: string;
  /** "Sample Savings · 1020" */
  label: string;
  /** The ledger account's name, "Savings Account". */
  accountName: string;
  /** Last four digits of the account number, when known. */
  digits: string | null;
}

/** The last four digits of the first value that ends in four digits. */
export function lastFourDigits(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const found = (value ?? "").match(/(\d{4})\D*$/);
    if (found) return found[1];
  }
  return null;
}

const TRANSFER_WORDS = /\b(transfer|xfer|online transfer|internal transfer|book transfer|to savings|from savings)\b/i;

/** The one other bank account a line that reads as a transfer names, if it names exactly one. */
export function namedTransferTarget(line: { bankAccountId: string; description: string }, banks: readonly PairBank[]): PairBank | null {
  const text = line.description ?? "";
  if (!TRANSFER_WORDS.test(text)) return null;
  const own = banks.find((b) => b.id === line.bankAccountId);
  const lower = text.toLowerCase();
  const hits = banks.filter((b) => {
    if (b.id === line.bankAccountId || (own && b.glAccountId === own.glAccountId)) return false;
    const byDigits = b.digits !== null && new RegExp(`(^|\\D)${b.digits}(\\D|$)`).test(text);
    const name = b.accountName.trim().toLowerCase();
    const byName = name.length >= 6 && lower.includes(name);
    return byDigits || byName;
  });
  return hits.length === 1 ? hits[0] : null;
}

export const FUNDING_ACCOUNT_TYPES = ["current_liability", "long_term_liability"] as const;

export interface FundingCandidate {
  id: string;
  account_code: string;
  name: string;
  account_type: string;
  status: string;
  is_posting_account: boolean;
}

export function fundingAccountAllowed(account: FundingCandidate): boolean {
  return (
    (FUNDING_ACCOUNT_TYPES as readonly string[]).includes(account.account_type) &&
    account.status === "active" &&
    account.is_posting_account
  );
}

const FUNDING_NAME =
  /(shareholder|owner|director|member)s?['’]?\s*(loan|advance)|loan\s+from\s+(the\s+)?(shareholder|owner|director)|due\s+to\s+(shareholder|owner|director)/i;

/** The account funding pairs would most likely post to, by its name — offered, never saved on its own. */
export function suggestFundingAccount(accounts: readonly FundingCandidate[]): string | null {
  return (
    [...accounts]
      .filter(fundingAccountAllowed)
      .sort((a, b) => a.account_code.localeCompare(b.account_code))
      .find((a) => FUNDING_NAME.test(a.name))?.id ?? null
  );
}
```

- [ ] **Step 4:** run → PASS. `npx eslint lib/domain/bank-pairs.ts tests/unit/bank-pairs.test.ts`.
- [ ] **Step 5: Commit** `feat(pairs): find transfers and shareholder funding pairs among waiting bank lines`.

---

### Task 2: Pair proposals on Review import

**Files:** Modify `ctyhp-accounting/lib/domain/statement-review.ts`; Test `ctyhp-accounting/tests/unit/statement-review-pairs.test.ts`.

**Produces:** `ReviewPairView { kind: "transfer" | "funding"; counterpartId; label; why; also }`; proposal kinds `transfer` and `funding`; `account` proposals may carry `alternative?: ReviewPairView`; `reviewProposal` input gains `pair?: ReviewPairView | null`, `pairRivals?: number`, `namedTransfer?: { accountId; label; why } | null`; `ReviewPostItem` gains `{ transactionId; kind: "pair"; pairKind: "transfer" | "funding"; counterpartId }`; `startsTicked(p)`, `alternativeValue(p)`, `reciprocalValue(value, lineId)`, `pairKey(item)`, `dedupePairItems(items)`.

- [ ] **Step 1: Failing test** — `tests/unit/statement-review-pairs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import {
  alternativeValue,
  dedupePairItems,
  itemFromValue,
  proposalValue,
  reciprocalValue,
  reviewProposal,
  startsTicked,
  type ReviewPairView,
} from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -100000, currencyCode: "USD" };
const transfer: ReviewPairView = { kind: "transfer", counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "The other side is on Sample Savings", also: "" };
const funding: ReviewPairView = {
  kind: "funding",
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by WIRE IN of the same amount on 2026-02-09",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};
const coding: CodingSuggestionView = { transactionId: "t1", accountId: "acct-6200", accountLabel: "6200 — Salaries", source: "rule", short: "Rule 1", why: 'Rule 1: "payflow" → 6200 Salaries' };
const base = { line, match: null, documents: [], coding: null };

describe("pair proposals", () => {
  it("puts a transfer pair after documents and before rules, ticked", () => {
    const p = reviewProposal({ ...base, coding, pair: transfer });
    expect(p).toMatchObject({ kind: "transfer", counterpartId: "t2", label: transfer.label });
    expect(startsTicked(p)).toBe(true);
  });
  it("lets a named transfer speak before a rule", () => {
    const p = reviewProposal({ ...base, coding, namedTransfer: { accountId: "gl-sav", label: "Transfer to Sample Savings · 1020", why: "Reads as a transfer" } });
    expect(p).toMatchObject({ kind: "account", accountId: "gl-sav" });
  });
  it("keeps a rule, and offers funding as a second choice", () => {
    const p = reviewProposal({ ...base, coding, pair: funding });
    expect(p).toMatchObject({ kind: "account", accountId: "acct-6200" });
    expect(p.why).toBe('Rule 1: "payflow" → 6200 Salaries. Also: possible shareholder funding with WIRE IN on 2026-02-09');
    expect(alternativeValue(p)).toBe("pair:funding:t9");
  });
  it("proposes funding only when nothing else does, and never ticks it", () => {
    const p = reviewProposal({ ...base, pair: funding });
    expect(p).toMatchObject({ kind: "funding", counterpartId: "t9" });
    expect(startsTicked(p)).toBe(false);
  });
  it("says so when several lines could be the other side", () => {
    expect(reviewProposal({ ...base, pairRivals: 2 })).toEqual({ kind: "none", why: "2 lines could be the other side — code it yourself" });
  });
  it("still lets two documents of the same amount silence everything", () => {
    const docs = [1, 2].map((n) => ({ documentId: `d${n}`, documentNumber: `BILL-${n}`, partyName: "Vendor", balanceDueMinor: 100000, currencyCode: "USD", direction: "payable" as const }));
    expect(reviewProposal({ ...base, documents: docs, coding, pair: transfer }).kind).toBe("none");
  });
});

describe("pair values", () => {
  it("round-trips a pair, and gives the other line its own value", () => {
    const value = proposalValue({ kind: "transfer", counterpartId: "t2", label: "", why: "" });
    expect(value).toBe("pair:transfer:t2");
    expect(itemFromValue("t1", value)).toEqual({ transactionId: "t1", kind: "pair", pairKind: "transfer", counterpartId: "t2" });
    expect(reciprocalValue("pair:funding:t9", "t1")).toBe("pair:funding:t1");
    expect(reciprocalValue("account:x", "t1")).toBeNull();
  });
  it("posts a pair once, whichever line carries it", () => {
    const items = dedupePairItems([
      { transactionId: "t1", kind: "pair", pairKind: "transfer", counterpartId: "t2" },
      { transactionId: "t2", kind: "pair", pairKind: "transfer", counterpartId: "t1" },
      { transactionId: "t3", kind: "account", accountId: "a" },
    ]);
    expect(items).toHaveLength(2);
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement** in `lib/domain/statement-review.ts`:
  - after `ReviewDocument`, add:

```ts
/** A pair this line belongs to, in the words the screen shows. */
export interface ReviewPairView {
  kind: "transfer" | "funding";
  counterpartId: string;
  label: string;
  why: string;
  /** The funding pair as a second choice: "possible shareholder funding with …". */
  also: string;
}
```

  - replace the `ReviewProposal` type with:

```ts
export type ReviewProposal =
  | { kind: "handled"; why: string }
  | { kind: "match"; reconciliationId: string; label: string; why: string }
  | { kind: "document"; documentId: string; label: string; why: string }
  | { kind: "transfer"; counterpartId: string; label: string; why: string }
  | { kind: "funding"; counterpartId: string; label: string; why: string }
  | { kind: "account"; accountId: string; label: string; why: string; alternative?: ReviewPairView }
  | { kind: "none"; why: string };
```

  - in `reviewProposal`, add to the input type `pair?: ReviewPairView | null; pairRivals?: number; namedTransfer?: { accountId: string; label: string; why: string } | null;`, destructure them, and replace the tail after the two-documents branch (`if (coding) … return { kind: "none", … }`) with:

```ts
  if (pair?.kind === "transfer") {
    return { kind: "transfer", counterpartId: pair.counterpartId, label: pair.label, why: pair.why };
  }
  if (namedTransfer) return { kind: "account", accountId: namedTransfer.accountId, label: namedTransfer.label, why: namedTransfer.why };
  const funding = pair?.kind === "funding" ? pair : null;
  if (coding) {
    return funding
      ? { kind: "account", accountId: coding.accountId, label: coding.accountLabel, why: `${coding.why}. Also: ${funding.also}`, alternative: funding }
      : { kind: "account", accountId: coding.accountId, label: coding.accountLabel, why: coding.why };
  }
  if (funding) return { kind: "funding", counterpartId: funding.counterpartId, label: funding.label, why: funding.why };
  if (pairRivals && pairRivals > 1) return { kind: "none", why: `${pairRivals} lines could be the other side — code it yourself` };
  return { kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" };
```

  - extend `ReviewPostItem` with `| { transactionId: string; kind: "pair"; pairKind: "transfer" | "funding"; counterpartId: string }`;
  - replace `proposalValue` and `itemFromValue` with:

```ts
export function proposalValue(proposal: ReviewProposal): string | null {
  if (proposal.kind === "match") return `match:${proposal.reconciliationId}`;
  if (proposal.kind === "document") return `document:${proposal.documentId}`;
  if (proposal.kind === "account") return `account:${proposal.accountId}`;
  if (proposal.kind === "transfer" || proposal.kind === "funding") return `pair:${proposal.kind}:${proposal.counterpartId}`;
  return null;
}

/** A funding pair offered beside a rule or history proposal. */
export function alternativeValue(proposal: ReviewProposal): string | null {
  return proposal.kind === "account" && proposal.alternative ? `pair:funding:${proposal.alternative.counterpartId}` : null;
}

/** A funding pair is a suggestion only; everything else with a value starts ticked. */
export function startsTicked(proposal: ReviewProposal): boolean {
  return proposalValue(proposal) !== null && proposal.kind !== "funding";
}

export function itemFromValue(transactionId: string, value: string | null): ReviewPostItem | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts[0] === "pair" && parts.length === 3 && (parts[1] === "transfer" || parts[1] === "funding") && parts[2]) {
    return { transactionId, kind: "pair", pairKind: parts[1], counterpartId: parts[2] };
  }
  const [kind, id] = [parts[0], parts.slice(1).join(":")];
  if (!id) return null;
  if (kind === "match") return { transactionId, kind, reconciliationId: id };
  if (kind === "document") return { transactionId, kind, documentId: id };
  if (kind === "account") return { transactionId, kind, accountId: id };
  return null;
}

/** The value the other line of a pair takes when this one chooses the pair. */
export function reciprocalValue(value: string | null, lineId: string): string | null {
  const parts = (value ?? "").split(":");
  return parts[0] === "pair" && parts.length === 3 ? `pair:${parts[1]}:${lineId}` : null;
}

export function pairKey(item: Extract<ReviewPostItem, { kind: "pair" }>): string {
  return `${item.pairKind}:${[item.transactionId, item.counterpartId].sort().join(":")}`;
}

/** A pair ticked on both of its lines is posted once. */
export function dedupePairItems(items: readonly ReviewPostItem[]): ReviewPostItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== "pair") return true;
    const key = pairKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 4:** run the new test and `tests/unit/statement-review.test.ts` → PASS; eslint.
- [ ] **Step 5: Commit** `feat(pairs): transfer and funding proposals on Review import, posted once per pair`.

---

### Task 3: Migration 0127 and its checks

**Files:** Create `ctyhp-accounting/supabase/migrations/0127_bank_pairs.sql`, `ctyhp-accounting/tests/unit/bank-pairs-migration.test.ts`, `ctyhp-accounting/scripts/verify-bank-pairs.mjs`.

- [ ] **Step 1: Static test** — `tests/unit/bank-pairs-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0127_bank_pairs.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0127 bank pairs", () => {
  const sql = body();
  it("keeps one row of banking preference, staff-written and audited", () => {
    expect(sql).toMatch(/create table if not exists acc_banking_preference/i);
    expect(sql).toMatch(/id\s+boolean primary key default true check \(id\)/i);
    expect(sql).toMatch(/pair_window_days in \(0, 1, 3, 7, 14, 30\)/i);
    expect(sql).toMatch(/after insert or update or delete on acc_banking_preference\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_banking_preference from public, anon/i);
  });
  it("posts a pair in one call, staff only, funding to the preference's account", () => {
    expect(sql).toMatch(/function acc_post_bank_pair\(p_first uuid, p_second uuid, p_kind text\)/i);
    expect(sql).toMatch(/raise exception 'A pair needs two different lines'/i);
    expect(sql).toMatch(/v_fund_id := v_pref\.funding_account_id/i);
    expect(sql).toMatch(/grant execute on function acc_post_bank_pair\(uuid, uuid, text\) to authenticated, service_role/i);
  });
  it("takes a transfer back whole", () => {
    const fn = sql.slice(sql.search(/function acc_uncategorise_bank_transaction/i));
    expect(fn).toMatch(/where r\.journal_line_id = l\.id and l\.journal_entry_id = v_entry/i);
  });
});
```

- [ ] **Step 2: The migration** (Write tool) — `supabase/migrations/0127_bank_pairs.sql`:

```sql
-- ============================================================================
-- 0127 — Transfers and shareholder funding pairs.
--
-- Two bank lines that are one movement of money are posted together: a
-- transfer between two of the company's bank accounts as one entry that
-- matches both lines, a shareholder funding pair as two entries on the
-- account the company chose, each saying what answered it. Change on a line
-- now releases every line of the entry it voids, so a transfer comes back
-- whole. Nothing else that exists changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_banking_preference (
  id                 boolean primary key default true check (id),
  funding_account_id uuid references acc_account (id),
  pair_window_days   int not null default 7 check (pair_window_days in (0, 1, 3, 7, 14, 30)),
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id),
  updated_at         timestamptz not null default now()
);

drop trigger if exists acc_banking_preference_actor_stamp on acc_banking_preference;
create trigger acc_banking_preference_actor_stamp
  before insert or update on acc_banking_preference
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_banking_preference_atomic_audit on acc_banking_preference;
create trigger acc_banking_preference_atomic_audit
  after insert or update or delete on acc_banking_preference
  for each row execute function acc_audit_row_change();

alter table acc_banking_preference enable row level security;

drop policy if exists acc_banking_preference_sel on acc_banking_preference;
create policy acc_banking_preference_sel on acc_banking_preference
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_banking_preference_ins on acc_banking_preference;
create policy acc_banking_preference_ins on acc_banking_preference
  for insert with check (acc_is_staff());
drop policy if exists acc_banking_preference_upd on acc_banking_preference;
create policy acc_banking_preference_upd on acc_banking_preference
  for update using (acc_is_staff()) with check (acc_is_staff());

revoke all on acc_banking_preference from public, anon;
grant select, insert, update on acc_banking_preference to authenticated;
grant all on acc_banking_preference to service_role;

-- --- Posting a pair ----------------------------------------------------------
create or replace function acc_post_bank_pair(p_first uuid, p_second uuid, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a        acc_bank_transaction;
  v_b        acc_bank_transaction;
  v_out      acc_bank_transaction;
  v_in       acc_bank_transaction;
  v_pref     acc_banking_preference;
  v_window   int;
  v_currency text;
  v_out_gl   uuid;
  v_in_gl    uuid;
  v_out_lbl  text;
  v_in_lbl   text;
  v_out_desc text;
  v_in_desc  text;
  v_abs      bigint;
  v_fund_id  uuid;
  v_fund     acc_account;
  v_entry    uuid;
  v_entry2   uuid;
  v_line     uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post bank lines';
  end if;
  if p_kind is null or p_kind not in ('transfer', 'funding') then
    raise exception 'Unknown pair kind %', p_kind;
  end if;
  if p_first is null or p_second is null or p_first = p_second then
    raise exception 'A pair needs two different lines';
  end if;

  select * into v_a from acc_bank_transaction where id = p_first for update;
  select * into v_b from acc_bank_transaction where id = p_second for update;
  if v_a.id is null or v_b.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_a.status <> 'unmatched' or v_b.status <> 'unmatched' or v_a.pending or v_b.pending then
    raise exception 'Both lines must still be waiting to be posted';
  end if;
  if exists (select 1 from acc_reconciliation where bank_transaction_id in (p_first, p_second)) then
    raise exception 'One of these lines is already matched to the ledger';
  end if;
  if coalesce(v_a.amount_minor, 0) = 0 or v_a.amount_minor <> -v_b.amount_minor then
    raise exception 'A pair is money in and money out of the same amount';
  end if;

  select * into v_pref from acc_banking_preference where id;
  v_window := coalesce(v_pref.pair_window_days, 7);
  if abs(v_a.txn_date - v_b.txn_date) > v_window then
    raise exception 'These lines are % days apart; pairs are within % days', abs(v_a.txn_date - v_b.txn_date), v_window;
  end if;

  if v_a.amount_minor < 0 then v_out := v_a; v_in := v_b; else v_out := v_b; v_in := v_a; end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;
  if exists (select 1 from acc_bank_account
              where id in (v_out.bank_account_id, v_in.bank_account_id) and currency_code <> v_currency) then
    raise exception 'Pairs are posted only between bank accounts in %', v_currency;
  end if;

  select ba.account_id, coalesce(nullif(btrim(ba.bank_name), ''), a.name) || ' · ' || a.account_code
    into v_out_gl, v_out_lbl
    from acc_bank_account ba join acc_account a on a.id = ba.account_id where ba.id = v_out.bank_account_id;
  select ba.account_id, coalesce(nullif(btrim(ba.bank_name), ''), a.name) || ' · ' || a.account_code
    into v_in_gl, v_in_lbl
    from acc_bank_account ba join acc_account a on a.id = ba.account_id where ba.id = v_in.bank_account_id;
  if v_out_gl is null or v_in_gl is null then
    raise exception 'A bank line has no ledger account behind its bank account';
  end if;

  v_abs := abs(v_out.amount_minor);
  v_out_desc := coalesce(nullif(btrim(v_out.description), ''), 'Bank line');
  v_in_desc  := coalesce(nullif(btrim(v_in.description), ''), 'Bank line');

  if p_kind = 'transfer' then
    if v_out.bank_account_id = v_in.bank_account_id or v_out_gl = v_in_gl then
      raise exception 'A transfer moves money between two different bank accounts';
    end if;
    v_entry := acc_post_entry(
      v_out.txn_date, format('Transfer from %s to %s', v_out_lbl, v_in_lbl), 'bank', null, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', v_in_gl, 'debit_minor', v_abs, 'credit_minor', 0,
          'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_in.description),
        jsonb_build_object('account_id', v_out_gl, 'debit_minor', 0, 'credit_minor', v_abs,
          'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description)));
    select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_out_gl limit 1;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
    values (v_out.id, v_line, 'approved', 1.000);
    select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_in_gl limit 1;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
    values (v_in.id, v_line, 'approved', 1.000);
    update acc_bank_transaction set status = 'matched' where id in (v_out.id, v_in.id);
    return jsonb_build_object('entries',
      (select jsonb_agg(entry_number) from acc_journal_entry where id = v_entry));
  end if;

  -- Funding: the account is the company's choice, never the caller's.
  v_fund_id := v_pref.funding_account_id;
  select * into v_fund from acc_account where id = v_fund_id;
  if v_fund.id is null then
    raise exception 'Choose the account funding pairs post to, on Banking › Rules, first';
  end if;
  if v_fund.status <> 'active' or not v_fund.is_posting_account then
    raise exception 'Funding pairs cannot post to % — it is not an active posting account', v_fund.name;
  end if;

  v_entry := acc_post_entry(
    v_in.txn_date, format('%s, answered by %s on %s', v_in_desc, v_out_desc, v_out.txn_date), 'bank', null, v_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_in_gl, 'debit_minor', v_abs, 'credit_minor', 0,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_in.txn_date), 'memo', v_in.description),
      jsonb_build_object('account_id', v_fund.id, 'debit_minor', 0, 'credit_minor', v_abs,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_in.txn_date), 'memo', v_in.description)));
  select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_in_gl limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (v_in.id, v_line, 'approved', 1.000);

  v_entry2 := acc_post_entry(
    v_out.txn_date, format('%s, answered by %s on %s', v_out_desc, v_in_desc, v_in.txn_date), 'bank', null, v_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_fund.id, 'debit_minor', v_abs, 'credit_minor', 0,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description),
      jsonb_build_object('account_id', v_out_gl, 'debit_minor', 0, 'credit_minor', v_abs,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description)));
  select id into v_line from acc_journal_line where journal_entry_id = v_entry2 and account_id = v_out_gl limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (v_out.id, v_line, 'approved', 1.000);

  update acc_bank_transaction set status = 'matched' where id in (v_out.id, v_in.id);
  return jsonb_build_object('entries',
    (select jsonb_agg(entry_number order by entry_date, entry_number) from acc_journal_entry where id in (v_entry, v_entry2)));
end;
$$;

revoke all on function acc_post_bank_pair(uuid, uuid, text) from public, anon;
grant execute on function acc_post_bank_pair(uuid, uuid, text) to authenticated, service_role;

-- --- Change takes back every line of the entry it voids ------------------------
create or replace function acc_uncategorise_bank_transaction(
  p_transaction_id uuid,
  p_reason text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_txn     acc_bank_transaction;
  v_entry   uuid;
  v_source  acc_journal_source;
  v_ref     uuid;
  v_voided  int;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank transaction';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id;
  if v_txn.id is null then raise exception 'Bank transaction not found'; end if;
  if v_txn.transaction_batch_id is not null then
    raise exception
      'This line came from a transactions import. Undo that import instead — it owns the entry.';
  end if;

  select e.id, e.source_type, e.source_id into v_entry, v_source, v_ref
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_transaction_id
   limit 1;
  if v_entry is null then
    raise exception 'This line is not categorised';
  end if;
  if v_source <> 'bank' or v_ref is not null then
    raise exception
      'This line was matched by something that owns its entry (%), not by categorising it.',
      v_source;
  end if;

  update acc_journal_entry set status = 'void', voided_at = now()
   where id = v_entry and status = 'posted';
  get diagnostics v_voided = row_count;

  -- Every line this entry answered for goes back to waiting: a transfer is one
  -- entry reconciled to two bank lines, and taking it back releases both.
  with released as (
    delete from acc_reconciliation r
     using acc_journal_line l
     where r.journal_line_id = l.id and l.journal_entry_id = v_entry
    returning r.bank_transaction_id
  )
  update acc_bank_transaction set status = 'unmatched'
   where id in (select bank_transaction_id from released) or id = p_transaction_id;
  delete from acc_reconciliation where bank_transaction_id = p_transaction_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_transaction_id, 'uncategorise', auth.uid(),
          jsonb_build_object('journal_entry_id', v_entry,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_voided;
end;
$$;

revoke all on function acc_uncategorise_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_uncategorise_bank_transaction(uuid, text)
  to authenticated, service_role;
```

- [ ] **Step 3:** `npx vitest run tests/unit/bank-pairs-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts` → PASS.

- [ ] **Step 4: Rolled-back live check** — `scripts/verify-bank-pairs.mjs` (Write tool), following `scripts/verify-bank-rules.mjs`: per active company, `begin`; `set local lock_timeout='5s'`; `set local search_path`; apply 0127 inside the transaction when not yet recorded (via `planCompanySchema` for company schemas); create, as the owner, two bank ledger accounts (`ZZ-VERIFY-BA`, `ZZ-VERIFY-BB`, type `bank`), a liability `ZZ-VERIFY-SL` (`current_liability`), two `acc_bank_account` rows in the base currency, and waiting lines (`source 'file_upload'`, unique `raw_hash`, `txn_date current_date` unless stated): `t1` A −1000.00, `t2` B +1000.00, `t3` A +5000.00, `t4` A −5000.00, `t5` A −1.00, `t6` A +7.00, `t7` A −7.00, `t8` A +9.00 dated `current_date - 30`, `t9` B −9.00; upsert the preference (funding `ZZ-VERIFY-SL`, window 7). Then as the first active admin (`set local role authenticated` + claims), check:
  - transfer (t1, t2) returns one entry; that entry has two lines, both on the two bank ledger accounts; two approved reconciliations; both lines `matched`;
  - `acc_uncategorise_bank_transaction(t2)` voids it and leaves **both** t1 and t2 `unmatched` with no reconciliation;
  - funding (t3, t4) returns two entries whose descriptions contain `answered by`; both lines `matched`;
  - refusals (each in a savepoint, message matched): (t5, t5) "two different lines"; transfer (t6, t7) "two different bank accounts"; (t5, t6) "same amount"; transfer (t8, t9) "days apart"; with the preference's funding account cleared, funding (t6, t7) "Choose the account"; as an outsider claim "Not authorized";
  - a preference update as the admin writes an `acc_audit_log` row for `acc_banking_preference`.
  `rollback` always; print `N passed, M failed`; exit 1 on any failure.

  Run: `timeout 400 node --env-file=.env.local scripts/verify-bank-pairs.mjs` → all `ok`.

- [ ] **Step 5: Commit** `feat(pairs): migration 0127 — the banking preference, posting a pair, and Change that takes a transfer back whole`.

---

### Task 4: Services, schemas and actions

**Files:** Create `ctyhp-accounting/lib/services/banking-preference.ts`; Modify `lib/services/statement-review.ts`, `lib/domain/schemas.ts`, `app/(app)/banking/rules/actions.ts`; Test `tests/unit/bank-pairs-service.test.ts`.

**Produces:** `BankingPreference { fundingAccountId: string | null; pairWindowDays: number; saved: boolean }`; `getBankingPreference(sb)`; `saveBankingPreference(sb, input)`; `bankingPreferenceSchema`; `saveBankingPreferenceAction(raw)`; `postReviewItems` handles `pair` items via `deps.postPair(sb, first, second, kind) → Promise<string[]>`; `ImportReview` gains `counts`-neutral data (proposals carry pairs), and `pairLabels` is not needed (labels are in the proposals).

- [ ] **Step 1: Failing test** — `tests/unit/bank-pairs-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bankingPreferenceSchema, reviewPostItemsSchema } from "@/lib/domain/schemas";
import { postReviewItems, type ReviewPostDeps } from "@/lib/services/statement-review";

const sb = {} as SupabaseClient;
const id = "5a802489-7f77-4f20-9cbd-e0fb9a7d1542";

describe("posting a pair", () => {
  it("goes through the pair call with both lines and says which entries it made", async () => {
    const postPair = vi.fn(async () => ["JE-000041", "JE-000042"]);
    const deps = {
      lineState: vi.fn(async () => ({ status: "unmatched", pending: false, amountMinor: -500 })),
      matchOf: vi.fn(),
      approve: vi.fn(),
      settle: vi.fn(),
      categorise: vi.fn(),
      postPair,
    } as unknown as ReviewPostDeps;
    const [outcome] = await postReviewItems(sb, [{ transactionId: "t1", kind: "pair", pairKind: "funding", counterpartId: "t2" }], deps);
    expect(postPair).toHaveBeenCalledWith(sb, "t1", "t2", "funding");
    expect(outcome).toEqual({ id: "t1", ok: true, detail: "JE-000041, JE-000042" });
  });
});

describe("schemas", () => {
  it("take a pair item", () => {
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "pair", pairKind: "transfer", counterpartId: id }]).success).toBe(true);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "pair", pairKind: "gift", counterpartId: id }]).success).toBe(false);
  });
  it("take a banking preference within the window options", () => {
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: id, pairWindowDays: 7 }).success).toBe(true);
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: null, pairWindowDays: 3 }).success).toBe(true);
    expect(bankingPreferenceSchema.safeParse({ fundingAccountId: id, pairWindowDays: 5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Schemas** — in `lib/domain/schemas.ts`, add the pair member to the `reviewPostItemsSchema` union:

```ts
      z.object({
        transactionId: z.uuid(),
        kind: z.literal("pair"),
        pairKind: z.enum(["transfer", "funding"]),
        counterpartId: z.uuid(),
      }),
```

  and append:

```ts
/** The banking preference: where funding pairs post, and how far apart a pair may be. */
export const bankingPreferenceSchema = z.object({
  fundingAccountId: z.uuid().nullable(),
  pairWindowDays: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
});
```

- [ ] **Step 4: The preference service** — `lib/services/banking-preference.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PAIR_WINDOW, fundingAccountAllowed } from "@/lib/domain/bank-pairs";
import { listAccounts } from "./accounts";

export class BankingPreferenceError extends Error {}

export interface BankingPreference {
  fundingAccountId: string | null;
  pairWindowDays: number;
  /** False until someone saves it; the defaults are only offered. */
  saved: boolean;
}

export async function getBankingPreference(sb: SupabaseClient): Promise<BankingPreference> {
  const { data, error } = await sb.from("acc_banking_preference").select("funding_account_id,pair_window_days").eq("id", true).maybeSingle();
  if (error) throw new BankingPreferenceError(error.message);
  if (!data) return { fundingAccountId: null, pairWindowDays: DEFAULT_PAIR_WINDOW, saved: false };
  const row = data as { funding_account_id: string | null; pair_window_days: number };
  return { fundingAccountId: row.funding_account_id, pairWindowDays: Number(row.pair_window_days), saved: true };
}

export async function saveBankingPreference(
  sb: SupabaseClient,
  input: { fundingAccountId: string | null; pairWindowDays: number },
): Promise<void> {
  if (input.fundingAccountId) {
    const account = (await listAccounts(sb)).find((a) => a.id === input.fundingAccountId);
    if (!account || !fundingAccountAllowed(account)) {
      throw new BankingPreferenceError("Funding pairs post only to an active posting liability account");
    }
  }
  const { error } = await sb
    .from("acc_banking_preference")
    .upsert({ id: true, funding_account_id: input.fundingAccountId, pair_window_days: input.pairWindowDays }, { onConflict: "id" });
  if (error) throw new BankingPreferenceError(error.message);
}
```

- [ ] **Step 5: The review service** — in `lib/services/statement-review.ts`:
  - imports: `findBankPairs, lastFourDigits, namedTransferTarget, type PairBank, type PairLine` from `@/lib/domain/bank-pairs`; `getBankingPreference` from `./banking-preference`; `type ReviewPairView` from the review domain;
  - in `loadImportReview`, add to the `Promise.all`: every waiting line of the company (paged, ordered by `id`) — `sb.from("acc_bank_transaction").select("id,bank_account_id,txn_date,amount_minor,description,pending,status").eq("status","unmatched").eq("pending", false).is("provider_removed_at", null)`; `getBankingPreference(sb)`; the base currency (`sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle()`); and change `listSuggestions(sb, batch.bank_account_id)` to `listSuggestions(sb, null)`;
  - after `bestMatch` and `documents` are known, build the pairing input and the views:

```ts
  const baseCode = baseRow?.code ?? "USD";
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const bankLabel = (id: string) => {
    const b = bankById.get(id);
    return b ? `${b.bank_name || b.account_name} · ${b.account_code}` : "another bank account";
  };
  // An open document of exactly this amount says what the money is; such a line never pairs.
  const hasExactDocument = (amountMinor: number) =>
    documents.some(
      (d) => d.currencyCode === baseCode && d.balanceDueMinor === Math.abs(amountMinor) && d.direction === (amountMinor > 0 ? "receivable" : "payable"),
    );
  const pairable: PairLine[] = waiting
    .filter((w) => !bestMatch.has(w.id) && bankById.get(w.bank_account_id)?.currency_code === baseCode && !hasExactDocument(Number(w.amount_minor)))
    .map((w) => ({ id: w.id, bankAccountId: w.bank_account_id, txnDate: w.txn_date, amountMinor: Number(w.amount_minor), description: w.description ?? "" }));
  const facts = findBankPairs(pairable, preference.pairWindowDays, { fundingEnabled: Boolean(preference.fundingAccountId) });
  const fundingRow = accountRows.find((a) => a.id === preference.fundingAccountId);
  const fundingLabel = fundingRow ? `${fundingRow.account_code} ${fundingRow.name}` : "";
  const pairBanks: PairBank[] = banks.map((b) => ({
    id: b.id,
    glAccountId: b.account_id,
    label: bankLabel(b.id),
    accountName: b.account_name,
    digits: lastFourDigits(b.account_number_masked, b.account_name, b.bank_name),
  }));
  const pairView = (lineId: string, amountMinor: number): { pair: ReviewPairView | null; rivals: number } => {
    const fact = facts.get(lineId);
    if (!fact) return { pair: null, rivals: 0 };
    if (fact.kind === "ambiguous") return { pair: null, rivals: fact.rivals };
    const other = fact.counterpart;
    if (fact.kind === "transfer") {
      const direction = amountMinor < 0 ? "to" : "from";
      return {
        pair: {
          kind: "transfer",
          counterpartId: other.id,
          label: `Transfer ${direction} ${bankLabel(other.bankAccountId)}`,
          why: `The other side is on ${bankLabel(other.bankAccountId)}, ${other.txnDate}, for the same amount. Posting makes one transfer entry and matches both lines.`,
          also: "",
        },
        rivals: 0,
      };
    }
    return {
      pair: {
        kind: "funding",
        counterpartId: other.id,
        label: `Shareholder funding · ${fundingLabel}`,
        why: `Answered by ${other.description} of the same amount on ${other.txnDate} — the owner's money in and out, not income or a cost`,
        also: `possible shareholder funding with ${other.description} on ${other.txnDate}`,
      },
      rivals: 0,
    };
  };
  const namedFor = (row: BankTransactionRow) => {
    if (facts.get(row.id)?.kind === "transfer") return null;
    const target = namedTransferTarget({ bankAccountId: row.bank_account_id, description: row.description ?? "" }, pairBanks);
    if (!target) return null;
    const direction = Number(row.amount_minor) < 0 ? "to" : "from";
    return {
      accountId: target.glAccountId,
      label: `Transfer ${direction} ${target.label}`,
      why: `Reads as a transfer and names ${target.label}; no line there yet — posting moves the money without touching income or expense`,
    };
  };
```

  - in the `lines.map`, pass `pair`, `pairRivals` and `namedTransfer` to `reviewProposal` (computing `const { pair, rivals } = pairView(row.id, Number(row.amount_minor));`);
  - `ReviewPostDeps` gains `postPair: (sb: SupabaseClient, first: string, second: string, kind: "transfer" | "funding") => Promise<string[]>;` with the default:

```ts
  postPair: async (sb, first, second, kind) => {
    const { data, error } = await sb.rpc("acc_post_bank_pair", { p_first: first, p_second: second, p_kind: kind });
    if (error) throw fail(error.message);
    return ((data as { entries?: string[] } | null)?.entries ?? []).filter(Boolean);
  },
```

  - in `postReviewItems`, before the account branch: `} else if (item.kind === "pair") { const entries = await deps.postPair(sb, id, item.counterpartId, item.pairKind); outcomes.push({ id, ok: true, detail: entries.join(", ") || "Posted" }); }`.

- [ ] **Step 6: The preference action** — in `app/(app)/banking/rules/actions.ts` add:

```ts
export async function saveBankingPreferenceAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = bankingPreferenceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid setting" };
  try {
    const sb = await createSupabaseServerClient();
    await saveBankingPreference(sb, parsed.data);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}
```

  (import `bankingPreferenceSchema` and `saveBankingPreference`.)

- [ ] **Step 7:** run the new test, `tests/unit/statement-review-service.test.ts`, `tests/unit/statement-review-schema.test.ts`; `npm run typecheck`; eslint the changed files.
- [ ] **Step 8: Commit** `feat(pairs): the banking preference, pair facts on Review import, and posting a pair`.

---

### Task 5: Screens

**Files:** Create `app/(app)/banking/rules/PairsPreference.tsx`; Modify `app/(app)/banking/rules/page.tsx`, `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`.

- [ ] **Step 1: Pairs section** — `PairsPreference.tsx`: a client component with props `{ initial: BankingPreference; suggestedFundingId: string | null; accounts: { id: string; label: string }[]; canWrite: boolean }`. It shows "Pairs" as a small heading with the sentence "A transfer between your own bank accounts, and money in and out of the same amount within a few days, are offered as pairs on Review import. Funding pairs are never ticked for you."; a Select **Funding pairs post to** (options = liability accounts; `allowClear`; initial value `initial.saved ? initial.fundingAccountId : suggestedFundingId`; when showing an unsaved suggestion, a secondary line "Suggested from the account name — not saved yet"); a Select **Pair within** (`PAIR_WINDOW_OPTIONS` as "Same day" / "N days"); a **Save** button calling `saveBankingPreferenceAction` then `router.refresh()`; for viewers, the two values as text.
- [ ] **Step 2: Rules page** — load `getBankingPreference(sb)` in the `Promise.all`; build `liability = accounts.filter(fundingAccountAllowed)` with labels `${code} — ${name}`; `suggestedFundingId = suggestFundingAccount(accounts)`; render `<PairsPreference …/>` above `<RulesClient …/>`.
- [ ] **Step 3: Review client** — in `ReviewImportClient.tsx`:
  - initial `ticked`: lines with `startsTicked(line.proposal)`;
  - options per line: the proposal's own option (for `match`, `document`, `transfer`, `funding`), then the alternative (`alternativeValue`, labelled with `alternative.label`), then accounts;
  - `choose(line, value)`: also set the counterpart line's choice to `reciprocalValue(value, line.id)` and tick it when the value is a pair; when a line leaves a pair value it held, clear the counterpart's reciprocal value and untick it;
  - `post()`: `dedupePairItems` before chunking; after posting, untick both lines of each successful pair;
  - counts: add `transfer` and `funding` to the tally and the header sentence ("… · N transfers · N possible funding …").
- [ ] **Step 4:** `npm run typecheck`; `npx eslint "app/(app)/banking"`; UI gates (`table-adoption`, `table-fit-contract`, `no-hardcoded-color`, `rsc-antd`, `data-table-contract`, `navigation`).
- [ ] **Step 5: Commit** `feat(pairs): the Pairs setting on Banking › Rules, and pairs on Review import`.

---

### Task 6: Changelog 1.72, and the four gates

- [ ] Add as the first element of `RELEASES`:

```ts
  {
    version: "1.72",
    date: "2026-09-30",
    headline: "Transfers between your own accounts, and the owner's money in and out, are recognised on Review import.",
    changes: [
      {
        kind: "added",
        title: "Transfers between your bank accounts",
        detail:
          "When money leaves one of your bank accounts and the same amount arrives in another within a few days, Review import offers them as one transfer. Posting makes a single entry and matches both lines, so neither half is coded to income or expense. A line that reads as a transfer and names another of your accounts, by its name or last four digits, is offered as a transfer to it. Change on either line takes the whole transfer back.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Shareholder funding pairs",
        detail:
          "Money in and money out of the same amount on one account within a few days is offered as shareholder funding, posted to the account you choose. It is never ticked for you — equal amounts also happen by coincidence — and each entry says what answered it: \"CHECK 1303, answered by WIRE IN on 2026-02-09\".",
        route: "/banking",
      },
      {
        kind: "added",
        title: "The Pairs setting",
        detail:
          "Banking › Rules sets where funding pairs post, suggested from an account named like Shareholder Loan, and how many days apart a pair may be: the same day, or up to 30.",
        route: "/banking/rules",
      },
    ],
  },
```

- [ ] The four gates, each output read in full (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`).
- [ ] Commit `chore(changelog): 1.72, transfers and shareholder funding pairs`.

---

### Task 7: Live (controller)

- [ ] Ask the user to approve applying 0127 to every company; `scripts/migrate.mjs`; `verify-bank-pairs.mjs` on the applied books.
- [ ] On PC-Test only (sample check first): add a `1020 Savings Account` (bank) with a `Sample Savings ••7755` bank account and a `2600 Shareholder Loan` (current liability); save the preference through Banking › Rules.
- [ ] Made-up files: savings QFX with `ONLINE TRANSFER FROM CHECKING 4821` +1,000.00 (09-28); checking QFX with `ONLINE TRANSFER TO SAVINGS 7755` −1,000.00 (09-27), another `ONLINE TRANSFER TO SAVINGS 7755` −500.00 (09-29, no other side), `WIRE TYPE:BOOK IN` +12,000.00 (09-22) and `CHECK 1303` −12,000.00 (09-24).
- [ ] Import savings then checking; Review shows the transfer pair (ticked), the named transfer (ticked), and the funding pair (unticked); post the transfer and the funding pair; check the entries and their descriptions; Change one side of the transfer and see both lines return; take everything back and undo the imports.
- [ ] Screenshots (Rules with Pairs; Review with the three kinds) in light and dark, at 1440 and 1280; show the user before any push.
