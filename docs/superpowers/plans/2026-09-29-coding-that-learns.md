# Coding That Learns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bank line waiting to be coded shows the account a rule or the company's own history points to, with the reason, and a person can use it one line at a time or for every suggested line at once; rules are kept on Banking › Rules.

**Architecture:** Pure domain modules port the prototype's name keys, rule matching and history index; a new migration adds `acc_bank_rule` and an `acc_coding_history()` read; a service works suggestions out from the paged Banking reads (1.69) and posts through the existing `acc_categorise_bank_transaction`; the Banking screen and a new Rules screen use it.

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, Zod 4, Supabase Postgres 17.6, Vitest, `pg` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-09-29-coding-that-learns-design.md`. Branch `feat/coding-that-learns`, stacked on `fix/banking-paged-reads` (1.69). This release is **1.70**.

## Global Constraints

- Nothing is posted without a person's click; every post goes through `acc_categorise_bank_transaction` (via `categoriseBankTransaction`).
- A line with a match suggestion (`acc_reconciliation` row) gets no coding suggestion.
- Thresholds: at least **2** past entries and a top account holding at least **0.75** of them; longest key first; each company learns only from its own books.
- A rule or a suggestion targets only an active posting account that is not `accounts_receivable`, not `accounts_payable`, and not named like `/uncategori[sz]ed|suspense/i`.
- "Code all" posts at most **100** lines per call; the server works suggestions out again and posts nothing for a line whose suggestion changed.
- Migration **0126** must be applied to every company before this branch is merged. Nothing is written to live data without the user's approval; verify scripts run in transactions that are always rolled back.
- `lib/domain/coding-names.ts`, `bank-rules.ts`, `coding-history.ts` and `coding.ts` are imported by `scripts/*.mjs`: relative imports with the `.ts` extension, `import type` for types, no `@/` imports.
- US English UI. No hex colour in any source file. No Ant Design `<Table` in new files (use `DataTable`). A `page.tsx` never reads an Ant Design sub-component. List reads go through `readAllPages` with a total order.
- Write any file containing a backslash (regexes) with the Write/Edit tool, never a shell heredoc.
- Commits: stage files by name, one-line subject, **no Co-Authored-By trailer**, message written with Bash `printf '%s\n' "<subject>" > "$SCRATCH/msg.txt"` and `git commit -F "$SCRATCH/msg.txt"` (`$SCRATCH` = the scratchpad directory named in your dispatch).
- Run commands from `ctyhp-accounting/`. Focused tests: `npx vitest run tests/unit/<file>.test.ts`.

---

### Task 1: Names and keys

**Files:**
- Create: `ctyhp-accounting/lib/domain/coding-names.ts`
- Test: `ctyhp-accounting/tests/unit/coding-names.test.ts`

**Interfaces:**
- Produces: `type CodingDirection = "in" | "out"`; `directionOf(amountMinor: number): CodingDirection` (≥ 0 is `in`); `GENERIC_WORDS: ReadonlySet<string>`; `cleanPayee(text): string`; `nameWords(text): string[]`; `historyKeys(text): string[]`.

- [ ] **Step 1: Write the failing test**

`ctyhp-accounting/tests/unit/coding-names.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanPayee, directionOf, GENERIC_WORDS, historyKeys, nameWords } from "@/lib/domain/coding-names";

describe("cleanPayee", () => {
  it("squeezes spaces, drops a leading card or ACH word and long digit runs", () => {
    expect(cleanPayee("POS  STARBUCKS 12345678 SEATTLE")).toBe("STARBUCKS SEATTLE");
    expect(cleanPayee("ACH Metro Realty Partners")).toBe("Metro Realty Partners");
  });
  it("keeps short numbers and a leading word that is not a card word", () => {
    expect(cleanPayee("Suite 12345 Rent")).toBe("Suite 12345 Rent");
  });
  it("keeps the first 48 characters", () => {
    expect(cleanPayee("x".repeat(60))).toHaveLength(48);
  });
  it("reads nothing from nothing", () => {
    expect(cleanPayee(null)).toBe("");
  });
});

describe("nameWords", () => {
  it("lower-cases, keeps letters only, and drops the words every bank line carries", () => {
    expect(nameWords("ONLINE TRANSFER TO Metro Realty Partners LLC")).toEqual(["metro", "realty", "partners", "llc"]);
  });
  it("drops one-letter words", () => {
    expect(nameWords("A B Jewelry Co Supply")).toEqual(["jewelry", "supply"]);
  });
});

describe("historyKeys", () => {
  it("keys a name by its first three words, and by its first two when there are more", () => {
    expect(historyKeys("Metro Realty Partners LLC")).toEqual(["metro realty partners", "metro realty"]);
  });
  it("keeps a short name whole", () => {
    expect(historyKeys("Pacific Power")).toEqual(["pacific power"]);
    expect(historyKeys("Rent")).toEqual(["rent"]);
  });
  it("has no key for a line made only of bank words", () => {
    expect(historyKeys("WIRE TYPE:WIRE IN DATE:260915")).toEqual([]);
    expect(historyKeys("")).toEqual([]);
  });
  it("drops a long number, and keeps only the letters of a reference, as the prototype does", () => {
    expect(historyKeys("Acme Inc AP260921 260921 X9Q2ZZ")).toEqual(["acme inc ap", "acme inc"]);
  });
});

describe("directionOf", () => {
  it("calls money in, and nothing, in; money out out — as the prototype does", () => {
    expect(directionOf(100)).toBe("in");
    expect(directionOf(0)).toBe("in");
    expect(directionOf(-100)).toBe("out");
  });
});

describe("the names module", () => {
  it("carries the prototype's generic words", () => {
    for (const word of ["deposit", "wire", "ach", "ppd", "memo", "co"]) expect(GENERIC_WORDS.has(word)).toBe(true);
  });
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/coding-names.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/coding-names.test.ts`
Expected: FAIL — cannot find `@/lib/domain/coding-names`.

- [ ] **Step 3: Write the module** (Write tool — it contains backslashes)

`ctyhp-accounting/lib/domain/coding-names.ts`:

```ts
/**
 * The names a bank line or a ledger entry is known by, read the way the
 * client's prototype reads them (Accounting-System-v3.html, `cleanPayee` and
 * `histKeys` in "coding that learns").
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */

export type CodingDirection = "in" | "out";

/** Money in, and a zero, is `in`; money out is `out` — the prototype's `amount >= 0`. */
export function directionOf(amountMinor: number): CodingDirection {
  return amountMinor >= 0 ? "in" : "out";
}

/**
 * Words every bank line carries. A key made of these says nothing about who
 * was paid — "Deposit" and "WIRE TYPE IN" go everywhere — so they are dropped
 * before a name is formed. The prototype's list, unchanged: with a
 * three-in-four majority it took wrong guesses from 9 to 2 across 470 entries.
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set(
  (
    "deposit deposits wire type in out date time trn et ref transfer online mobile withdrawal " +
    "debit credit pos ach return item chargeback payment check cheque from to the id no number " +
    "bank branch atm card purchase recurring web ppd ccd des indn co entry descr orig memo"
  ).split(" "),
);

/** The prototype's `cleanPayee`: one space, no leading card word, no long digit runs, 48 characters. */
export function cleanPayee(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(ach|pos|debit|credit|card|purchase|payment|dep|withdrawal)\s+/i, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 48);
}

/** The words of a cleaned name that could say who was paid. */
export function nameWords(text: string | null | undefined): string[] {
  return cleanPayee(text)
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
}

/** The prototype's `histKeys`: the first three words, and the first two when there are more. */
export function historyKeys(text: string | null | undefined): string[] {
  const words = nameWords(text);
  if (words.length === 0) return [];
  const keys = [words.slice(0, 3).join(" ")];
  if (words.length > 2) keys.push(words.slice(0, 2).join(" "));
  return keys;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/coding-names.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/coding-names.ts tests/unit/coding-names.test.ts
printf '%s\n' "feat(coding): names and keys a bank line is known by, as the prototype reads them" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 2: Rules

**Files:**
- Create: `ctyhp-accounting/lib/domain/bank-rules.ts`
- Test: `ctyhp-accounting/tests/unit/bank-rules.test.ts`

**Interfaces:**
- Consumes: `directionOf`, `CodingDirection` (Task 1).
- Produces: `type RuleMatchKind = "words" | "regex"`; `type RuleDirection = CodingDirection | "any"`; `interface BankRule { id: string; position: number; matchKind: RuleMatchKind; matchText: string; direction: RuleDirection; minMinor: number | null; maxMinor: number | null; accountId: string; isActive: boolean }`; `type BankRuleInput = Omit<BankRule, "id" | "position">`; `interface RuleTarget { description: string; amountMinor: number }`; `RULE_TEXT_MAX = 200`; `wordPattern(text): RegExp`; `ruleMatches(rule, line): boolean`; `firstMatchingRule(rules, line, usable: (accountId: string) => boolean): BankRule | null`; `validateRuleInput(input: BankRuleInput): string | null`.

- [ ] **Step 1: Write the failing test** (Write tool — it contains backslashes)

`ctyhp-accounting/tests/unit/bank-rules.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstMatchingRule, ruleMatches, validateRuleInput, wordPattern, type BankRule } from "@/lib/domain/bank-rules";

const rule = (over: Partial<BankRule> = {}): BankRule => ({
  id: "r1",
  position: 1,
  matchKind: "words",
  matchText: "fee",
  direction: "any",
  minMinor: null,
  maxMinor: null,
  accountId: "acct-fees",
  isActive: true,
  ...over,
});
const line = (description: string, amountMinor: number) => ({ description, amountMinor });

describe("wordPattern", () => {
  it("holds a word to its boundaries, so 'fee' is not found in 'coffee'", () => {
    expect(wordPattern("fee").test("Wire fee")).toBe(true);
    expect(wordPattern("fee").test("Coffee Roasters")).toBe(false);
  });
  it("matches whatever the case, and takes punctuation literally", () => {
    expect(wordPattern("AT&T").test("at&t wireless")).toBe(true);
    expect(wordPattern("a.b").test("axb")).toBe(false);
  });
});

describe("ruleMatches", () => {
  it("matches words, and a regular expression when the rule says so", () => {
    expect(ruleMatches(rule(), line("Monthly service fee", -1500))).toBe(true);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "^gusto\\b" }), line("GUSTO PAYROLL 0915", -900000))).toBe(true);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "^gusto\\b" }), line("Paid via Gusto", -900000))).toBe(false);
  });
  it("keeps to its direction", () => {
    expect(ruleMatches(rule({ direction: "out" }), line("Wire fee", -2500))).toBe(true);
    expect(ruleMatches(rule({ direction: "out" }), line("Wire fee refund", 2500))).toBe(false);
    expect(ruleMatches(rule({ direction: "in" }), line("Wire fee refund", 2500))).toBe(true);
  });
  it("keeps to its amount window, both ends included, on the size of the amount", () => {
    const windowed = rule({ minMinor: 1000, maxMinor: 5000 });
    expect(ruleMatches(windowed, line("fee", -1000))).toBe(true);
    expect(ruleMatches(windowed, line("fee", -5000))).toBe(true);
    expect(ruleMatches(windowed, line("fee", -999))).toBe(false);
    expect(ruleMatches(windowed, line("fee", -500001))).toBe(false);
    expect(ruleMatches(rule({ maxMinor: 5000 }), line("fee", -100))).toBe(true);
  });
  it("never matches while switched off, or with a pattern that does not compile", () => {
    expect(ruleMatches(rule({ isActive: false }), line("fee", -100))).toBe(false);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "(unclosed" }), line("(unclosed", -100))).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  it("takes the first by position whose account can take the line", () => {
    const rules = [rule({ id: "late", position: 2, accountId: "acct-b" }), rule({ id: "early", position: 1, accountId: "acct-a" })];
    expect(firstMatchingRule(rules, line("fee", -100), () => true)?.id).toBe("early");
    expect(firstMatchingRule(rules, line("fee", -100), (id) => id !== "acct-a")?.id).toBe("late");
    expect(firstMatchingRule(rules, line("rent", -100), () => true)).toBeNull();
  });
});

describe("validateRuleInput", () => {
  const input = {
    matchKind: "words" as const,
    matchText: "fee",
    direction: "any" as const,
    minMinor: null,
    maxMinor: null,
    accountId: "acct",
    isActive: true,
  };
  it("accepts a sound rule", () => {
    expect(validateRuleInput(input)).toBeNull();
  });
  it("names what is wrong", () => {
    expect(validateRuleInput({ ...input, matchText: "  " })).toMatch(/what the rule looks for/);
    expect(validateRuleInput({ ...input, matchText: "x".repeat(201) })).toMatch(/200/);
    expect(validateRuleInput({ ...input, matchKind: "regex", matchText: "(" })).toMatch(/does not compile/);
    expect(validateRuleInput({ ...input, minMinor: 5000, maxMinor: 1000 })).toMatch(/lowest amount/);
    expect(validateRuleInput({ ...input, minMinor: -1 })).toMatch(/negative/);
    expect(validateRuleInput({ ...input, accountId: "" })).toMatch(/account/);
  });
});

describe("the rules module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/bank-rules.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/from "\.\/coding-names\.ts"/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/bank-rules.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write the module** (Write tool — it contains backslashes)

`ctyhp-accounting/lib/domain/bank-rules.ts`:

```ts
/**
 * Bank rules: what a person tells OneBook about a bank line — "gusto, money
 * out, is payroll". The first matching rule, in position order, suggests an
 * account; history is only asked when no rule answers (coding.ts).
 *
 * Matching follows the prototype's `ruleMatch`: a word match is a literal held
 * to word boundaries, a regular expression is case-insensitive, direction must
 * agree unless the rule says "any", and the amount window is tested on the
 * size of the amount so "fee" under $50 does not swallow a $5,000 wire.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import { directionOf, type CodingDirection } from "./coding-names.ts";

export type RuleMatchKind = "words" | "regex";
export type RuleDirection = CodingDirection | "any";

export interface BankRule {
  id: string;
  /** Rules are tried in position order; the lowest runs first. */
  position: number;
  matchKind: RuleMatchKind;
  matchText: string;
  direction: RuleDirection;
  /** Both ends inclusive, on |amount|; null is no end. */
  minMinor: number | null;
  maxMinor: number | null;
  accountId: string;
  isActive: boolean;
}

