/**
 * The statement import dialog (2.04): what it shows and what it sends, worked
 * out from what was read and what the person did in it.
 *
 * Pure, so the dialog only draws it and a test proves every state of it: the
 * proof panel's tone and its blocked sentence, who is offered "Import
 * anyway…", when the two balance fields show, the lines ticked Not a
 * transaction left out of what is sent, and the lines already in Bank
 * Transactions from another source skipped unless ticked back. The rule itself
 * is statement-proof's and statement-repeats'; this only puts them together.
 *
 * Banking › Import statement, importing into a reconciliation and Attach the
 * statement open the one dialog. Attaching imports nothing, so it never asks
 * which lines are already in Bank Transactions and says nothing about what
 * will be imported; and a statement that does not add up is never attached,
 * so nobody is offered "Import anyway…" there.
 */
import { formatDate } from "@/lib/format";
import type { StatementLine } from "./statement-import";
import {
  PROOF_REFUSAL,
  PROOF_TEXT,
  importLinesLabel,
  proofPayload,
  proveStatement,
  statementImportRows,
  statementOverrideSchema,
  type PriorClosing,
  type StatementFigures,
  type StatementImportLine,
  type StatementKind,
  type StatementOverride,
  type StatementProof,
  type StatementProofPayload,
} from "./statement-proof";
import { describeRepeats, type OtherSourceLine, type RepeatGroup, type StatementLinesCheck } from "./statement-repeats";

/** Why the dialog was opened: to import the statement, or to attach it to a reconciliation (nothing imported). */
export type StatementDialogPurpose = "import" | "attach";

/** What the person did in the dialog, for the statement read. */
export interface DialogMarks {
  /** Indexes into the lines read of those ticked Not a transaction. */
  aside: readonly number[];
  /** Indexes of lines already in Bank Transactions from another source that were ticked back, to be imported after all. */
  back: readonly number[];
  /** "Use $X (the closing of the reconciliation to …)" was pressed. */
  usePrior: boolean;
  /** Typed into "Opening balance printed on the statement". */
  typedOpeningMinor: number | null;
  /** Typed into "Closing balance printed on the statement". */
  typedClosingMinor: number | null;
}

/** Nothing done yet: what a statement starts with each time a file (or another statement of a PDF) is chosen. */
export const NO_MARKS: DialogMarks = {
  aside: [],
  back: [],
  usePrior: false,
  typedOpeningMinor: null,
  typedClosingMinor: null,
};

export interface StatementDialogInput {
  purpose: StatementDialogPurpose;
  kind: StatementKind;
  /** Every line read, in file order. */
  lines: readonly StatementLine[];
  /** What the file says about its balances and period (a PDF's, an OFX's or a QIF's); nothing for a CSV. */
  figures?: StatementFigures;
  /** The account's last completed reconciliation, or null when it has none (or it is still being read). */
  prior: PriorClosing | null;
  marks: DialogMarks;
  /**
   * Which of these lines are already in Bank Transactions with these Not a
   * transaction ticks (checkStatementLinesFrom: worked out in the browser on
   * every tick, from what the server sent once for the statement read); null
   * while that is being fetched, or when it could not be. Never asked when
   * attaching.
   */
  check: StatementLinesCheck | null;
  /**
   * The person is an administrator, and so is offered "Import anyway…". Read
   * the way every screen reads the role; the database decides again.
   */
  canOverride: boolean;
}

/** How the proof panel reads: the statement adds up, is out, or lacks a balance. */
export type ProofTone = "adds" | "out" | "missing";

export interface StatementDialogView {
  proof: StatementProof;
  tone: ProofTone;
  /**
   * When a balance is missing: which, in the server's own words — "The
   * statement has no closing balance; enter the one printed on the
   * statement." Null otherwise.
   */
  missingText: string | null;
  /** "Import is blocked until the statement adds up." (attaching: "Attaching is blocked …"); null when it adds up. */
  blocked: string | null;
  /**
   * Importing anyway, when the statement is out: the "Import anyway…" button
   * for an administrator, "An administrator can import it anyway, with a
   * reason." for anyone else. Null when it adds up, when a balance is missing
   * (the server never takes a statement without both), and when attaching.
   */
  override: "button" | "sentence" | null;
  /** "Opening balance printed on the statement": shown while the opening is missing or typed. */
  showOpeningField: boolean;
  /** "Closing balance printed on the statement": shown while the closing is missing or typed. */
  showClosingField: boolean;
  /** "Use $X (…)" while the prior statement's closing is on offer; `taken` once pressed. */
  priorOffer: { label: string; taken: boolean } | null;
  /** The lines already in Bank Transactions from another source, those ticked Not a transaction left out. */
  otherSource: OtherSourceLine[];
  /** Their indexes, less those ticked back: skipped, counted in the proof and not imported. */
  skip: number[];
  /** The file's sets of identical lines, and what becomes of each; none when attaching. */
  repeats: RepeatGroup[];
  /** Importing, while the server has not yet said which lines are already here: nothing can be sent. */
  checking: boolean;
  /** The import's button: "Import 42 lines", one click when the statement adds up. */
  okLabel: string;
  okDisabled: boolean;
}

const MISSING_TEXT = {
  opening: PROOF_REFUSAL.noOpening,
  closing: PROOF_REFUSAL.noClosing,
  both: PROOF_REFUSAL.noBalances,
} as const;

