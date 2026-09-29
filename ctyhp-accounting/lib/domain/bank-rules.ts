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