export type BankRuleInput = Omit<BankRule, "id" | "position">;

/** What a rule is tried against: the bank line's own words and its signed amount. */
export interface RuleTarget {
  description: string;
  amountMinor: number;
}

export const RULE_TEXT_MAX = 200;

/** A literal, held to a word boundary wherever it starts or ends with a word character. */
export function wordPattern(text: string): RegExp {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = /^\w/.test(text) ? "\\b" : "";
  const end = /\w$/.test(text) ? "\\b" : "";
  return new RegExp(`${start}${literal}${end}`, "i");
}

function patternOf(rule: Pick<BankRule, "matchKind" | "matchText">): RegExp | null {
  const text = rule.matchText.trim();
  if (!text) return null;
  try {
    return rule.matchKind === "regex" ? new RegExp(text, "i") : wordPattern(text);
  } catch {
    return null;
  }
}

export function ruleMatches(rule: BankRule, line: RuleTarget): boolean {
  if (!rule.isActive) return false;
  if (rule.direction !== "any" && rule.direction !== directionOf(line.amountMinor)) return false;
  const size = Math.abs(line.amountMinor);
  if (rule.minMinor !== null && size < rule.minMinor) return false;
  if (rule.maxMinor !== null && size > rule.maxMinor) return false;
  return patternOf(rule)?.test(line.description) ?? false;
}

/** The first rule, in position order, that matches and whose account can take the line. */
export function firstMatchingRule(
  rules: readonly BankRule[],
  line: RuleTarget,
  usable: (accountId: string) => boolean,
): BankRule | null {
  const ordered = [...rules].sort((a, b) => a.position - b.position);
  return ordered.find((rule) => usable(rule.accountId) && ruleMatches(rule, line)) ?? null;
}

/** Why a rule cannot be saved, or null when it can. */
export function validateRuleInput(input: BankRuleInput): string | null {
  const text = input.matchText.trim();
  if (!text) return "Say what the rule looks for";
  if (text.length > RULE_TEXT_MAX) return `A rule looks for at most ${RULE_TEXT_MAX} characters`;
  if (input.matchKind === "regex") {
    try {
      new RegExp(text, "i");
    } catch {
      return "That regular expression does not compile";
    }
  }
  if ((input.minMinor !== null && input.minMinor < 0) || (input.maxMinor !== null && input.maxMinor < 0)) {
    return "An amount cannot be negative";
  }
  if (input.minMinor !== null && input.maxMinor !== null && input.minMinor > input.maxMinor) {
    return "The lowest amount is above the highest";
  }
  if (!input.accountId) return "Choose the account the rule codes to";
  return null;
}
```

- [ ] **Step 4: Run the test** — `npx vitest run tests/unit/bank-rules.test.ts` — Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/bank-rules.ts tests/unit/bank-rules.test.ts
printf '%s\n' "feat(coding): bank rules — words or a pattern, a direction and an amount window" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 3: History

**Files:**
- Create: `ctyhp-accounting/lib/domain/coding-history.ts`
- Test: `ctyhp-accounting/tests/unit/coding-history.test.ts`

**Interfaces:**
- Consumes: `historyKeys`, `CodingDirection` (Task 1).
- Produces: `HISTORY_MIN = 2`; `HISTORY_SHARE = 0.75`; `interface HistorySource { entryId: string; date: string; direction: CodingDirection; accountId: string; texts: readonly string[] }`; `interface HistoryKeyStats { n: number; byAccount: Map<string, number>; last: string }`; `type HistoryIndex = ReadonlyMap<string, HistoryKeyStats>` (keyed `"<direction>|<key>"`); `buildHistoryIndex(sources, teaches: (accountId: string) => boolean): HistoryIndex`; `interface HistorySuggestion { accountId: string; hits: number; of: number; key: string; last: string }`; `suggestFromHistory(index, texts: readonly string[], direction, thresholds?: { min: number; share: number }): HistorySuggestion | null`.

- [ ] **Step 1: Write the failing test**

`ctyhp-accounting/tests/unit/coding-history.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHistoryIndex,
  HISTORY_MIN,
  HISTORY_SHARE,
  suggestFromHistory,
  type HistorySource,
} from "@/lib/domain/coding-history";

let seq = 0;
const src = (accountId: string, texts: string[], direction: "in" | "out" = "out", date = "2026-01-01"): HistorySource => ({
  entryId: `e${(seq += 1)}`,
  date,
  direction,
  accountId,
  texts,
});
const all = () => true;

describe("history thresholds", () => {
  it("are the prototype's: two entries, three in four", () => {
    expect(HISTORY_MIN).toBe(2);
    expect(HISTORY_SHARE).toBe(0.75);
  });
});

describe("suggestFromHistory", () => {
  it("suggests after two entries that agree, and says how often", () => {
    const index = buildHistoryIndex(
      [src("rent", ["Metro Realty Partners"]), src("rent", ["Metro Realty Partners"], "out", "2026-02-01")],
      all,
    );
    expect(suggestFromHistory(index, ["METRO REALTY PARTNERS LLC"], "out")).toEqual({
      accountId: "rent",
      hits: 2,
      of: 2,
      key: "metro realty partners",
      last: "2026-02-01",
    });
  });
  it("stays quiet after one entry", () => {
    const index = buildHistoryIndex([src("rent", ["Metro Realty Partners"])], all);
    expect(suggestFromHistory(index, ["Metro Realty Partners"], "out")).toBeNull();
  });
  it("needs three in four to agree: 3 of 4 speaks, 2 of 3 does not", () => {
    const three = buildHistoryIndex(
      [src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])],
      all,
    );
    expect(suggestFromHistory(three, ["Acme Supply"], "out")?.accountId).toBe("a");
    const two = buildHistoryIndex([src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])], all);
    expect(suggestFromHistory(two, ["Acme Supply"], "out")).toBeNull();
  });
  it("keeps money in and money out apart", () => {
    const index = buildHistoryIndex([src("sales", ["Acme Supply"], "in"), src("sales", ["Acme Supply"], "in")], all);
    expect(suggestFromHistory(index, ["Acme Supply"], "out")).toBeNull();
    expect(suggestFromHistory(index, ["Acme Supply"], "in")?.accountId).toBe("sales");
  });
  it("tries the longest key first: three words agreeing beat two", () => {
    const index = buildHistoryIndex(
      [
        src("rent", ["Metro Realty Partners"]),
        src("rent", ["Metro Realty Partners"]),
        src("repairs", ["Metro Realty Services"]),
        src("repairs", ["Metro Realty Services"]),
      ],
      all,
    );
    // "metro realty" alone is split two and two; "metro realty services" is not.
    expect(suggestFromHistory(index, ["Metro Realty Services"], "out")?.accountId).toBe("repairs");
    expect(suggestFromHistory(index, ["Metro Realty"], "out")).toBeNull();
  });
  it("counts an entry once for a key, however many of its texts carry it", () => {
    const index = buildHistoryIndex([src("rent", ["Metro Realty Partners", "Metro Realty Partners — March rent"])], all);
    expect(index.get("out|metro realty partners")?.n).toBe(1);
  });
  it("learns nothing from an entry whose account may not teach", () => {
    const index = buildHistoryIndex([src("ar", ["Acme"]), src("ar", ["Acme"])], (id) => id !== "ar");
    expect(suggestFromHistory(index, ["Acme"], "out")).toBeNull();
  });
  it("takes other thresholds when asked, for measuring them", () => {
    const index = buildHistoryIndex([src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])], all);
    expect(suggestFromHistory(index, ["Acme Supply"], "out", { min: 2, share: 0.6 })?.accountId).toBe("a");
  });
});

describe("the history module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/coding-history.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/from "\.\/coding-names\.ts"/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/unit/coding-history.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/coding-history.ts`:

```ts
/**
 * What the books already say: a name coded to Rent eleven times out of eleven
 * is not a question on the twelfth (the prototype's "coding that learns").
 *
 * The index is built from entries that are finished — one bank leg and one
 * other leg, as `acc_coding_history()` returns them — and only from those whose
 * account may teach (coding.ts decides: active, posting, not a control or
 * holding account). A suggestion needs at least two past entries and a clear
 * majority; below that it stays quiet and the line waits for a person.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import { historyKeys, type CodingDirection } from "./coding-names.ts";

export const HISTORY_MIN = 2;
export const HISTORY_SHARE = 0.75;

/** One entry that can teach: its bank leg's direction, the account on its other leg, the texts it is known by. */
export interface HistorySource {
  entryId: string;
  date: string;
  direction: CodingDirection;
  accountId: string;
  texts: readonly string[];
}

export interface HistoryKeyStats {
  n: number;
  byAccount: Map<string, number>;
  last: string;
}

export type HistoryIndex = ReadonlyMap<string, HistoryKeyStats>;

const indexKey = (direction: CodingDirection, key: string) => `${direction}|${key}`;

export function buildHistoryIndex(
  sources: readonly HistorySource[],
  teaches: (accountId: string) => boolean,
): HistoryIndex {
  const index = new Map<string, HistoryKeyStats>();
  for (const source of sources) {
    if (!teaches(source.accountId)) continue;
    const seen = new Set<string>();
    for (const text of source.texts) {
      for (const key of historyKeys(text)) {
        const k = indexKey(source.direction, key);
        if (seen.has(k)) continue;
        seen.add(k);
        const stats = index.get(k) ?? { n: 0, byAccount: new Map<string, number>(), last: "" };
        stats.n += 1;
        stats.byAccount.set(source.accountId, (stats.byAccount.get(source.accountId) ?? 0) + 1);
        if (source.date > stats.last) stats.last = source.date;
        index.set(k, stats);
      }
    }
  }
  return index;
}

export interface HistorySuggestion {
  accountId: string;
  hits: number;
  of: number;
  key: string;
  last: string;
}

/** The account these texts have gone to before, if the past is clear about it. */
export function suggestFromHistory(
  index: HistoryIndex,
  texts: readonly string[],
  direction: CodingDirection,
  thresholds: { min: number; share: number } = { min: HISTORY_MIN, share: HISTORY_SHARE },
): HistorySuggestion | null {
  const keys: string[] = [];
  for (const text of texts) for (const key of historyKeys(text)) if (!keys.includes(key)) keys.push(key);
  // Longest keys first: three words agreeing beats two.
  keys.sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const key of keys) {
    const stats = index.get(indexKey(direction, key));
    if (!stats || stats.n < thresholds.min) continue;
    let best = "";
    let hits = 0;
    for (const [accountId, count] of stats.byAccount) {
      if (count > hits) {
        best = accountId;
        hits = count;
      }
    }
    if (hits / stats.n < thresholds.share) continue;
    return { accountId: best, hits, of: stats.n, key, last: stats.last };
  }
  return null;
}
```

- [ ] **Step 4: Run the test** — Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/coding-history.ts tests/unit/coding-history.test.ts
printf '%s\n' "feat(coding): an index of how each name has been coded before, and what it suggests" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 4: One suggestion per waiting line

**Files:**
- Create: `ctyhp-accounting/lib/domain/coding.ts`
- Test: `ctyhp-accounting/tests/unit/coding.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `type AccountType` from `./accounts.ts`.
- Produces: `CODE_ALL_LIMIT = 100`; `interface CodingAccount { id; code; name; type: AccountType; active: boolean; posting: boolean }`; `codingAccountOf(row: { id: string; account_code: string; name: string; account_type: AccountType; status: string; is_posting_account: boolean }): CodingAccount`; `codableAccount(account: CodingAccount | undefined): boolean`; `interface CodingLine { id: string; amountMinor: number; description: string; merchantName: string | null }`; `type CodingSuggestion = { source: "rule"; accountId; ruleId; ruleNumber: number; ruleText } | { source: "history"; accountId; hits; of; key }`; `suggestCoding({ line, rules, index, accounts: ReadonlyMap<string, CodingAccount>, hasMatch }): CodingSuggestion | null`; `interface CodingSuggestionView { transactionId: string; accountId: string; accountLabel: string; source: "rule" | "history"; short: string; why: string }`; `codingView(line, suggestion, account): CodingSuggestionView`.

- [ ] **Step 1: Write the failing test**

`ctyhp-accounting/tests/unit/coding.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODE_ALL_LIMIT,
  codableAccount,
  codingAccountOf,
  codingView,
  suggestCoding,
  type CodingAccount,
} from "@/lib/domain/coding";
import type { BankRule } from "@/lib/domain/bank-rules";
import { buildHistoryIndex } from "@/lib/domain/coding-history";