/** What the dialog shows for the statement read and what the person has done with it. */
export function statementDialogView(
  input: StatementDialogInput,
  money: (minor: number) => string,
): StatementDialogView {
  const importing = input.purpose === "import";
  const { marks } = input;
  const proof = proveStatement(
    {
      kind: input.kind,
      lines: input.lines,
      aside: marks.aside,
      figures: input.figures,
      prior: input.prior,
      usePrior: marks.usePrior,
      typedOpeningMinor: marks.typedOpeningMinor,
      typedClosingMinor: marks.typedClosingMinor,
    },
    money,
  );
  const tone: ProofTone = proof.proves ? "adds" : proof.differenceMinor === null ? "missing" : "out";

  const check = importing ? input.check : null;
  const aside = new Set(marks.aside);
  const back = new Set(marks.back);
  const otherSource = (check?.otherSource ?? []).filter((line) => !aside.has(line.index));
  const skip = otherSource.filter((line) => !back.has(line.index)).map((line) => line.index);
  const repeats = check ? describeRepeats(input.lines, marks.aside, check.present, skip, money) : [];
  const checking = importing && input.lines.length > 0 && input.check === null;

  const onOffer = proof.prior.status === "offered" || proof.prior.status === "taken";
  return {
    proof,
    tone,
    missingText: proof.missing ? MISSING_TEXT[proof.missing] : null,
    blocked: proof.proves ? null : importing ? PROOF_TEXT.blocked : PROOF_TEXT.attachBlocked,
    override: importing && tone === "out" ? (input.canOverride ? "button" : "sentence") : null,
    showOpeningField: proof.openingMinor === null || proof.openingBasis === "typed",
    showClosingField: proof.closingMinor === null || proof.closingBasis === "typed",
    priorOffer:
      onOffer && proof.sentences.usePrior
        ? { label: proof.sentences.usePrior, taken: proof.prior.status === "taken" }
        : null,
    otherSource,
    skip,
    repeats,
    checking,
    okLabel: input.lines.length ? importLinesLabel(proof.lineCount) : "Import",
    okDisabled: proof.lineCount === 0 || !proof.proves || checking,
  };
}

/** What the dialog hands the screen that opened it, to send. */
export interface ConfirmedStatementLines {
  /** Every line read but those ticked Not a transaction, in file order; those already here from another source marked skip. */
  rows: StatementImportLine[];
  /** The indexes ticked Not a transaction, in order (Attach the statement sends them with every line read). */
  aside: number[];
  /** The proof as the server takes it; with the administrator's reason only from "Import anyway…". */
  proof: StatementProofPayload;
  /** The sets of identical lines as the dialog showed them, for what is said after the import. */
  repeats: RepeatGroup[];
}

/** What is sent for the statement as the dialog shows it. Pass `override` only from "Import anyway…". */
export function confirmStatement(
  lines: readonly StatementLine[],
  marks: DialogMarks,
  view: Pick<StatementDialogView, "proof" | "skip" | "repeats">,
  override: StatementOverride | null = null,
): ConfirmedStatementLines {
  return {
    rows: statementImportRows(lines, marks.aside, view.skip),
    aside: [...new Set(marks.aside)].sort((a, b) => a - b),
    proof: proofPayload(view.proof, override),
    repeats: view.repeats,
  };
}

// --- Importing anyway -----------------------------------------------------------

/** The dialog "Import anyway…" opens: an administrator's reason, required, kept with the import and in the audit log. */
export const OVERRIDE_DIALOG = {
  title: "Import a statement that does not add up?",
  kept: "The reason is kept with the import and in the audit log.",
  reasonLabel: "Reason",
  placeholder: "Reason (required)",
  ok: "Import anyway",
} as const;

/** The longest reason the database keeps (0143). */
export const OVERRIDE_REASON_MAX = 500;

/** Why the reason typed will not do, in the server's own words, or null when it will: not blank once trimmed, and not too long. */
export function overrideReasonProblem(reason: string): string | null {
  const parsed = statementOverrideSchema.safeParse({ reason });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Give a reason for importing a statement that does not add up");
}

// --- The lines preview ------------------------------------------------------------

/**
 * The column, and the tick, that leaves a misread line out: struck through, not
 * counted and not sent. The reconciliation's own word for the same thing (2.03).
 */
export { NOT_A_TRANSACTION } from "./reconcile-statement";

/** Said under the other-source warning: those lines are skipped by default, and each can be ticked back. */
export const OTHER_SOURCE_NOTE = "These lines are skipped. Tick one to import it as well.";

/** Said until the dialog has what it needs to say which lines are already in Bank Transactions. */
export const CHECKING_LINES = "Checking the lines against Bank Transactions…";

/** Said when that could not be worked out: nothing is sent until it is. */
export function linesCheckFailed(reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, "") || "the server did not answer";
  return `The lines could not be checked against Bank Transactions (${why}), so nothing can be imported yet. Choose the file again to try once more.`;
}

/** "03/31/2026 · PAYROLL · -$412.30": one line, as the other-source list names it. */
export function previewLineLabel(
  line: Pick<StatementLine, "txn_date" | "description" | "amount_minor">,
  money: (minor: number) => string,
): string {
  return `${formatDate(line.txn_date)} · ${line.description || "(no description)"} · ${money(line.amount_minor)}`;
}
