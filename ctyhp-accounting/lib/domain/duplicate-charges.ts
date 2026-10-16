import { daysFromTo } from "@/lib/domain/bank-standing";
import type { BankLine } from "@/lib/domain/statement-alerts";

/**
 * Charges repeated to the same payee: a second look, never an action.
 *
 * Pure. Takes each bank account's posted lines (reversed entries and their
 * reversals are already left out by the reader) and the company's today, and
 * returns the pairs worth a person's attention. Design record:
 * docs/superpowers/specs/2026-10-15-duplicate-charges-design.md
 */

/** Longest gap between two charges that can still be a repeat. */
export const DUPLICATE_MAX_GAP_DAYS = 30;
/** A rhythm is only a rhythm when the usual gap is at least this long. */
export const RHYTHM_MIN_MEDIAN_DAYS = 6;
/** How far from the usual gap a charge may land and still keep the rhythm. */
export const RHYTHM_TOLERANCE_DAYS = 3;
/** Lines a payee needs before it has a usual description. */
export const MODAL_SHAPE_MIN_LINES = 3;

const CHANNEL_WORDS = ["pos", "debit", "purchase", "card", "checkcard", "recurring", "ach", "www", "com"] as const;
const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNEL_WORDS);
/** The channel words that describe how the payment was made, not where the web is. */
const SHAPE_CHANNEL_WORDS = CHANNEL_WORDS.filter((w) => w !== "www" && w !== "com");

/**
 * The payee, reduced to what stays the same between two ways of writing it.
 *
 * Lower-case, channel words out, digits and punctuation out, first two words.
 * Empty when nothing is left, and an empty key is never grouped.
 */
/**
 * Letters without their accents, so "Công Ty Hùng Phát" keys as "cong ty"
 * rather than splitting at every accented letter ("c ng").
 */
function plainLetters(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

export function duplicatePayeeKey(text: string): string {
  const words = plainLetters(text)
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w !== "" && !CHANNEL_SET.has(w));
  return words.slice(0, 2).join(" ");
}

/**
 * A coarse pattern of a description that tells formats apart: the channel
 * words it holds, a web suffix, and a digit run written as "9". The merchant's
 * name is not part of it.
 */
export function descriptionShape(text: string): string {
  const lower = plainLetters(text).toLowerCase();
  const words = new Set(lower.split(/[^a-z]+/).filter(Boolean));
  const parts: string[] = SHAPE_CHANNEL_WORDS.filter((w) => words.has(w));
  if (/\.com\b/.test(lower) || words.has("www")) parts.push(".com");
  if (/\d/.test(lower)) parts.push("9");
  return parts.join(" ");
}

export interface DuplicateChargeLine {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  /** Magnitude of the charge, base currency minor units. */
  amountMinor: number;
  payee: string;
  /** The text the shape was read from: the narration, else the payee. */
  text: string;
  /** Ticked in a completed reconciliation. */
  cleared: boolean;
}

export interface DuplicateCharge {
  bankAccountId: string;
  accountName: string;
  earlier: DuplicateChargeLine;
  later: DuplicateChargeLine;
  /** The line to review. */
  reviewLineId: string;
  reviewSide: "earlier" | "later";
  daysApart: number;
  /** The line to review is written differently from the payee's usual lines. */
  outlier: boolean;
  /** The payee's other charge lines on this account in the window. */
  otherPayeeLines: number;
}

export interface DuplicateAccountInput {
  bankAccountId: string;
  accountName: string;
  lines: readonly BankLine[];
}

/** The first day of the window: the same day a year before `today`. */
export function duplicateWindowStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const byDateThenId = (a: BankLine, b: BankLine): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0;

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const textOf = (line: BankLine): string => (line.narration.trim() !== "" ? line.narration : line.payee);

function toLine(line: BankLine): DuplicateChargeLine {
  return {
    lineId: line.lineId,
    entryId: line.entryId,
    entryNumber: line.entryNumber,
    date: line.date,
    amountMinor: Math.abs(line.amountMinor),
    payee: line.payee,
    text: textOf(line),
    cleared: line.cleared,
  };
}