const account = (id: string, over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code: id.toUpperCase(),
  name: `Account ${id}`,
  type: "expense",
  active: true,
  posting: true,
  ...over,
});
const accounts = new Map(
  [account("rent"), account("payroll"), account("repairs"), account("old", { active: false })].map((a) => [a.id, a]),
);
const rule = (over: Partial<BankRule>): BankRule => ({
  id: "r",
  position: 1,
  matchKind: "words",
  matchText: "metro",
  direction: "any",
  minMinor: null,
  maxMinor: null,
  accountId: "repairs",
  isActive: true,
  ...over,
});
const history = buildHistoryIndex(
  [
    { entryId: "1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "2", date: "2026-02-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "3", date: "2026-02-10", direction: "out", accountId: "payroll", texts: ["Starbucks"] },
    { entryId: "4", date: "2026-03-10", direction: "out", accountId: "payroll", texts: ["Starbucks"] },
  ],
  () => true,
);
const line = { id: "t1", amountMinor: -420000, description: "Metro Realty Partners LLC", merchantName: null };

describe("codableAccount", () => {
  it("allows an active posting account and refuses control, holding, inactive and heading accounts", () => {
    expect(codableAccount(account("x"))).toBe(true);
    expect(codableAccount(account("x", { active: false }))).toBe(false);
    expect(codableAccount(account("x", { posting: false }))).toBe(false);
    expect(codableAccount(account("x", { type: "accounts_receivable" }))).toBe(false);
    expect(codableAccount(account("x", { type: "accounts_payable" }))).toBe(false);
    expect(codableAccount(account("x", { name: "Uncategorized Expense" }))).toBe(false);
    expect(codableAccount(account("x", { name: "Suspense" }))).toBe(false);
    expect(codableAccount(undefined)).toBe(false);
  });
  it("reads a chart row", () => {
    expect(
      codingAccountOf({ id: "a", account_code: "6300", name: "Rent", account_type: "expense", status: "inactive", is_posting_account: true }),
    ).toEqual({ id: "a", code: "6300", name: "Rent", type: "expense", active: false, posting: true });
  });
});

describe("suggestCoding", () => {
  it("says nothing on a line that already has a match to the ledger", () => {
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts, hasMatch: true })).toBeNull();
  });
  it("lets a rule speak before history", () => {
    const s = suggestCoding({ line, rules: [rule({})], index: history, accounts, hasMatch: false });
    expect(s).toMatchObject({ source: "rule", accountId: "repairs", ruleId: "r", ruleNumber: 1 });
  });
  it("numbers a rule by its place in the list, not its stored position", () => {
    const rules = [rule({ id: "a", position: 5, matchText: "nothing here" }), rule({ id: "b", position: 9 })];
    expect(suggestCoding({ line, rules, index: history, accounts, hasMatch: false })).toMatchObject({ ruleId: "b", ruleNumber: 2 });
  });
  it("asks history when no rule answers", () => {
    expect(suggestCoding({ line, rules: [], index: history, accounts, hasMatch: false })).toMatchObject({
      source: "history",
      accountId: "rent",
      hits: 2,
      of: 2,
      key: "metro realty partners",
    });
  });
  it("skips a rule whose account cannot take the line, and falls through to history", () => {
    const s = suggestCoding({ line, rules: [rule({ accountId: "old" })], index: history, accounts, hasMatch: false });
    expect(s?.source).toBe("history");
  });
  it("reads a bank feed's merchant name too", () => {
    const fed = { id: "t2", amountMinor: -650, description: "POS 4432 0915", merchantName: "Starbucks" };
    expect(suggestCoding({ line: fed, rules: [], index: history, accounts, hasMatch: false })?.accountId).toBe("payroll");
  });
  it("stays quiet when nothing answers", () => {
    const unknown = { id: "t3", amountMinor: -100, description: "Somebody New", merchantName: null };
    expect(suggestCoding({ line: unknown, rules: [], index: history, accounts, hasMatch: false })).toBeNull();
  });
});

describe("codingView", () => {
  it("says why, in the words the screen shows", () => {
    const rent = accounts.get("rent")!;
    expect(codingView(line, { source: "history", accountId: "rent", hits: 11, of: 11, key: "metro realty" }, rent)).toEqual({
      transactionId: "t1",
      accountId: "rent",
      accountLabel: "RENT — Account rent",
      source: "history",
      short: "11 of 11",
      why: 'Coded to RENT Account rent 11 of the last 11 times for "metro realty"',
    });
    const byRule = codingView(line, { source: "rule", accountId: "rent", ruleId: "r", ruleNumber: 3, ruleText: "gusto" }, rent);
    expect(byRule.short).toBe('Rule 3 "gusto"');
    expect(byRule.why).toBe('Rule 3: "gusto" → RENT Account rent');
  });
});

