/**
 * A credit card as a bank account (2.45): which accounts are cards, and their
 * amounts said the way a card statement says them.
 *
 * The books keep every bank account's lines and balances debit positive. For a
 * card — a liability — that makes a charge negative, a payment positive and
 * the balance owed negative, which is also how a card's CSV, OFX and bank feed
 * sign them, so importing, coding, pairing and the reconciliation's own
 * arithmetic need nothing new. A card statement prints the other way round:
 * the balance owed and the charges positive, payments and credits negative.
 * The screens that set the books beside a statement — the import dialog's
 * proof and lines, a reconciliation's list, workspace and report — show a
 * card's amounts that way, and read typed balances that way.
 *
 * Every flip is here. A screen turns its data round once, where it arrives,
 * and every helper after it works on figures that agree with each other —
 * pairing by amount, the opening and closing advice, the difference's parts,
 * the proof — and turns figures it sends back the books' way round with
 * `stored`. The flip is its own inverse. Pure.
 */

/** Which way round a bank account's amounts are shown: as the books keep them, or as a card statement prints them. */
export type BalanceSide = "bank" | "card";

export function isCardAccountType(accountType: string | null | undefined): boolean {
  return accountType === "credit_card";
}

export function balanceSideOf(accountType: string | null | undefined): BalanceSide {
  return isCardAccountType(accountType) ? "card" : "bank";
}

/** An amount the books keep, as the screen shows it. Zero stays zero, never −0. */
export function shown(minor: number, side: BalanceSide): number {
  return side === "card" && minor !== 0 ? -minor : minor;
}

/** An amount as the screen shows it, or as a person typed it, the way the books keep it. */
export const stored = shown;

const shownOrNull = (minor: number | null, side: BalanceSide) => (minor === null ? null : shown(minor, side));

/** A reconciliation's figures, shown. */
export function cardDetail<
  T extends {
    beginningMinor: number;
    statementEndingMinor: number;
    clearedTotalMinor: number;
    reconciledBalanceMinor: number;
    differenceMinor: number;
  },
>(detail: T, side: BalanceSide): T {
  if (side !== "card") return detail;
  return {
    ...detail,
    beginningMinor: shown(detail.beginningMinor, side),
    statementEndingMinor: shown(detail.statementEndingMinor, side),
    clearedTotalMinor: shown(detail.clearedTotalMinor, side),
    reconciledBalanceMinor: shown(detail.reconciledBalanceMinor, side),
    differenceMinor: shown(detail.differenceMinor, side),
  };
}

/** A statement a reconciliation keeps — its opening, closing and lines — shown. */
export function cardStatement<
  L extends { amountMinor: number; balanceMinor: number | null },
  T extends { openingMinor: number | null; closingMinor: number | null; lines: readonly L[] },
>(statement: T, side: BalanceSide): T {
  if (side !== "card") return statement;
  return {
    ...statement,
    openingMinor: shownOrNull(statement.openingMinor, side),
    closingMinor: shownOrNull(statement.closingMinor, side),
    lines: statement.lines.map((line) => ({
      ...line,
      amountMinor: shown(line.amountMinor, side),
      balanceMinor: shownOrNull(line.balanceMinor, side),
    })),
  };
}

/** The book lines a reconciliation ticks, shown. */
export function cardBookLines<L extends { signedMinor: number }>(lines: readonly L[], side: BalanceSide): L[] {
  return side !== "card" ? [...lines] : lines.map((line) => ({ ...line, signedMinor: shown(line.signedMinor, side) }));
}

/** What bringing an account's history forward rests on, shown. */
export function cardHistoryFacts<T extends { openingMinor: number; bookBalanceMinor: number }>(
  facts: T,
  side: BalanceSide,
): T {
  if (side !== "card") return facts;
  return { ...facts, openingMinor: shown(facts.openingMinor, side), bookBalanceMinor: shown(facts.bookBalanceMinor, side) };
}

/** How an account stands against its statements (bank-standing.ts), shown. */
export function cardStanding<
  T extends {
    lastClosingMinor: number | null;
    sinceNetMinor: number;
    earlierOpenNetMinor: number;
    voidTickedMinor: number;
    bookMinor: number;
  },
>(standing: T, side: BalanceSide): T {
  if (side !== "card") return standing;
  return {
    ...standing,
    lastClosingMinor: shownOrNull(standing.lastClosingMinor, side),
    sinceNetMinor: shown(standing.sinceNetMinor, side),
    earlierOpenNetMinor: shown(standing.earlierOpenNetMinor, side),
    voidTickedMinor: shown(standing.voidTickedMinor, side),
    bookMinor: shown(standing.bookMinor, side),
  };
}