/** The most common shape among `shapes`, or null when fewer than 3 or no single winner. */
function modalShape(shapes: readonly string[]): string | null {
  if (shapes.length < MODAL_SHAPE_MIN_LINES) return null;
  const counts = new Map<string, number>();
  for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [s, n] of counts) {
    if (n > bestCount) {
      best = s;
      bestCount = n;
      tie = false;
    } else if (n === bestCount) tie = true;
  }
  return tie ? null : best;
}

export function findDuplicateCharges(
  accounts: readonly DuplicateAccountInput[],
  today: string,
): DuplicateCharge[] {
  const start = duplicateWindowStart(today);
  const found: DuplicateCharge[] = [];

  for (const account of accounts) {
    const charges = account.lines
      .filter((l) => l.amountMinor < 0 && l.date >= start && l.date <= today)
      .sort(byDateThenId);

    const byKey = new Map<string, BankLine[]>();
    for (const l of charges) {
      const key = duplicatePayeeKey(l.payee);
      if (key === "") continue;
      const list = byKey.get(key);
      if (list) list.push(l);
      else byKey.set(key, [l]);
    }

    for (const payeeLines of byKey.values()) {
      const modal = modalShape(payeeLines.map((l) => descriptionShape(textOf(l))));

      const byAmount = new Map<number, BankLine[]>();
      for (const l of payeeLines) {
        const list = byAmount.get(l.amountMinor);
        if (list) list.push(l);
        else byAmount.set(l.amountMinor, [l]);
      }

      for (const group of byAmount.values()) {
        if (group.length < 2) continue;
        const gaps = group.slice(1).map((l, i) => daysFromTo(group[i].date, l.date) ?? Infinity);
        const usual = group.length >= 3 ? median(gaps) : null;

        const rhythm = usual !== null && usual >= RHYTHM_MIN_MEDIAN_DAYS;
        const isCandidate = (i: number): boolean =>
          i < gaps.length &&
          gaps[i] <= DUPLICATE_MAX_GAP_DAYS &&
          !(rhythm && Math.abs(gaps[i] - usual!) <= RHYTHM_TOLERANCE_DAYS);

        for (let i = 0; i < gaps.length; i += 1) {
          if (!isCandidate(i)) continue;

          const first = group[i];
          const second = group[i + 1];
          let gap = gaps[i];
          let reviewSide: "earlier" | "later" = "later";

          // An extra payment between two regular ones breaks the rhythm on both
          // sides. Its neighbours are the regular payments, so only the extra
          // line is offered, paired with the earlier regular payment.
          let extra = false;
          if (rhythm && isCandidate(i + 1)) {
            const across = daysFromTo(first.date, group[i + 2].date);
            if (across !== null && Math.abs(across - usual!) <= RHYTHM_TOLERANCE_DAYS) {
              extra = true;
              i += 1; // the (B, C) pair is this same extra payment
            }
          }
          if (extra) {
            if (second.cleared) continue; // a signed-off extra is not offered
          } else {
            if (first.cleared && second.cleared) continue;
            if (second.cleared && !first.cleared) reviewSide = "earlier";
          }
          gap = gaps[extra ? i - 1 : i];
          const review = reviewSide === "later" ? second : first;
          found.push({
            bankAccountId: account.bankAccountId,
            accountName: account.accountName,
            earlier: toLine(first),
            later: toLine(second),
            reviewLineId: review.lineId,
            reviewSide,
            daysApart: gap,
            outlier: modal !== null && descriptionShape(textOf(review)) !== modal,
            otherPayeeLines: payeeLines.length - 1,
          });
        }
      }
    }
  }

  return found.sort((a, b) => {
    if (a.outlier !== b.outlier) return a.outlier ? -1 : 1;
    const ad = a.later.date;
    const bd = b.later.date;
    if (ad !== bd) return ad < bd ? 1 : -1;
    return a.later.lineId < b.later.lineId ? -1 : a.later.lineId > b.later.lineId ? 1 : 0;
  });
}