describe("the coding module", () => {
  it("codes at most a hundred lines at a time", () => {
    expect(CODE_ALL_LIMIT).toBe(100);
  });
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/coding.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/import type \{ AccountType \} from "\.\/accounts\.ts"/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, module not found.

- [ ] **Step 3: Write the module** (Write tool — it contains a regex)

`ctyhp-accounting/lib/domain/coding.ts`:

```ts
/**
 * The one suggestion a waiting bank line gets, and how the screen says it.
 *
 * In order: a line already matched to the ledger gets none (coding it would
 * post a second entry for money already in the books, and
 * acc_categorise_bank_transaction refuses it anyway); then the first rule that
 * matches; then history; then nothing. Only an account a line can properly be
 * coded to is ever suggested — active, posting, not receivable or payable
 * (money from a customer or to a supplier is settled against a document), not a
 * holding account.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import type { AccountType } from "./accounts.ts";
import { firstMatchingRule, type BankRule } from "./bank-rules.ts";
import { suggestFromHistory, type HistoryIndex } from "./coding-history.ts";
import { directionOf } from "./coding-names.ts";

/** The most lines one "Code all" posts. */
export const CODE_ALL_LIMIT = 100;

export interface CodingAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  active: boolean;
  posting: boolean;
}

export function codingAccountOf(row: {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  status: string;
  is_posting_account: boolean;
}): CodingAccount {
  return {
    id: row.id,
    code: row.account_code,
    name: row.name,
    type: row.account_type,
    active: row.status === "active",
    posting: row.is_posting_account,
  };
}

const HOLDING = /uncategori[sz]ed|suspense/i;

export function codableAccount(account: CodingAccount | undefined): boolean {
  return Boolean(
    account &&
      account.active &&
      account.posting &&
      account.type !== "accounts_receivable" &&
      account.type !== "accounts_payable" &&
      !HOLDING.test(account.name),
  );
}

export interface CodingLine {
  id: string;
  amountMinor: number;
  description: string;
  /** A bank feed's own clean name for the payee, when it gives one. */
  merchantName: string | null;
}

export type CodingSuggestion =
  | { source: "rule"; accountId: string; ruleId: string; ruleNumber: number; ruleText: string }
  | { source: "history"; accountId: string; hits: number; of: number; key: string };

export function suggestCoding(input: {
  line: CodingLine;
  rules: readonly BankRule[];
  index: HistoryIndex;
  accounts: ReadonlyMap<string, CodingAccount>;
  hasMatch: boolean;
}): CodingSuggestion | null {
  const { line, rules, index, accounts, hasMatch } = input;
  if (hasMatch) return null;
  const usable = (accountId: string) => codableAccount(accounts.get(accountId));

  const ordered = [...rules].sort((a, b) => a.position - b.position);
  const rule = firstMatchingRule(ordered, { description: line.description, amountMinor: line.amountMinor }, usable);
  if (rule) {
    return {
      source: "rule",
      accountId: rule.accountId,
      ruleId: rule.id,
      ruleNumber: ordered.indexOf(rule) + 1,
      ruleText: rule.matchText,
    };
  }

  const history = suggestFromHistory(index, [line.merchantName ?? "", line.description], directionOf(line.amountMinor));
  if (history && usable(history.accountId)) {
    return { source: "history", accountId: history.accountId, hits: history.hits, of: history.of, key: history.key };
  }
  return null;
}

/** What the Banking screen needs to show and use one suggestion. */
export interface CodingSuggestionView {
  transactionId: string;
  accountId: string;
  /** "6300 — Rent" */
  accountLabel: string;
  source: "rule" | "history";
  /** `Rule 3 "gusto"` or "11 of 11". */
  short: string;
  /** The whole reason, for a tooltip and the Code all list. */
  why: string;
}

export function codingView(line: CodingLine, suggestion: CodingSuggestion, account: CodingAccount): CodingSuggestionView {
  const accountLabel = `${account.code} — ${account.name}`;
  const named = `${account.code} ${account.name}`;
  if (suggestion.source === "rule") {
    return {
      transactionId: line.id,
      accountId: suggestion.accountId,
      accountLabel,
      source: "rule",
      short: `Rule ${suggestion.ruleNumber} "${suggestion.ruleText}"`,
      why: `Rule ${suggestion.ruleNumber}: "${suggestion.ruleText}" → ${named}`,
    };
  }
  return {
    transactionId: line.id,
    accountId: suggestion.accountId,
    accountLabel,
    source: "history",
    short: `${suggestion.hits} of ${suggestion.of}`,
    why: `Coded to ${named} ${suggestion.hits} of the last ${suggestion.of} times for "${suggestion.key}"`,
  };
}
```

- [ ] **Step 4: Run the tests and typecheck** — `npx vitest run tests/unit/coding.test.ts tests/unit/coding-names.test.ts tests/unit/bank-rules.test.ts tests/unit/coding-history.test.ts`, then `npm run typecheck`. Expected: PASS; exit 0.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/coding.ts tests/unit/coding.test.ts
printf '%s\n' "feat(coding): one suggestion per waiting line — a match first, then a rule, then history" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 5: Migration 0126, its checks, and the accuracy measurement

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0126_bank_rules.sql`
- Create: `ctyhp-accounting/tests/unit/bank-rules-migration.test.ts`
- Create: `ctyhp-accounting/scripts/verify-bank-rules.mjs`
- Create: `ctyhp-accounting/scripts/evaluate-coding-history.mjs`

**Interfaces:**
- Consumes: Tasks 1–4 (the evaluation script imports `../lib/domain/coding-history.ts` and `../lib/domain/coding.ts`).
- Produces (database): table `acc_bank_rule` (`id, position, match_kind, match_text, direction, min_minor, max_minor, account_id, is_active, created_by, created_at, updated_by, updated_at`); function `acc_reorder_bank_rules(p_ids uuid[]) returns void`; function `acc_coding_history() returns table (entry_id uuid, entry_date date, direction text, account_id uuid, entry_description text, other_memo text, bank_description text)`.

- [ ] **Step 1: Write the static test**

`ctyhp-accounting/tests/unit/bank-rules-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0126_bank_rules.sql"), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0126 bank rules", () => {
  const sql = body();

  it("keeps rules with the checks the form relies on", () => {
    expect(sql).toMatch(/create table if not exists acc_bank_rule/i);
    expect(sql).toMatch(/match_kind in \('words', 'regex'\)/i);
    expect(sql).toMatch(/direction in \('in', 'out', 'any'\)/i);
    expect(sql).toMatch(/length\(btrim\(match_text\)\) between 1 and 200/i);
    expect(sql).toMatch(/min_minor is null or max_minor is null or min_minor <= max_minor/i);
    expect(sql).toMatch(/account_id\s+uuid not null references acc_account \(id\)/i);
  });

  it("stamps and audits every change", () => {
    expect(sql).toMatch(/before insert or update on acc_bank_rule\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/after insert or update or delete on acc_bank_rule\s+for each row execute function acc_audit_row_change\(\)/i);
  });

  it("lets staff write, and staff and viewers read", () => {
    expect(sql).toMatch(/alter table acc_bank_rule enable row level security/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for insert with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_bank_rule from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_bank_rule to authenticated/i);
  });

  it("reorders in one statement, staff only, listing every rule once", () => {
    expect(sql).toMatch(/function acc_reorder_bank_rules\(p_ids uuid\[\]\)/i);
    expect(sql).toMatch(/raise exception 'The new order must list every rule once'/i);
    expect(sql).toMatch(/grant execute on function acc_reorder_bank_rules\(uuid\[\]\) to authenticated, service_role/i);
  });

  it("reads history as the invoker, from posted entries of one bank leg and one other", () => {
    const fn = sql.slice(sql.search(/function acc_coding_history\(\)/i));
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/e\.status = 'posted'/i);
    expect(fn).toMatch(/having count\(\*\) filter \(where is_bank\) = 1\s+and count\(\*\) filter \(where not is_bank\) = 1/i);
    expect(fn).toMatch(/r\.status = 'approved'/i);
    expect(fn).toMatch(/order by e\.id/i);
    expect(sql).toMatch(/grant execute on function acc_coding_history\(\) to authenticated, service_role/i);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, ENOENT.

- [ ] **Step 3: Write the migration** (Write tool)

`ctyhp-accounting/supabase/migrations/0126_bank_rules.sql`:

```sql
-- ============================================================================
-- 0126 — Bank rules, and the history coding learns from.
--
-- A rule is what a person tells OneBook about a bank line: words or a
-- pattern, a direction, an amount window, an account. The first matching rule
-- suggests the account; nothing is posted until a person uses the suggestion,
-- through acc_categorise_bank_transaction as before.
--
-- acc_coding_history() hands the application every finished entry — one bank
-- leg and one other — with the texts it is known by. Which of them may teach
-- (active, posting, not a control or holding account) is decided in
-- lib/domain/coding.ts, where it is tested.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_bank_rule (
  id         uuid primary key default gen_random_uuid(),
  position   int not null,
  match_kind text not null default 'words' check (match_kind in ('words', 'regex')),
  match_text text not null check (length(btrim(match_text)) between 1 and 200),
  direction  text not null default 'any' check (direction in ('in', 'out', 'any')),
  min_minor  bigint check (min_minor >= 0),
  max_minor  bigint check (max_minor >= 0),
  account_id uuid not null references acc_account (id),
  is_active  boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint acc_bank_rule_amount_window_ck
    check (min_minor is null or max_minor is null or min_minor <= max_minor)
);
create index if not exists acc_bank_rule_position_idx on acc_bank_rule (position);

drop trigger if exists acc_bank_rule_actor_stamp on acc_bank_rule;
create trigger acc_bank_rule_actor_stamp
  before insert or update on acc_bank_rule
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_bank_rule_atomic_audit on acc_bank_rule;
create trigger acc_bank_rule_atomic_audit
  after insert or update or delete on acc_bank_rule
  for each row execute function acc_audit_row_change();

alter table acc_bank_rule enable row level security;

drop policy if exists acc_bank_rule_sel on acc_bank_rule;
create policy acc_bank_rule_sel on acc_bank_rule
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_bank_rule_ins on acc_bank_rule;
create policy acc_bank_rule_ins on acc_bank_rule
  for insert with check (acc_is_staff());
drop policy if exists acc_bank_rule_upd on acc_bank_rule;
create policy acc_bank_rule_upd on acc_bank_rule
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_bank_rule_del on acc_bank_rule;
create policy acc_bank_rule_del on acc_bank_rule
  for delete using (acc_is_staff());

revoke all on acc_bank_rule from public, anon;
grant select, insert, update, delete on acc_bank_rule to authenticated;
grant all on acc_bank_rule to service_role;

-- --- Putting rules in order, in one statement --------------------------------
create or replace function acc_reorder_bank_rules(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change bank rules';
  end if;
  if (select count(*) from acc_bank_rule) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from acc_bank_rule r where not (r.id = any (p_ids))) then
    raise exception 'The new order must list every rule once';
  end if;
  update acc_bank_rule r
     set position = o.ordinality::int
    from unnest(p_ids) with ordinality as o(id, ordinality)
   where r.id = o.id
     and r.position is distinct from o.ordinality::int;
end;
$$;

revoke all on function acc_reorder_bank_rules(uuid[]) from public, anon;
grant execute on function acc_reorder_bank_rules(uuid[]) to authenticated, service_role;

-- --- The entries coding learns from --------------------------------------------
-- As the invoker, so row-level security decides what a reader may learn from.
create or replace function acc_coding_history()
returns table (
  entry_id          uuid,
  entry_date        date,
  direction         text,
  account_id        uuid,
  entry_description text,
  other_memo        text,
  bank_description  text
)
language sql stable set search_path = public as $$
  with lines as (
    select l.id, l.journal_entry_id, l.account_id, l.memo,
           l.debit_minor - l.credit_minor as net,
           a.account_type = 'bank' as is_bank
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
      join acc_account a on a.id = l.account_id
  ),
  shaped as (
    select journal_entry_id
      from lines
     group by journal_entry_id
    having count(*) filter (where is_bank) = 1
       and count(*) filter (where not is_bank) = 1
  )
  select e.id,
         e.entry_date,
         case when b.net >= 0 then 'in' else 'out' end,
         o.account_id,
         e.description,
         o.memo,
         (select t.description
            from acc_reconciliation r
            join acc_bank_transaction t on t.id = r.bank_transaction_id
           where r.journal_line_id = b.id and r.status = 'approved'
           limit 1)
    from shaped s
    join acc_journal_entry e on e.id = s.journal_entry_id
    join lines b on b.journal_entry_id = s.journal_entry_id and b.is_bank
    join lines o on o.journal_entry_id = s.journal_entry_id and not o.is_bank
   order by e.id;
$$;

revoke all on function acc_coding_history() from public, anon;
grant execute on function acc_coding_history() to authenticated, service_role;
```

- [ ] **Step 4: Run the static test and the migration gates**

Run: `npx vitest run tests/unit/bank-rules-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts`
Expected: PASS.

- [ ] **Step 5: The rolled-back live check**

`ctyhp-accounting/scripts/verify-bank-rules.mjs`:

```js
/**
 * Behavioural verification of migration 0126 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0126 has not been applied it is applied first, inside that transaction,
 * so this proves the migration against the real books before it is applied
 * for real and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-rules.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0126_bank_rules.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
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
const as = (userId) => client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

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
        console.log("  (0126 applied inside the transaction, never committed)");
      }

      const admin = (await client.query(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`)).rows[0];
      const account = (
        await client.query(`select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1`)
      ).rows[0];
      if (!admin || !account) {
        console.log("  (no active administrator or expense account; rule checks skipped)");
      } else {
        await client.query("set local role authenticated");
        await as(admin.id);
        const inserted = (
          await client.query(
            `insert into acc_bank_rule (position, match_kind, match_text, direction, account_id)
             values (1, 'words', 'verify probe', 'out', $1) returning id, created_by`,
            [account.id],
          )
        ).rows[0];
        check("staff can add a rule, stamped with who added it", Boolean(inserted?.id) && inserted.created_by === admin.id);
        await client.query(`update acc_bank_rule set match_text = 'verify probe two' where id = $1`, [inserted.id]);
        await client.query(`select acc_reorder_bank_rules(array(select id from acc_bank_rule order by position, id))`);
        const count = (await client.query(`select count(*)::int as n from acc_bank_rule`)).rows[0].n;
        const positions = (await client.query(`select array_agg(position order by position) as p from acc_bank_rule`)).rows[0].p;
        check("rules can be put in order", positions.every((p, i) => p === i + 1) && positions.length === count, positions.join(","));
        const badOrder = await refused(`select acc_reorder_bank_rules($1::uuid[])`, [[inserted.id, inserted.id]]);
        check("an order that does not list every rule once is refused", /every rule once/.test(badOrder ?? ""), badOrder ?? "accepted");
        await client.query(`delete from acc_bank_rule where id = $1`, [inserted.id]);
        await client.query("reset role");
        const audit = (await client.query(`select action from acc_audit_log where table_name = 'acc_bank_rule' and record_id = $1`, [inserted.id])).rows.map(
          (r) => r.action,
        );
        check("every change is in the audit log", ["insert", "update", "delete"].every((a) => audit.includes(a)), audit.join(","));

        await client.query("set local role authenticated");
        await as(OUTSIDER);
        const outsider = await refused(`insert into acc_bank_rule (position, match_text, account_id) values (1, 'x', $1)`, [account.id]);
        check("someone who is not staff cannot add a rule", outsider !== null, outsider ?? "accepted");
        await client.query("reset role");

        const badWindow = await refused(
          `insert into acc_bank_rule (position, match_text, account_id, min_minor, max_minor) values (1, 'x', $1, 500, 100)`,
          [account.id],
        );
        check("a window whose lowest amount is above its highest is refused", /amount_window/.test(badWindow ?? ""), badWindow ?? "accepted");
      }

      const history = (await client.query(`select count(*)::int as n from acc_coding_history()`)).rows[0].n;
      const misshapen = (
        await client.query(
          `with h as (select * from acc_coding_history())
           select count(*)::int as n from h
            where (select count(*) from acc_journal_line l join acc_account a on a.id = l.account_id
                    where l.journal_entry_id = h.entry_id and a.account_type = 'bank') <> 1
               or (select count(*) from acc_journal_line l join acc_account a on a.id = l.account_id
                    where l.journal_entry_id = h.entry_id and a.account_type <> 'bank') <> 1
               or not exists (select 1 from acc_journal_entry e where e.id = h.entry_id and e.status = 'posted')`,
        )
      ).rows[0].n;
      check(`history holds only posted entries of one bank leg and one other (${history})`, misshapen === 0, String(misshapen));
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

Run: `timeout 400 node --env-file=.env.local scripts/verify-bank-rules.mjs`
Expected: every check `ok` on every company, ending `N passed, 0 failed`. If a check fails, stop and report the output; do not edit a check to pass.

- [ ] **Step 6: The read-only accuracy measurement**

`ctyhp-accounting/scripts/evaluate-coding-history.mjs`:

```js
/**
 * How often history would suggest, and how often it would be wrong, on each
 * company's own books — the measurement the prototype reports ("wrong guesses
 * from 9 to 2 across 470 entries").
 *
 * Read-only: every company is read inside a transaction that is rolled back
 * (0126 is applied inside it first when it is not live yet). A fixed fifth of
 * the entries that teach is hidden; suggestions for them are worked out from
 * the rest and compared with how they were really coded.
 *
 * Run: node --env-file=.env.local scripts/evaluate-coding-history.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";
import { buildHistoryIndex, HISTORY_MIN, HISTORY_SHARE, suggestFromHistory } from "../lib/domain/coding-history.ts";
import { codableAccount, codingAccountOf } from "../lib/domain/coding.ts";

const FILE = "0126_bank_rules.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const THRESHOLDS = [
  { min: HISTORY_MIN, share: HISTORY_SHARE },
  { min: 2, share: 0.6 },
  { min: 3, share: 0.75 },
  { min: 2, share: 0.9 },
];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();
const pct = (a, b) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(1)}%`);

try {
  const { rows: companies } = await client.query(`select slug, schema_name from onebook.company where status = 'active' order by display_order, schema_name`);
  for (const { slug, schema_name: schema } of companies) {
    let accounts;
    let rows;
    await client.query("begin");
    try {
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
      }
      accounts = (
        await client.query(`select id, account_code, name, account_type::text as account_type, status::text as status, is_posting_account from acc_account`)
      ).rows;
      rows = (await client.query(`select * from acc_coding_history()`)).rows;
    } finally {
      await client.query("rollback");
    }

    const byId = new Map(accounts.map((row) => [row.id, codingAccountOf(row)]));
    const teaching = rows
      .map((row) => ({
        entryId: row.entry_id,
        date: String(row.entry_date instanceof Date ? row.entry_date.toISOString().slice(0, 10) : row.entry_date),
        direction: row.direction,
        accountId: row.account_id,
        texts: [row.bank_description, row.entry_description, row.other_memo].filter((t) => typeof t === "string" && t.trim() !== ""),
      }))
      .filter((source) => codableAccount(byId.get(source.accountId)))
      .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
    const hidden = teaching.filter((_, i) => i % 5 === 0);
    const index = buildHistoryIndex(teaching.filter((_, i) => i % 5 !== 0), () => true);

    console.log(`\n${slug}: ${teaching.length} entries teach, ${hidden.length} hidden`);
    for (const t of THRESHOLDS) {
      let suggested = 0;
      let wrong = 0;
      for (const h of hidden) {
        const s = suggestFromHistory(index, h.texts, h.direction, t);
        if (!s) continue;
        suggested += 1;
        if (s.accountId !== h.accountId) wrong += 1;
      }
      const label = t.min === HISTORY_MIN && t.share === HISTORY_SHARE ? " (chosen)" : "";
      console.log(
        `  at least ${t.min}, share ${t.share}${label}: suggested ${suggested} of ${hidden.length} (${pct(suggested, hidden.length)}), wrong ${wrong} (${pct(wrong, suggested)} of those suggested)`,
      );
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}
```

Run: `timeout 400 node --env-file=.env.local scripts/evaluate-coding-history.mjs`
Expected: one block per company with four threshold lines. Copy the whole output into your report — the controller shows it to the user.

- [ ] **Step 7: Commit**

```bash
git add -- supabase/migrations/0126_bank_rules.sql tests/unit/bank-rules-migration.test.ts scripts/verify-bank-rules.mjs scripts/evaluate-coding-history.mjs
printf '%s\n' "feat(coding): migration 0126 — bank rules and the history coding learns from" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 6: Service, schemas and actions

**Files:**
- Create: `ctyhp-accounting/lib/services/coding.ts`
- Create: `ctyhp-accounting/app/(app)/banking/rules/actions.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Modify: `ctyhp-accounting/app/(app)/banking/actions.ts`
- Test: `ctyhp-accounting/tests/unit/coding-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `listBankTransactions`, `listSuggestions`, `categoriseBankTransaction` (lib/services/banking.ts, paged in 1.69); `listAccounts` (lib/services/accounts.ts); `readAllPages`.
- Produces: `CodingError`; `listBankRules(sb): Promise<BankRule[]>`; `loadHistory(sb): Promise<HistorySource[]>`; `interface CodingInputs { lines; rules; history; accounts; matchedLineIds }`; `suggestionsFrom(inputs): CodingSuggestionView[]`; `codingSuggestions(sb, bankAccountId: string | null): Promise<CodingSuggestionView[]>`; `interface CodeItem { transactionId: string; accountId: string }`; `interface CodeOutcome { id: string; ok: boolean; entry_number?: string | null; error?: string }`; `codeFromSuggestions(sb, items: readonly CodeItem[], deps?): Promise<CodeOutcome[]>`; `interface RulePreviewInput { matchKind; matchText; direction; minMinor; maxMinor }`; `interface RulePreview { count: number; examples: { id: string; txnDate: string; description: string; amountMinor: number }[] }`; `previewBankRule(sb, input): Promise<RulePreview>`; `ruleWaitingCounts(sb, rules): Promise<Record<string, number>>`; `saveBankRule(sb, id: string | null, input: BankRuleInput): Promise<string>`; `deleteBankRule(sb, id)`; `reorderBankRules(sb, ids)`. Actions: `getCodingSuggestionsAction(bankAccountId: string | null)`; `codeFromSuggestionsAction(items: CodeItem[])` → `{ outcomes }`; `previewBankRuleAction(input)`; `saveBankRuleAction(id, input)` → `{ id }`; `deleteBankRuleAction(id)`; `reorderBankRulesAction(ids)`. Schemas: `rulePreviewInputSchema`, `bankRuleInputSchema`.

- [ ] **Step 1: Write the failing test**

`ctyhp-accounting/tests/unit/coding-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { codeFromSuggestions, loadHistory, suggestionsFrom, type CodingInputs } from "@/lib/services/coding";

const sb = {} as SupabaseClient;
const acct = (id: string, name: string, over: Partial<AccountRow> = {}) =>
  ({ id, account_code: id.toUpperCase(), name, account_type: "expense", status: "active", is_posting_account: true, ...over }) as AccountRow;
const txn = (id: string, description: string, amount_minor: number, over: Partial<BankTransactionRow> = {}) =>
  ({ id, description, amount_minor, status: "unmatched", pending: false, merchant_name: null, ...over }) as BankTransactionRow;

const inputs = (over: Partial<CodingInputs> = {}): CodingInputs => ({
  lines: [txn("t1", "Metro Realty Partners", -420000)],
  rules: [],
  history: [
    { entryId: "e1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "e2", date: "2026-02-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
  ],
  accounts: [acct("rent", "Rent"), acct("fees", "Bank Fees")],
  matchedLineIds: new Set(),
  ...over,
});

describe("suggestionsFrom", () => {
  it("gives a waiting line its history suggestion, in the screen's words", () => {
    expect(suggestionsFrom(inputs())).toEqual([
      {
        transactionId: "t1",
        accountId: "rent",
        accountLabel: "RENT — Rent",
        source: "history",
        short: "2 of 2",
        why: 'Coded to RENT Rent 2 of the last 2 times for "metro realty partners"',
      },
    ]);
  });
  it("leaves out lines already matched, lines with a match suggestion, and pending feed lines", () => {
    expect(suggestionsFrom(inputs({ lines: [txn("t1", "Metro Realty Partners", -420000, { status: "matched" })] }))).toEqual([]);
    expect(suggestionsFrom(inputs({ matchedLineIds: new Set(["t1"]) }))).toEqual([]);
    expect(suggestionsFrom(inputs({ lines: [txn("t1", "Metro Realty Partners", -420000, { pending: true })] }))).toEqual([]);
  });
  it("does not learn from an account that may not teach", () => {
    expect(suggestionsFrom(inputs({ accounts: [acct("rent", "Rent", { status: "inactive" })] }))).toEqual([]);
  });
  it("puts a rule ahead of history", () => {
    const rules = [
      { id: "r", position: 1, matchKind: "words" as const, matchText: "metro", direction: "any" as const, minMinor: null, maxMinor: null, accountId: "fees", isActive: true },
    ];
    expect(suggestionsFrom(inputs({ rules }))[0]).toMatchObject({ accountId: "fees", source: "rule", short: 'Rule 1 "metro"' });
  });
});

describe("loadHistory", () => {
  it("pages the history read and keeps only the texts that say something", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ entry_id: "e1", entry_date: "2026-01-05", direction: "out", account_id: "rent", entry_description: "Metro — rent", other_memo: "  ", bank_description: null }],
      error: null,
    });
    const order = vi.fn(() => ({ range }));
    const client = { rpc: vi.fn(() => ({ order })) } as unknown as SupabaseClient;
    expect(await loadHistory(client)).toEqual([
      { entryId: "e1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro — rent"] },
    ]);
    expect(order).toHaveBeenCalledWith("entry_id");
    expect(range).toHaveBeenCalledWith(0, 999);
  });
});

describe("codeFromSuggestions", () => {
  const view = (transactionId: string, accountId: string): CodingSuggestionView => ({
    transactionId,
    accountId,
    accountLabel: accountId,
    source: "history",
    short: "2 of 2",
    why: "",
  });

  it("works the suggestions out again and posts each line whose suggestion still stands", async () => {
    const categorise = vi.fn(async (...args: [SupabaseClient, string, string]) => ({ entry_number: `JE-${args[1]}` }));
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t1", "rent"), view("t2", "rent")], categorise },
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: true, entry_number: "JE-t1" },
      { id: "t2", ok: true, entry_number: "JE-t2" },
    ]);
    expect(categorise.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["t1", "rent"],
      ["t2", "rent"],
    ]);
  });

  it("posts nothing for a line whose suggestion is gone or changed, and says why", async () => {
    const categorise = vi.fn();
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t2", "fees")], categorise },
    );
    expect(categorise).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ id: "t1", ok: false, error: expect.stringMatching(/no suggestion/) });
    expect(outcomes[1]).toMatchObject({ id: "t2", ok: false, error: expect.stringMatching(/changed/) });
  });

  it("reports a refusal word for word and carries on with the rest", async () => {
    const categorise = vi
      .fn()
      .mockRejectedValueOnce(new Error("The period is closed"))
      .mockResolvedValueOnce({ entry_number: "JE-2" });
    const outcomes = await codeFromSuggestions(
      sb,
      [
        { transactionId: "t1", accountId: "rent" },
        { transactionId: "t2", accountId: "rent" },
      ],
      { suggestions: async () => [view("t1", "rent"), view("t2", "rent")], categorise },
    );
    expect(outcomes).toEqual([
      { id: "t1", ok: false, error: "The period is closed" },
      { id: "t2", ok: true, entry_number: "JE-2" },
    ]);
  });

  it("refuses more than a hundred lines at once", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ transactionId: `t${i}`, accountId: "rent" }));
    await expect(codeFromSuggestions(sb, items, { suggestions: async () => [], categorise: vi.fn() })).rejects.toThrow(/100/);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — Expected: FAIL, module not found.

- [ ] **Step 3: The service**

`ctyhp-accounting/lib/services/coding.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import {
  ruleMatches,
  validateRuleInput,
  type BankRule,
  type BankRuleInput,
  type RuleDirection,
  type RuleMatchKind,
} from "@/lib/domain/bank-rules";
import { buildHistoryIndex, type HistorySource } from "@/lib/domain/coding-history";
import {
  CODE_ALL_LIMIT,
  codableAccount,
  codingAccountOf,
  codingView,
  suggestCoding,
  type CodingSuggestionView,
} from "@/lib/domain/coding";
import type { CodingDirection } from "@/lib/domain/coding-names";
import { listAccounts } from "./accounts";
import { categoriseBankTransaction, listBankTransactions, listSuggestions } from "./banking";
import { readAllPages } from "./paging";

/**
 * Coding that learns: bank rules, the history of how each name has been
 * coded, and the one suggestion each waiting bank line gets from them.
 *
 * Nothing here posts on its own. `codeFromSuggestions` posts only what a
 * person confirmed, through the same categorise call the Category cell uses,
 * and only where the suggestion — worked out again here — still stands.
 */
export class CodingError extends Error {}

const fail = (message: string) => new CodingError(message);
const RULE_COLUMNS = "id,position,match_kind,match_text,direction,min_minor,max_minor,account_id,is_active";

function ruleFromRow(row: Record<string, unknown>): BankRule {
  return {
    id: row.id as string,
    position: Number(row.position),
    matchKind: row.match_kind as RuleMatchKind,
    matchText: row.match_text as string,
    direction: row.direction as RuleDirection,
    minMinor: row.min_minor === null || row.min_minor === undefined ? null : Number(row.min_minor),
    maxMinor: row.max_minor === null || row.max_minor === undefined ? null : Number(row.max_minor),
    accountId: row.account_id as string,
    isActive: Boolean(row.is_active),
  };
}

export async function listBankRules(sb: SupabaseClient): Promise<BankRule[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_bank_rule").select(RULE_COLUMNS).order("position").order("id").range(from, to),
    fail,
  );
  return rows.map(ruleFromRow);
}

export async function loadHistory(sb: SupabaseClient): Promise<HistorySource[]> {
  // entry_id is unique here: an entry is returned once, for its one bank leg.
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_coding_history").order("entry_id").range(from, to),
    fail,
  );
  return rows.map((row) => ({
    entryId: row.entry_id as string,
    date: String(row.entry_date),
    direction: row.direction as CodingDirection,
    accountId: row.account_id as string,
    texts: [row.bank_description, row.entry_description, row.other_memo].filter(
      (text): text is string => typeof text === "string" && text.trim() !== "",
    ),
  }));
}