/** "Add all N to the books": the lines it would add, holds back and cannot add, shown. */
export function cardAddPlan<
  T extends {
    items: readonly { amountMinor: number }[];
    held: readonly { amountMinor: number }[];
    cannot: readonly { amountMinor: number }[];
  },
>(plan: T, side: BalanceSide): T {
  if (side !== "card") return plan;
  const flip = <L extends { amountMinor: number }>(lines: readonly L[]) =>
    lines.map((line) => ({ ...line, amountMinor: shown(line.amountMinor, side) }));
  return { ...plan, items: flip(plan.items), held: flip(plan.held), cannot: flip(plan.cannot) };
}

/** Statement lines as read from a file, shown: the import dialog proves and lists these. */
export function cardStatementLines<L extends { amount_minor: number; running_balance_minor: number | null }>(
  lines: readonly L[],
  side: BalanceSide,
): L[] {
  if (side !== "card") return lines as L[];
  return lines.map((line) => ({
    ...line,
    amount_minor: shown(line.amount_minor, side),
    running_balance_minor: shownOrNull(line.running_balance_minor, side),
  }));
}

/** What a file says about its balances (statement-proof.ts StatementFigures), shown. */
export function cardFigures<T extends { openingMinor?: number | null; closingMinor?: number | null; ledgerMinor?: number | null }>(
  figures: T | undefined,
  side: BalanceSide,
): T | undefined {
  if (side !== "card" || !figures) return figures;
  const flip = (minor: number | null | undefined) => (minor === null || minor === undefined ? minor : shown(minor, side));
  return { ...figures, openingMinor: flip(figures.openingMinor), closingMinor: flip(figures.closingMinor), ledgerMinor: flip(figures.ledgerMinor) };
}

/** A proof the dialog worked out as shown, the books' way round for the server. */
export function storedProof<T extends { opening_minor: number | null; closing_minor: number | null }>(
  proof: T,
  side: BalanceSide,
): T {
  if (side !== "card") return proof;
  return { ...proof, opening_minor: shownOrNull(proof.opening_minor, side), closing_minor: shownOrNull(proof.closing_minor, side) };
}

/** The words for a bank account's balances, by side. */
export interface BalanceWords {
  /** The kind, beside the account's name: "Credit card". Null for a bank account. */
  kind: string | null;
  beginning: string;
  ending: string;
  /** The New reconciliation form's field. */
  endingInput: string;
  /** Said once on a card's screens, so a negative payment reads as meant. */
  note: string | null;
}

export const BALANCE_WORDS: Record<BalanceSide, BalanceWords> = {
  bank: {
    kind: null,
    beginning: "Beginning",
    ending: "Statement ending",
    endingInput: "Statement ending balance",
    note: null,
  },
  card: {
    kind: "Credit card",
    beginning: "Beginning balance owed",
    ending: "Statement balance owed",
    endingInput: "Statement balance owed (the New balance on the statement)",
    note: "A credit card is shown the way its statement prints it: the balance owed and charges are positive, payments and credits negative.",
  },
};

/** "Example Card Issuer · 2050 · credit card": a bank account's label, saying when it is a card. */
export function bankAccountLabel(label: string, side: BalanceSide): string {
  return side === "card" ? `${label} · credit card` : label;
}

/** The import dialog's "Flip signs" box, worded for the account. */
export function flipSignsLabel(side: BalanceSide): string {
  return side === "card"
    ? "Flip signs: my file shows charges as positive"
    : "Flip signs: my file shows payments as positive";
}

/** Said in the import dialog for a card, after BALANCE_WORDS.card.note. */
export const CARD_IMPORT_NOTE =
  "Type the previous balance and the new balance as the statement prints them. A card's PDF statement is not read yet: choose its CSV, OFX or QFX.";

/** Why a card's PDF statement is not read (2.45): its layout prints charges positive beside a summary block. */
export const CARD_PDF_NOT_READ =
  "PDF statements for a credit card are not read yet. Download the card's activity as a CSV (or OFX/QFX) for the statement period, " +
  "and type the previous balance and the new balance as the statement prints them.";

/** Why Reconcile from statement files does not take a card (2.45). */
export const CARD_FROM_FILES_NOT_READ =
  "A credit card is reconciled one statement at a time: start a New reconciliation with the statement's balance owed, " +
  "then import the card's CSV for the period into it.";