export interface CodingInputs {
  lines: BankTransactionRow[];
  rules: BankRule[];
  history: HistorySource[];
  accounts: AccountRow[];
  /** Lines with a match suggestion to the ledger: they get no coding suggestion. */
  matchedLineIds: ReadonlySet<string>;
}

const waiting = (row: BankTransactionRow) => row.status === "unmatched" && !row.pending;

/** Pure: the suggestion for every waiting line that has one. */
export function suggestionsFrom(inputs: CodingInputs): CodingSuggestionView[] {
  const accounts = new Map(inputs.accounts.map((row) => [row.id, codingAccountOf(row)]));
  const index = buildHistoryIndex(inputs.history, (id) => codableAccount(accounts.get(id)));
  const views: CodingSuggestionView[] = [];
  for (const row of inputs.lines) {
    if (!waiting(row)) continue;
    const line = {
      id: row.id,
      amountMinor: Number(row.amount_minor),
      description: row.description ?? "",
      merchantName: row.merchant_name ?? null,
    };
    const suggestion = suggestCoding({ line, rules: inputs.rules, index, accounts, hasMatch: inputs.matchedLineIds.has(row.id) });
    const account = suggestion ? accounts.get(suggestion.accountId) : undefined;
    if (suggestion && account) views.push(codingView(line, suggestion, account));
  }
  return views;
}

export async function codingSuggestions(sb: SupabaseClient, bankAccountId: string | null): Promise<CodingSuggestionView[]> {
  const [lines, rules, history, accounts, matches] = await Promise.all([
    listBankTransactions(sb, bankAccountId),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
    listSuggestions(sb, bankAccountId),
  ]);
  return suggestionsFrom({
    lines,
    rules,
    history,
    accounts,
    matchedLineIds: new Set(matches.map((match) => match.bank_transaction_id)),
  });
}

export interface CodeItem {
  transactionId: string;
  /** The account the person was shown, so a suggestion that changed since is not posted. */
  accountId: string;
}

export interface CodeOutcome {
  id: string;
  ok: boolean;
  entry_number?: string | null;
  error?: string;
}

export interface CodeDeps {
  suggestions: (sb: SupabaseClient) => Promise<CodingSuggestionView[]>;
  categorise: (sb: SupabaseClient, transactionId: string, accountId: string) => Promise<{ entry_number: string | null }>;
}

const defaultDeps: CodeDeps = {
  suggestions: (sb) => codingSuggestions(sb, null),
  categorise: categoriseBankTransaction,
};

/** Post what a person confirmed, one line at a time, where the suggestion still stands. */
export async function codeFromSuggestions(
  sb: SupabaseClient,
  items: readonly CodeItem[],
  deps: CodeDeps = defaultDeps,
): Promise<CodeOutcome[]> {
  if (items.length > CODE_ALL_LIMIT) throw new CodingError(`Code at most ${CODE_ALL_LIMIT} lines at a time`);
  // Worked out again here: what the browser was shown may be minutes old.
  const current = new Map((await deps.suggestions(sb)).map((s) => [s.transactionId, s]));
  const outcomes: CodeOutcome[] = [];
  for (const item of items) {
    const suggestion = current.get(item.transactionId);
    if (!suggestion) {
      outcomes.push({ id: item.transactionId, ok: false, error: "This line has no suggestion any more, so nothing was posted" });
      continue;
    }
    if (suggestion.accountId !== item.accountId) {
      outcomes.push({
        id: item.transactionId,
        ok: false,
        error: `The suggestion for this line changed to ${suggestion.accountLabel}, so nothing was posted`,
      });
      continue;
    }
    try {
      const posted = await deps.categorise(sb, item.transactionId, suggestion.accountId);
      outcomes.push({ id: item.transactionId, ok: true, entry_number: posted.entry_number });
    } catch (error) {
      outcomes.push({ id: item.transactionId, ok: false, error: error instanceof Error ? error.message : "Could not post this line" });
    }
  }
  return outcomes;
}

// --- Rules -----------------------------------------------------------------------

export interface RulePreviewInput {
  matchKind: RuleMatchKind;
  matchText: string;
  direction: RuleDirection;
  minMinor: number | null;
  maxMinor: number | null;
}

export interface RulePreview {
  count: number;
  examples: { id: string; txnDate: string; description: string; amountMinor: number }[];
}

async function waitingLines(sb: SupabaseClient): Promise<BankTransactionRow[]> {
  return (await listBankTransactions(sb, null)).filter(waiting);
}

const asTarget = (row: BankTransactionRow) => ({ description: row.description ?? "", amountMinor: Number(row.amount_minor) });

/** How many waiting lines a rule being written would match, with a few of them. */
export async function previewBankRule(sb: SupabaseClient, input: RulePreviewInput): Promise<RulePreview> {
  const problem = validateRuleInput({ ...input, accountId: "preview", isActive: true });
  if (problem) throw new CodingError(problem);
  const rule: BankRule = { ...input, id: "preview", position: 0, accountId: "preview", isActive: true };
  const hits = (await waitingLines(sb)).filter((row) => ruleMatches(rule, asTarget(row)));
  return {
    count: hits.length,
    examples: hits.slice(0, 5).map((row) => ({
      id: row.id,
      txnDate: row.txn_date,
      description: row.description ?? "",
      amountMinor: Number(row.amount_minor),
    })),
  };
}

/** For Banking › Rules: how many waiting lines each rule matches on its own. */
export async function ruleWaitingCounts(sb: SupabaseClient, rules: readonly BankRule[]): Promise<Record<string, number>> {
  const lines = await waitingLines(sb);
  return Object.fromEntries(
    rules.map((rule) => [rule.id, lines.filter((row) => ruleMatches({ ...rule, isActive: true }, asTarget(row))).length]),
  );
}

export async function saveBankRule(sb: SupabaseClient, id: string | null, input: BankRuleInput): Promise<string> {
  const problem = validateRuleInput(input);
  if (problem) throw new CodingError(problem);
  const row = (await listAccounts(sb)).find((account) => account.id === input.accountId);
  if (!codableAccount(row ? codingAccountOf(row) : undefined)) {
    throw new CodingError("A rule codes only to an active posting account that is not receivable, payable or a holding account");
  }
  const fields = {
    match_kind: input.matchKind,
    match_text: input.matchText.trim(),
    direction: input.direction,
    min_minor: input.minMinor,
    max_minor: input.maxMinor,
    account_id: input.accountId,
    is_active: input.isActive,
  };
  if (id) {
    const { data, error } = await sb.from("acc_bank_rule").update(fields).eq("id", id).select("id").single();
    if (error) throw new CodingError(error.message);
    return (data as { id: string }).id;
  }
  const { data: last, error: lastError } = await sb
    .from("acc_bank_rule")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  if (lastError) throw new CodingError(lastError.message);
  const position = (last?.[0] ? Number((last[0] as { position: number }).position) : 0) + 1;
  const { data, error } = await sb.from("acc_bank_rule").insert({ ...fields, position }).select("id").single();
  if (error) throw new CodingError(error.message);
  return (data as { id: string }).id;
}

export async function deleteBankRule(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_bank_rule").delete().eq("id", id);
  if (error) throw new CodingError(error.message);
}

export async function reorderBankRules(sb: SupabaseClient, ids: readonly string[]): Promise<void> {
  const { error } = await sb.rpc("acc_reorder_bank_rules", { p_ids: ids });
  if (error) throw new CodingError(error.message);
}
```

- [ ] **Step 4: The schemas** — in `lib/domain/schemas.ts`, add at the end of the file:

```ts
/** A bank rule as the preview reads it: everything but the account. */
export const rulePreviewInputSchema = z.object({
  matchKind: z.enum(["words", "regex"]),
  matchText: z.string().trim().min(1, "Say what the rule looks for").max(200, "A rule looks for at most 200 characters"),
  direction: z.enum(["in", "out", "any"]),
  minMinor: z.number().int().min(0).nullable(),
  maxMinor: z.number().int().min(0).nullable(),
});

export const bankRuleInputSchema = rulePreviewInputSchema.extend({
  accountId: z.uuid("Choose the account the rule codes to"),
  isActive: z.boolean(),
});
```

- [ ] **Step 5: The Banking actions** — in `app/(app)/banking/actions.ts`:
- add imports:

```ts
import { CODE_ALL_LIMIT, type CodingSuggestionView } from "@/lib/domain/coding";
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
```

- add at the end of the file:

```ts
/** The coding suggestion for each waiting line in view. Null means every bank account. */
export async function getCodingSuggestionsAction(
  bankAccountId: string | null,
): Promise<ActionResult<CodingSuggestionView[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await codingSuggestions(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Code every confirmed line from its suggestion. The suggestions are worked
 * out again on the server, and a line whose suggestion is gone or changed is
 * reported rather than posted. One line at a time, as the batch action does.
 */
export async function codeFromSuggestionsAction(
  items: CodeItem[],
): Promise<ActionResult<{ outcomes: CodeOutcome[] }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!items.length) return { ok: false, error: "Nothing to code" };
  if (items.length > CODE_ALL_LIMIT) return { ok: false, error: `Code at most ${CODE_ALL_LIMIT} lines at a time` };
  try {
    const sb = await createSupabaseServerClient();
    const outcomes = await codeFromSuggestions(sb, items);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: { outcomes } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 6: The Rules actions**

`ctyhp-accounting/app/(app)/banking/rules/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { bankRuleInputSchema, rulePreviewInputSchema } from "@/lib/domain/schemas";
import {
  deleteBankRule,
  previewBankRule,
  reorderBankRules,
  saveBankRule,
  type RulePreview,
} from "@/lib/services/coding";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  return canWrite(await getUserRole()) ? null : "You do not have permission to change bank rules";
}
const messageOf = (err: unknown) => (err instanceof Error ? err.message : "An unexpected error occurred");
const refresh = () => {
  revalidatePath("/banking/rules");
  revalidatePath("/banking");
};

export async function previewBankRuleAction(raw: unknown): Promise<ActionResult<RulePreview>> {
  const parsed = rulePreviewInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewBankRule(sb, parsed.data) };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function saveBankRuleAction(id: string | null, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = bankRuleInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveBankRule(sb, id, parsed.data);
    refresh();
    return { ok: true, data: { id: saved } };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function deleteBankRuleAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await deleteBankRule(sb, id);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

export async function reorderBankRulesAction(ids: string[]): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await reorderBankRules(sb, ids);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `npx vitest run tests/unit/coding-service.test.ts tests/unit/banking-paged-reads.test.ts`, then `npm run typecheck`, then `npx eslint lib/services/coding.ts "app/(app)/banking/actions.ts" "app/(app)/banking/rules/actions.ts" lib/domain/schemas.ts`.
Expected: PASS; exit 0; eslint exit 0.

- [ ] **Step 8: Commit**

```bash
git add -- lib/services/coding.ts lib/domain/schemas.ts "app/(app)/banking/actions.ts" "app/(app)/banking/rules/actions.ts" tests/unit/coding-service.test.ts
printf '%s\n' "feat(coding): suggestions for waiting lines, Code all, and bank rule actions" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 7: Banking › Rules

**Files:**
- Create: `ctyhp-accounting/app/(app)/banking/rules/page.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/rules/RulesClient.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/rules/RuleFormModal.tsx`
- Modify: `ctyhp-accounting/lib/domain/navigation.ts` (Banking children)

**Interfaces:**
- Consumes: Task 6 services and actions; `codableAccount`, `codingAccountOf` (Task 4); `searchAccounts` (`lib/domain/account-search.ts`); `formatMoney` (`lib/format.ts`); `USD_CURRENCY_CODE`.
- Produces: `RuleFormModal` default export with props `{ open: boolean; ruleId: string | null; initial: RuleFormValues; accounts: AccountRow[]; onClose: () => void; onSaved: () => void }`; `interface RuleFormValues { matchKind: "words" | "regex"; matchText: string; direction: "in" | "out" | "any"; minAmount: number | null; maxAmount: number | null; accountId: string | null; isActive: boolean }`; `EMPTY_RULE: RuleFormValues`; `toRuleInput(values): BankRuleInput`. Route `/banking/rules`.

- [ ] **Step 1: The form**

`ctyhp-accounting/app/(app)/banking/rules/RuleFormModal.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, InputNumber, Modal, Radio, Select, Space, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { searchAccounts } from "@/lib/domain/account-search";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/domain/accounts";
import type { BankRuleInput } from "@/lib/domain/bank-rules";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import type { RulePreview } from "@/lib/services/coding";
import { previewBankRuleAction, saveBankRuleAction } from "./actions";

export interface RuleFormValues {
  matchKind: "words" | "regex";
  matchText: string;
  direction: "in" | "out" | "any";
  minAmount: number | null;
  maxAmount: number | null;
  accountId: string | null;
  isActive: boolean;
}

export const EMPTY_RULE: RuleFormValues = {
  matchKind: "words",
  matchText: "",
  direction: "any",
  minAmount: null,
  maxAmount: null,
  accountId: null,
  isActive: true,
};

const toMinor = (dollars: number | null | undefined) =>
  dollars === null || dollars === undefined ? null : Math.round(dollars * 100);

export function toRuleInput(values: RuleFormValues): BankRuleInput {
  return {
    matchKind: values.matchKind,
    matchText: (values.matchText ?? "").trim(),
    direction: values.direction,
    minMinor: toMinor(values.minAmount),
    maxMinor: toMinor(values.maxAmount),
    accountId: values.accountId ?? "",
    isActive: values.isActive,
  };
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

/**
 * Add or change a bank rule, with the waiting lines it would match shown as
 * it is written — so "fee" catching a $5,000 wire is seen before it is saved.
 */
export default function RuleFormModal({
  open,
  ruleId,
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  ruleId: string | null;
  initial: RuleFormValues;
  /** Only accounts a rule may code to. */
  accounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RuleFormValues>();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const watched = Form.useWatch([], form) as RuleFormValues | undefined;

  const input = useMemo(() => (watched ? toRuleInput({ ...EMPTY_RULE, ...watched }) : null), [watched]);

  useEffect(() => {
    if (!open || !input || !input.matchText) return;
    const timer = setTimeout(() => {
      const { accountId: _account, isActive: _active, ...shape } = input;
      void previewBankRuleAction(shape).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, input]);

  const options = useMemo(
    () =>
      searchAccounts(
        accounts.map((account) => ({
          id: account.id,
          account_code: account.account_code,
          name: account.name,
          account_type: account.account_type as AccountType,
        })),
        query,
      ).map((hit) => ({
        value: hit.account.id,
        label: `${hit.account.account_code} — ${hit.account.name}`,
        type: hit.account.account_type,
      })),
    [accounts, query],
  );

  function close() {
    setPreview(null);
    setQuery("");
    onClose();
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveBankRuleAction(ruleId, toRuleInput({ ...EMPTY_RULE, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not save the rule");
      return;
    }
    message.success(ruleId ? "Rule saved" : "Rule created");
    setPreview(null);
    setQuery("");
    onSaved();
  }

  return (
    <Modal
      open={open}
      title={ruleId ? "Edit bank rule" : "New bank rule"}
      okText={ruleId ? "Save rule" : "Create rule"}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial}>
        <Form.Item label="Looks for" required>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="matchText"
              noStyle
              rules={[
                { required: true, whitespace: true, message: "Say what the rule looks for" },
                { max: 200, message: "A rule looks for at most 200 characters" },
              ]}
            >
              <Input placeholder="gusto, metro realty, wire fee…" />
            </Form.Item>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="matchKind" label="Match">
          <Radio.Group
            optionType="button"
            options={[
              { value: "words", label: "These words" },
              { value: "regex", label: "Regular expression" },
            ]}
          />
        </Form.Item>
        <Form.Item name="direction" label="Money">
          <Radio.Group
            optionType="button"
            options={[
              { value: "out", label: "Money out" },
              { value: "in", label: "Money in" },
              { value: "any", label: "Either" },
            ]}
          />
        </Form.Item>
        <Form.Item label="Amount (optional)" extra="Leave both blank for any amount. Both ends are included.">
          <Space>
            <Form.Item name="minAmount" noStyle>
              <InputNumber min={0} precision={2} prefix="$" placeholder="From" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="maxAmount" noStyle>
              <InputNumber min={0} precision={2} prefix="$" placeholder="To" style={{ width: 160 }} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="accountId" label="Codes to" rules={[{ required: true, message: "Choose the account the rule codes to" }]}>
          <Select
            showSearch
            placeholder="Search accounts…"
            filterOption={false}
            searchValue={query}
            onSearch={setQuery}
            options={options}
            optionRender={(option) => (
              <Space direction="vertical" size={0}>
                <span>{option.data.label}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ACCOUNT_TYPE_LABEL[option.data.type as AccountType]}
                </Typography.Text>
              </Space>
            )}
          />
        </Form.Item>
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview ? (
        <div>
          <Typography.Text strong>
            {preview.count === 0
              ? "Matches no line waiting to be coded"
              : `Matches ${preview.count} line${preview.count === 1 ? "" : "s"} waiting to be coded`}
          </Typography.Text>
          {preview.examples.map((example) => (
            <div key={example.id}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {example.txnDate} · {example.description} · {money(example.amountMinor)}
              </Typography.Text>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 2: The list**

`ctyhp-accounting/app/(app)/banking/rules/RulesClient.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AccountRow } from "@/lib/db/types";
import type { BankRule } from "@/lib/domain/bank-rules";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import RuleFormModal, { EMPTY_RULE, toRuleInput, type RuleFormValues } from "./RuleFormModal";
import { deleteBankRuleAction, reorderBankRulesAction, saveBankRuleAction } from "./actions";

export interface RuleListRow extends BankRule {
  accountLabel: string;
  /** False when the account is no longer one a rule may code to. */
  accountUsable: boolean;
  /** Waiting lines this rule matches on its own. */
  waiting: number;
}

const DIRECTION_LABEL = { in: "Money in", out: "Money out", any: "Either" } as const;
const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

function amountWindow(rule: BankRule): string {
  if (rule.minMinor === null && rule.maxMinor === null) return "Any amount";
  if (rule.minMinor !== null && rule.maxMinor !== null) return `${money(rule.minMinor)} – ${money(rule.maxMinor)}`;
  return rule.minMinor !== null ? `${money(rule.minMinor)} or more` : `Up to ${money(rule.maxMinor as number)}`;
}

const valuesOf = (rule: BankRule): RuleFormValues => ({
  matchKind: rule.matchKind,
  matchText: rule.matchText,
  direction: rule.direction,
  minAmount: rule.minMinor === null ? null : rule.minMinor / 100,
  maxAmount: rule.maxMinor === null ? null : rule.maxMinor / 100,
  accountId: rule.accountId,
  isActive: rule.isActive,
});

/**
 * Bank rules in the order they are tried. The first that matches a waiting
 * line suggests its account; history speaks only when none does.
 */
export default function RulesClient({
  rules,
  accounts,
  canWrite,
}: {
  rules: RuleListRow[];
  accounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; values: RuleFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= rules.length) return;
    const ids = rules.map((rule) => rule.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(rules[index].id);
    const res = await reorderBankRulesAction(ids);
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the order");
      return;
    }
    router.refresh();
  }

  async function setActive(rule: RuleListRow, isActive: boolean) {
    setBusy(rule.id);
    const res = await saveBankRuleAction(rule.id, toRuleInput({ ...valuesOf(rule), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? "Could not change the rule");
      return;
    }
    router.refresh();
  }

  function remove(rule: RuleListRow) {
    modal.confirm({
      title: "Delete this rule?",
      content: `"${rule.matchText}" → ${rule.accountLabel}. Lines already coded stay as they are.`,
      okText: "Delete rule",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteBankRuleAction(rule.id);
        if (!res.ok) {
          message.error(res.error ?? "Could not delete the rule");
          return;
        }
        message.success("Rule deleted");
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RuleListRow> = [
    {
      title: "#",
      key: "order",
      width: COLUMN.ACTION,
      render: (_: unknown, _rule: RuleListRow, index: number) => index + 1,
    },
    {
      ...flexColumn<RuleListRow>({
        title: "Looks for",
        key: "match",
        render: (_: unknown, rule: RuleListRow) => (
          <Space size={6} wrap>
            <Typography.Text code>{rule.matchText}</Typography.Text>
            {rule.matchKind === "regex" ? <Tag>regular expression</Tag> : null}
          </Space>
        ),
      }),
    },
    { title: "Money", key: "direction", width: COLUMN.STATUS, render: (_: unknown, rule: RuleListRow) => DIRECTION_LABEL[rule.direction] },
    { title: "Amount", key: "amount", width: COLUMN.PICKER, render: (_: unknown, rule: RuleListRow) => amountWindow(rule) },
    {
      title: "Codes to",
      key: "account",
      width: COLUMN.PICKER,
      render: (_: unknown, rule: RuleListRow) =>
        rule.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: rule.accountLabel }}>{rule.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="This account is inactive, not a posting account, or not one a rule may code to. The rule suggests nothing until it is changed.">
            <Tag color="orange">{rule.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: COLUMN.STATUS,
      align: "right",
      render: (_: unknown, rule: RuleListRow) => rule.waiting,
    },
    {
      title: "On",
      key: "active",
      width: COLUMN.ACTION * 2,
      render: (_: unknown, rule: RuleListRow) => (
        <Switch
          size="small"
          checked={rule.isActive}
          disabled={!canWrite}
          loading={busy === rule.id}
          onChange={(checked) => void setActive(rule, checked)}
        />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: COLUMN.ACTION * 4,
            align: "right" as const,
            render: (_: unknown, rule: RuleListRow, index: number) => (
              <Space size={2}>
                <IconActionButton label="Move up" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => void move(index, -1)} />
                <IconActionButton
                  label="Move down"
                  icon={<ArrowDownOutlined />}
                  disabled={index === rules.length - 1}
                  onClick={() => void move(index, 1)}
                />
                <IconActionButton label="Edit rule" icon={<EditOutlined />} onClick={() => setEditing({ id: rule.id, values: valuesOf(rule) })} />
                <IconActionButton label="Delete rule" icon={<DeleteOutlined />} onClick={() => remove(rule)} />
              </Space>
            ),
          } as TableColumnsType<RuleListRow>[number],
        ]
      : []),
  ];

  return (
    <div>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ id: null, values: EMPTY_RULE })}>
            New rule
          </Button>
        </Space>
      ) : null}
      <DataTable<RuleListRow>
        rowKey="id"
        columns={columns}
        dataSource={rules}
        pagination={false}
        emptyTitle="No bank rules yet"
        emptyDescription="A rule says which account a bank line belongs to, by the words on it. Until there are rules, suggestions come from how lines were coded before."
      />
      <RuleFormModal
        open={editing !== null}
        ruleId={editing?.id ?? null}
        initial={editing?.values ?? EMPTY_RULE}
        accounts={accounts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: The page**

`ctyhp-accounting/app/(app)/banking/rules/page.tsx`:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { listAccounts } from "@/lib/services/accounts";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import PageHeader from "@/components/PageHeader";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts] = await Promise.all([getUserRole(), listBankRules(sb), listAccounts(sb)]);
  const waiting = await ruleWaitingCounts(sb, rules);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const rows: RuleListRow[] = rules.map((rule) => {
    const account = byId.get(rule.accountId);
    return {
      ...rule,
      accountLabel: account ? `${account.account_code} — ${account.name}` : "Account not found",
      accountUsable: codableAccount(account ? codingAccountOf(account) : undefined),
      waiting: waiting[rule.id] ?? 0,
    };
  });
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="The words that say which account a bank line belongs to. The first rule that matches suggests the account; history speaks only when no rule does. Nothing is posted until someone uses a suggestion."
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

- [ ] **Step 4: The navigation** — in `lib/domain/navigation.ts`, in the `banking` group, after `{ key: "/banking/reconcile", label: "Reconcile" },` add:

```ts
      { key: "/banking/rules", label: "Rules" },
```

- [ ] **Step 5: Typecheck, lint and the gates**

Run: `npm run typecheck`; `npx eslint "app/(app)/banking/rules" lib/domain/navigation.ts`; `npx vitest run tests/unit/navigation.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/rsc-antd.test.ts tests/unit/data-table-contract.test.ts`.
Expected: exit 0; PASS. If an Ant Design prop in this code does not typecheck, use the prop the rest of the codebase uses for the same thing and say so in the report. Do not start the app: 0126 is not live yet.

- [ ] **Step 6: Commit**

```bash
git add -- "app/(app)/banking/rules/page.tsx" "app/(app)/banking/rules/RulesClient.tsx" "app/(app)/banking/rules/RuleFormModal.tsx" lib/domain/navigation.ts
printf '%s\n' "feat(coding): Banking › Rules — add, order, switch off and delete bank rules" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 8: Suggestions on Bank Transactions

**Files:**
- Create: `ctyhp-accounting/app/(app)/banking/CodingSuggestionsBar.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/CodeAllModal.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/banking-coding.module.css`
- Modify: `ctyhp-accounting/app/(app)/banking/CategoriseCell.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankingClient.tsx`

**Interfaces:**
- Consumes: `CodingSuggestionView`, `CODE_ALL_LIMIT`, `codableAccount`, `codingAccountOf` (Task 4); `historyKeys`, `directionOf` (Task 1); `getCodingSuggestionsAction`, `codeFromSuggestionsAction`, `CodeOutcome` (Task 6); `RuleFormModal`, `EMPTY_RULE`, `RuleFormValues` (Task 7); `summarizeBatchResults`, `describeBatchResult`, `batchResultSeverity` (`lib/domain/bank-transaction-batch.ts`).
- Produces: `CodingSuggestionsBar` (props `{ rows: BankReviewTableRow[]; suggestions: Map<string, CodingSuggestionView>; canWrite: boolean; formatRowMoney: (row) => string; onCodeAll: (rows: CodeAllRow[]) => void }`); `CodeAllModal` (props `{ rows: CodeAllRow[] | null; onClose: () => void; onDone: () => void }`); `interface CodeAllRow { id: string; accountId: string; txnDate: string; description: string; amount: string; accountLabel: string; why: string }`.

- [ ] **Step 1: The styles**

`ctyhp-accounting/app/(app)/banking/banking-coding.module.css`:

```css
/* The strip above Bank Transactions that offers the suggested lines. */
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px solid var(--ob-border-default);
  border-radius: 8px;
  background: var(--ob-surface-subtle);
  color: var(--ob-text-body);
}

.barText {
  flex: 1 1 320px;
}

.hint {
  font-size: 12px;
  color: var(--ob-text-secondary);
}
```

- [ ] **Step 2: The bar**

`ctyhp-accounting/app/(app)/banking/CodingSuggestionsBar.tsx`:

```tsx
"use client";
import { Button, Typography } from "antd";
import { CODE_ALL_LIMIT, type CodingSuggestionView } from "@/lib/domain/coding";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import type { BankReviewTableRow } from "./BankTransactionsTable";
import type { CodeAllRow } from "./CodeAllModal";
import styles from "./banking-coding.module.css";

/**
 * How many waiting lines in view already have an answer, and the button that
 * posts them — after a confirmation that lists every one.
 */
export default function CodingSuggestionsBar({
  rows,
  suggestions,
  canWrite,
  formatRowMoney,
  onCodeAll,
}: {
  rows: BankReviewTableRow[];
  suggestions: Map<string, CodingSuggestionView>;
  canWrite: boolean;
  formatRowMoney: (row: BankReviewTableRow) => string;
  onCodeAll: (rows: CodeAllRow[]) => void;
}) {
  const waiting = rows.filter((row) => row.transaction.status === "unmatched");
  const ready = waiting.filter((row) => suggestions.has(row.transaction.id));
  if (ready.length === 0) return null;
  const total = ready.reduce((sum, row) => sum + Math.abs(Number(row.transaction.amount_minor)), 0);
  const batch = ready.slice(0, CODE_ALL_LIMIT);

  return (
    <div className={styles.bar} role="status">
      <div className={styles.barText}>
        <Typography.Text strong>
          {ready.length} of {waiting.length} waiting line{waiting.length === 1 ? "" : "s"}{" "}
          {ready.length === 1 ? "has" : "have"} a suggestion, {formatMoney(total, USD_CURRENCY_CODE, 2)} in all.
        </Typography.Text>{" "}
        <span className={styles.hint}>
          {ready.length > CODE_ALL_LIMIT
            ? `Code all posts the first ${CODE_ALL_LIMIT}; ${ready.length - CODE_ALL_LIMIT} more wait for the next run.`
            : "Each one says where it is going and why."}
        </span>
      </div>
      {canWrite ? (
        <Button
          type="primary"
          onClick={() =>
            onCodeAll(
              batch.map((row) => {
                const suggestion = suggestions.get(row.transaction.id)!;
                return {
                  id: row.transaction.id,
                  accountId: suggestion.accountId,
                  txnDate: row.transaction.txn_date,
                  description: row.transaction.description,
                  amount: formatRowMoney(row),
                  accountLabel: suggestion.accountLabel,
                  why: suggestion.why,
                };
              }),
            )
          }
        >
          Code all {batch.length}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: The confirmation**

`ctyhp-accounting/app/(app)/banking/CodeAllModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Alert, App, Button, Modal, Space, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { batchResultSeverity, describeBatchResult, summarizeBatchResults } from "@/lib/domain/bank-transaction-batch";
import type { CodeOutcome } from "@/lib/services/coding";
import { codeFromSuggestionsAction } from "./actions";

export interface CodeAllRow {
  id: string;
  accountId: string;
  txnDate: string;
  description: string;
  amount: string;
  accountLabel: string;
  why: string;
}

/**
 * Every line Code all is about to post, with where it goes and why — then,
 * after posting, what happened to each. A line whose suggestion changed since
 * the list was drawn is not posted, and says so.
 */
export default function CodeAllModal({
  rows,
  onClose,
  onDone,
}: {
  rows: CodeAllRow[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<CodeOutcome[] | null>(null);
  const list = rows ?? [];
  const summary = outcomes ? summarizeBatchResults(outcomes, 0) : null;
  const byId = new Map(list.map((row) => [row.id, row]));

  async function post() {
    setSaving(true);
    const res = await codeFromSuggestionsAction(list.map((row) => ({ transactionId: row.id, accountId: row.accountId })));
    setSaving(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not code these lines");
      return;
    }
    setOutcomes(res.data.outcomes);
  }

  function close() {
    const posted = outcomes !== null;
    setOutcomes(null);
    if (posted) onDone();
    else onClose();
  }

  const columns: TableColumnsType<CodeAllRow> = [
    { title: "Date", key: "date", dataIndex: "txnDate", width: COLUMN.DATE },
    {
      ...flexColumn<CodeAllRow>({
        title: "Line",
        key: "line",
        render: (_: unknown, row: CodeAllRow) => (
          <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
            <Typography.Text ellipsis={{ tooltip: row.description }}>{row.description}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: row.why }}>
              {row.why}
            </Typography.Text>
          </Space>
        ),
      }),
    },
    { title: "Amount", key: "amount", dataIndex: "amount", width: COLUMN.MONEY, align: "right" },
    {
      title: "Posts to",
      key: "account",
      width: COLUMN.PICKER,
      render: (_: unknown, row: CodeAllRow) => (
        <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
      ),
    },
  ];

  return (
    <Modal
      open={rows !== null}
      title={summary ? "Coded from suggestions" : `Code ${list.length} line${list.length === 1 ? "" : "s"} from their suggestions`}
      width={980}
      onCancel={close}
      destroyOnHidden
      footer={
        summary
          ? [
              <Button key="close" type="primary" onClick={close}>
                Close
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={close}>
                Cancel
              </Button>,
              <Button key="post" type="primary" loading={saving} onClick={post}>
                Post {list.length} line{list.length === 1 ? "" : "s"}
              </Button>,
            ]
      }
    >
      {summary ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert type={batchResultSeverity(summary)} showIcon title={describeBatchResult(summary)} />
          {summary.failures.length > 0 ? (
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {summary.failures.map((failure) => {
                const row = byId.get(failure.id);
                return (
                  <div key={failure.id} style={{ marginBottom: 8 }}>
                    <Typography.Text>{row ? `${row.txnDate} · ${row.description} · ${row.amount}` : failure.id}</Typography.Text>
                    <br />
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {failure.error}
                    </Typography.Text>
                  </div>
                );
              })}
            </div>
          ) : null}
        </Space>
      ) : (
        <>
          <Typography.Paragraph>
            Each line is posted to the account shown, exactly as if it were chosen in its Category cell. Nothing else changes, and
            any of them can be taken back afterwards with Change.
          </Typography.Paragraph>
          <DataTable<CodeAllRow> rowKey="id" columns={columns} dataSource={list} />
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: The Category cell**

In `app/(app)/banking/CategoriseCell.tsx`:

- add to the imports:

```ts
import type { CodingSuggestionView } from "@/lib/domain/coding";
```

- in `CategoriseCellProps`, after `onChanged: () => void;` add:

```ts
  /** What a rule or history suggests for this line, when it is waiting. */
  suggestion?: CodingSuggestionView | null;
  /** Opens the rule form, filled from this line. */
  onCreateRule?: () => void;
```

- add `suggestion = null,` and `onCreateRule,` to the destructured props;
- replace the `onChange={async (accountId: string) => { … }}` handler of the `Select` with `onChange={(accountId: string) => void post(accountId)}`, and add above `if (posting) {` this function (it is the old handler's body):

```tsx
  async function post(accountId: string) {
    setBusy(true);
    const res = await categoriseBankTransactionAction(transactionId, accountId);
    setBusy(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not categorise this line");
      return;
    }
    message.success(
      `Posted to ${res.data.account_code} — ${res.data.account_name}` +
        (res.data.entry_number ? ` as ${res.data.entry_number}` : ""),
    );
    onChanged();
  }

  const hint = suggestion ? (
    <Tooltip title={suggestion.why}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
        {suggestion.source === "rule"
          ? `${suggestion.short} → ${suggestion.accountLabel}`
          : `Usually ${suggestion.accountLabel} · ${suggestion.short}`}
      </Typography.Text>
    </Tooltip>
  ) : null;
  const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
```

- in the posting branch, right after the `Change` button's closing `) : null}`, add:

```tsx
          {canWrite && onCreateRule ? (
            <Button type="link" size="small" style={linkStyle} onClick={onCreateRule}>
              Create rule
            </Button>
          ) : null}
```

- replace `if (!canWrite) return <Typography.Text type="secondary">—</Typography.Text>;` with:

```tsx
  if (!canWrite) return hint ?? <Typography.Text type="secondary">—</Typography.Text>;
```

- wrap the final `return ( <Tooltip …> <Select …/> </Tooltip> );` so it becomes:

```tsx
  return (
    <Space direction="vertical" size={0} style={{ width: "100%" }}>
      <Tooltip title="Choosing an account posts this line to the ledger">
        {/* the existing <Select …/> unchanged, except its onChange as above */}
      </Tooltip>
      <Space size={6} wrap>
        {hint}
        {suggestion ? (
          <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => void post(suggestion.accountId)}>
            Use
          </Button>
        ) : null}
        {onCreateRule ? (
          <Button type="link" size="small" style={linkStyle} onClick={onCreateRule}>
            Create rule
          </Button>
        ) : null}
      </Space>
    </Space>
  );
```

(Keep the existing `Select` element and its comments exactly as they are inside the `Tooltip`; only its `onChange` changes.)

- [ ] **Step 5: The table**

In `app/(app)/banking/BankTransactionsTable.tsx`:

- add `import type { CodingSuggestionView } from "@/lib/domain/coding";`;
- in `BankTransactionsTableProps`, after `onCategorised: () => void;` add:

```ts
  /** The coding suggestion for each waiting line, keyed by transaction. */
  codingSuggestions: Map<string, CodingSuggestionView>;
  /** Open the rule form for a line; the account is the one it is posted to or suggested for. */
  onCreateRule: (row: BankReviewTableRow, accountId: string | null) => void;
```

- add `codingSuggestions,` and `onCreateRule,` to the destructured props;
- the Category column's `render` becomes:

```tsx
      render: (_value: unknown, row: BankReviewTableRow) => {
        const posting = postings.get(row.transaction.id) ?? null;
        const suggestion = codingSuggestions.get(row.transaction.id) ?? null;
        return (
          <CategoriseCell
            transactionId={row.transaction.id}
            status={row.transaction.status}
            accounts={postableAccounts}
            posting={posting}
            canWrite={canWrite}
            onChanged={onCategorised}
            suggestion={suggestion}
            onCreateRule={() => onCreateRule(row, posting?.account_id ?? suggestion?.accountId ?? null)}
          />
        );
      },
```

- [ ] **Step 6: The screen**

In `app/(app)/banking/BankingClient.tsx`:

- in the import block from `"./actions"`, add `getCodingSuggestionsAction,` beside `getTransactionsAction,`;
- add imports:

```ts
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { directionOf, historyKeys } from "@/lib/domain/coding-names";
import CodingSuggestionsBar from "./CodingSuggestionsBar";
import CodeAllModal, { type CodeAllRow } from "./CodeAllModal";
import RuleFormModal, { EMPTY_RULE, type RuleFormValues } from "./rules/RuleFormModal";
```

- after `const [batchTarget, setBatchTarget] = useState<BatchAssignTarget | null>(null);` add:

```ts
  const [coding, setCoding] = useState<Map<string, CodingSuggestionView>>(new Map());
  const [codeAllRows, setCodeAllRows] = useState<CodeAllRow[] | null>(null);
  const [ruleSeed, setRuleSeed] = useState<RuleFormValues | null>(null);
```

- in `reload`, right after `setLoading(false);` add (suggestions arrive on their own, so the lines never wait for them):

```ts
    void getCodingSuggestionsAction(accountFilter).then((coded) => {
      if (coded.ok && coded.data) setCoding(new Map(coded.data.map((s) => [s.transactionId, s])));
    });
```

- after the `postableAccounts` `useMemo` add:

```ts
  // A rule may code only to an account a suggestion could name.
  const ruleAccounts = useMemo(
    () => postableAccounts.filter((account) => codableAccount(codingAccountOf(account))),
    [postableAccounts],
  );
```

- immediately before `      <BankTransactionsTable` insert:

```tsx
      <CodingSuggestionsBar
        rows={reviewRows}
        suggestions={coding}
        canWrite={canWrite}
        formatRowMoney={rowMoney}
        onCodeAll={setCodeAllRows}
      />
```

- in the `<BankTransactionsTable …>` props, after `onCategorised={reload}` add:

```tsx
        codingSuggestions={coding}
        onCreateRule={(row, accountId) =>
          setRuleSeed({
            ...EMPTY_RULE,
            matchText: historyKeys(row.transaction.merchant_name || row.transaction.description)[0] ?? "",
            direction: directionOf(Number(row.transaction.amount_minor)),
            accountId,
          })
        }
```

- immediately before `      <DeleteBankLineModal` insert:

```tsx
      <CodeAllModal
        rows={codeAllRows}
        onClose={() => setCodeAllRows(null)}
        onDone={() => {
          setCodeAllRows(null);
          reload();
        }}
      />

      <RuleFormModal
        open={ruleSeed !== null}
        ruleId={null}
        initial={ruleSeed ?? EMPTY_RULE}
        accounts={ruleAccounts}
        onClose={() => setRuleSeed(null)}
        onSaved={() => {
          setRuleSeed(null);
          reload();
        }}
      />
```

(If `postableAccounts` is declared after the point where `ruleAccounts` would go, declare `ruleAccounts` right after it; if it is a `useMemo`, wrap `ruleAccounts` in `useMemo(() => …, [postableAccounts])`.)

- [ ] **Step 7: Typecheck, lint and the gates**

Run: `npm run typecheck`; `npx eslint "app/(app)/banking"`; `npx vitest run tests/unit/bank-categories-ui-contract.test.ts tests/unit/bank-transaction-columns.test.ts tests/unit/bank-review-queue.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/rsc-antd.test.ts`.
Expected: exit 0; PASS. If a UI contract test pins the Category cell's old markup, update it to the new behaviour and say so. Do not start the app: 0126 is not live yet.

- [ ] **Step 8: Commit**

```bash
git add -- "app/(app)/banking/CodingSuggestionsBar.tsx" "app/(app)/banking/CodeAllModal.tsx" "app/(app)/banking/banking-coding.module.css" "app/(app)/banking/CategoriseCell.tsx" "app/(app)/banking/BankTransactionsTable.tsx" "app/(app)/banking/BankingClient.tsx"
printf '%s\n' "feat(coding): suggestions, Use, Code all and Create rule on Bank Transactions" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 9: Changelog 1.70, and the four gates

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`

- [ ] **Step 1: Add release 1.70** as the first element of `RELEASES`:

```ts
  {
    version: "1.70",
    date: "2026-09-29",
    headline: "Bank lines suggest their own account — from your rules, or from how you coded them before.",
    changes: [
      {
        kind: "added",
        title: "Suggestions on bank lines waiting to be coded",
        detail:
          "A waiting line shows the account it usually goes to — \"Usually 6300 Rent · 11 of 11\" — once the same name has gone to the same account at least twice and at least three times in four. Use posts it; nothing is posted until someone does. A line that already matches an entry in the ledger gets no suggestion.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Code all",
        detail:
          "Above Bank Transactions, a count of the waiting lines that have a suggestion, and a button that posts up to 100 of them after listing each one with where it goes and why. A line whose suggestion changed in the meantime is not posted, and says so.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Bank rules",
        detail:
          "Banking › Rules: words or a regular expression, money in or out, an amount range, and the account. The first rule that matches suggests the account, ahead of history. Each rule shows how many waiting lines it matches; rules can be reordered, switched off and deleted, and every change is in the audit log.",
        route: "/banking/rules",
      },
      {
        kind: "added",
        title: "Create a rule from a bank line",
        detail: "Create rule under a line's Category opens the rule form filled from that line — its name, its direction and its account.",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: Run the four gates, reading each output in full**

```bash
npm test > "$SCRATCH/gate-170-test.txt" 2>&1; echo "exit $?"
npm run typecheck > "$SCRATCH/gate-170-tsc.txt" 2>&1; echo "exit $?"
npm run lint > "$SCRATCH/gate-170-lint.txt" 2>&1; echo "exit $?"
npm run build > "$SCRATCH/gate-170-build.txt" 2>&1; echo "exit $?"
```

Expected: every test file passes; typecheck, lint (0 errors) and build exit 0. Use a 600000 ms timeout for the build.

- [ ] **Step 3: Commit**

```bash
git add -- lib/domain/changelog.ts
printf '%s\n' "chore(changelog): 1.70, coding that learns" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 10: Measure, apply, look (controller)

- [ ] Show the user the output of `scripts/evaluate-coding-history.mjs` (Task 5) and ask whether the chosen thresholds (2 entries, three in four) stand; change `HISTORY_MIN` / `HISTORY_SHARE` only on their word.
- [ ] Ask the user to approve applying migration 0126 to every company. Only after approval: `node --env-file=.env.local scripts/migrate.mjs`; confirm `0126_bank_rules.sql` is recorded in every schema.
- [ ] `timeout 400 node --env-file=.env.local scripts/verify-bank-rules.mjs` on the applied books.
- [ ] Build, start detached (PowerShell `Start-Process npm.cmd start`), `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`.
- [ ] Temporary read-only Playwright script (deleted after), waiting for "N results" to be non-zero before measuring: Bank Transactions on a company with waiting lines (suggestions, the bar, the Code all list opened and cancelled, the rule form opened from a line and cancelled), Banking › Rules (empty state and the New rule form with its preview — opened, never saved), light and dark; every table fits at 1280 and 1470. Review the pictures, fix, re-shoot.
- [ ] Show the user; push only after their approval. The PR merges only after 0126 is live (it is, by this step), and after `fix/banking-paged-reads` (1.69).
