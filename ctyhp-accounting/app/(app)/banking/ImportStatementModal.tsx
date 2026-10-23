"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Checkbox, Input, Modal, Select, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { guessStatementColumns, readStatementCsv, statementCsvNote } from "@/lib/domain/statement-csv";
import {
  describeStatementParse,
  detectDateOrder,
  parseStatementRows,
  statementColumnsComplete,
  type DateOrder,
  type StatementColumnMap,
  type StatementLine,
  type StatementParseResult,
} from "@/lib/domain/statement-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  parseOfx,
  parseQif,
  type StatementFileResult,
} from "@/lib/domain/statement-files";
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { STATEMENT_READING_NOTE, pickStatement } from "@/lib/domain/pdf-statement-view";
import {
  fileFigures,
  pdfFigures,
  type PriorClosing,
  type StatementFigures,
  type StatementKind,
  type StatementOverride,
} from "@/lib/domain/statement-proof";
import { checkStatementLinesFrom, statementDays, type StatementLineFacts } from "@/lib/domain/statement-line-keys";
import {
  CHECKING_LINES,
  NO_MARKS,
  OVERRIDE_DIALOG,
  OVERRIDE_REASON_MAX,
  confirmStatement,
  linesCheckFailed,
  overrideReasonProblem,
  statementDialogView,
  type ConfirmedStatementLines,
  type DialogMarks,
  type StatementDialogPurpose,
} from "@/lib/domain/statement-import-dialog";
import { serverFailure } from "@/lib/domain/statement-evidence";
import {
  BALANCE_WORDS,
  CARD_IMPORT_NOTE,
  CARD_PDF_NOT_READ,
  cardDateColumn,
  cardFigures,
  cardStatementLines,
  flipSignsLabel,
  shown,
  storedProof,
  type BalanceSide,
} from "@/lib/domain/card-account";
import { formatMoney } from "@/lib/format";
import { rememberColumns, rememberedColumns, type CsvColumnChoice } from "@/lib/client/statement-columns";
import { statementLineKeyTable } from "@/lib/client/statement-line-keys";
import { bankLinesOnAction, priorClosingAction } from "./actions";
import PdfStatementPreview, { ReadingPdf, UnreadableFile, WrongAccountAlert } from "./PdfStatementPreview";
import StatementProofPanel from "./StatementProofPanel";
import StatementLinesPreview from "./StatementLinesPreview";
import { IMPORT_DIALOG_WIDTH } from "./import-preview-columns";
import styles from "./import-statement.module.css";

/**
 * The statement import dialog, in its own file so it is fetched when somebody
 * opens it rather than when they open /banking.
 *
 * It reads the file in the browser — a PDF statement, CSV, OFX, QFX, QBO or QIF
 * — and, for a CSV whose headings it does not know, asks which column is which.
 * A PDF is read by its layout, so it needs no columns.
 *
 * Since 2.04 every statement is proved before it is imported: its opening plus
 * the lines that count must come to its closing, to the cent. The proof panel
 * says whether it does, and the import stays one click when it does. When it
 * does not, the import is blocked until a misread line is ticked Not a
 * transaction or a missing balance is typed; an administrator can import it
 * anyway, with a reason. Before anything can be sent the dialog asks the
 * server, once per statement read, for the account's bank lines over the
 * file's days, and works out in the browser which lines are already in Bank
 * Transactions — again on every tick, with no round trip — so it can count
 * repeated lines and skip the lines already there from another source. What
 * is shown and what is sent are worked out by statementDialogView
 * (lib/domain), not here; the server proves the statement again, and the
 * database a third time.
 *
 * The import itself is a server action of the screen that opened the dialog:
 * Banking opens Review import after it, and a reconciliation pairs the lines
 * with the books. Attach the statement opens it to read a file and import
 * nothing.
 */

/** What the dialog hands the screen that opened it. */
export interface ConfirmedImport extends ConfirmedStatementLines {
  fileName: string;
  /** The file itself, kept as evidence (1.83). */
  file: File;
  /** The PDF statement chosen, with its period and balances; null for any other file. */
  statement: PdfStatement | null;
  /** Every line read, in file order (`rows` is what is sent). */
  lines: StatementLine[];
}

export interface ImportStatementModalProps {
  open: boolean;
  bankAccount: {
    id: string;
    label: string;
    maskedNumber: string | null;
    decimals: number;
    currencyCode: string;
    /**
     * A credit card (2.45): its lines, balances and proof are shown, and its
     * balances typed, as a card statement prints them — charges and the balance
     * owed positive; what is sent goes the books' way round. Its PDFs are not read.
     */
    side?: BalanceSide;
  };
  importing: boolean;
  onConfirm: (confirmed: ConfirmedImport) => void;
  onCancel: () => void;
  /** What happens to the lines, said above the file picker. */
  intro?: ReactNode;
  /**
   * `attach` reads the file to attach it to a reconciliation and imports
   * nothing: no lines are checked against Bank Transactions and nobody can
   * attach a statement that does not add up.
   */
  purpose?: StatementDialogPurpose;
  /**
   * The person is an administrator, read as every screen reads the role: they
   * are offered "Import anyway…". The database decides again.
   */
  canOverride?: boolean;
  /** The dialog's title and button when the file is read for something other than importing it (Attach the statement). */
  title?: string;
  okLabel?: string;
}

const BANKING_INTRO =
  "Choose the file your bank gives you: a PDF statement, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx, " +
  ".qbo, .qif). After the import, Review import proposes an account, a match or a document for every line, and " +
  "nothing is posted until you click Post.";

interface CsvState {
  kind: "csv";
  headers: string[];
  records: Record<string, string>[];
  /** Rows set aside above the headings, or a file with none (2.43); null when neither. */
  note: string | null;
}
type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | CsvState
  | { kind: "file"; format: "OFX" | "QIF"; result: StatementFileResult }
  | { kind: "pdf"; statements: PdfStatement[] };

type CsvChoice = CsvColumnChoice;

const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

const COLUMN_FIELDS: { key: keyof StatementColumnMap; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount (one signed column)" },
  { key: "moneyOut", label: "Money out" },
  { key: "moneyIn", label: "Money in" },
  { key: "reference", label: "Reference" },
  { key: "balance", label: "Balance" },
];

export default function ImportStatementModal({
  open,
  bankAccount,
  importing,
  onConfirm,
  onCancel,
  intro = BANKING_INTRO,
  purpose = "import",
  canOverride = false,
  title,
  okLabel,
}: ImportStatementModalProps) {
  const { message, modal } = App.useApp();
  const side: BalanceSide = bankAccount.side ?? "bank";
  const [fileName, setFileName] = useState("");
  const [chosen, setChosen] = useState<File | null>(null);
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [picked, setPicked] = useState(0);
  // A PDF is read asynchronously; choosing another file meanwhile makes the first answer stale.
  const reading = useRef(0);
  // Which file was chosen last: what the person did in the dialog belongs to it.
  const [token, setToken] = useState(0);

  async function readPdf(chosen: File, token: number) {
    // A card statement's PDF prints charges positive beside a summary block: not read yet (2.45).
    if (side === "card") {
      setFile({ kind: "unsupported", message: CARD_PDF_NOT_READ });
      return;
    }
    setFile({ kind: "reading" });
    const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
    const result = await readPdfStatementFile(chosen, bankAccount.decimals);
    if (token !== reading.current) return;
    if ("message" in result) {
      setFile({ kind: "unsupported", message: result.message });
      return;
    }
    setPicked(pickStatement(result.statements, bankAccount.maskedNumber));
    setFile({ kind: "pdf", statements: result.statements });
  }

  function read(chosen: File) {
    const token = ++reading.current;
    setToken(token);
    setFileName(chosen.name);
    setChosen(chosen);
    setShowColumns(false);
    setChoice(null);
    if (isPdfFile(chosen)) {
      void readPdf(chosen, token);
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== reading.current) return;
      const text = String(reader.result ?? "");
      const verdict = detectStatementFormat(chosen.name, text);
      if ("unsupported" in verdict) {
        setFile({ kind: "unsupported", message: verdict.unsupported });
        return;
      }
      if (verdict.format === "pdf") {
        void readPdf(chosen, token);
        return;
      }
      if (verdict.format === "ofx") {
        setFile({ kind: "file", format: "OFX", result: parseOfx(text, bankAccount.decimals) });
        return;
      }
      if (verdict.format === "qif") {
        setFile({ kind: "file", format: "QIF", result: parseQif(text, { decimals: bankAccount.decimals }) });
        return;
      }
      // A title or summary above the headings is set aside, a file with no
      // headings is read by what its columns hold, and a running balance is
      // never taken for the money that moved (the approved design's reading).
      const csv = readStatementCsv(text);
      const { headers, records } = csv;
      const detected = { columns: guessStatementColumns(headers, records) };
      // A card's lines are dated as its statement counts them: by their post date (2.46).
      const postDate = side === "card" ? cardDateColumn(headers) : null;
      if (postDate) detected.columns = { ...detected.columns, date: postDate };
      const remembered = rememberedColumns(bankAccount.id, headers);
      const next: CsvChoice = remembered ?? {
        columns: detected.columns,
        dateOrder: detectDateOrder(records.map((r) => (detected.columns.date ? r[detected.columns.date] ?? "" : ""))),
        flipSigns: false,
      };
      setFile({ kind: "csv", headers, records, note: statementCsvNote(csv) });
      setChoice(next);
      setShowColumns(!statementColumnsComplete(next.columns));
    };
    reader.readAsText(chosen);
    return false;
  }

  const parsed: (StatementParseResult & { accountId?: string | null }) | null = useMemo(() => {
    if (file.kind === "file") return file.result;
    if (file.kind === "csv" && choice && statementColumnsComplete(choice.columns)) {
      return parseStatementRows(file.records, {
        decimals: bankAccount.decimals,
        columns: choice.columns,
        dateOrder: choice.dateOrder,
        flipSigns: choice.flipSigns,
      });
    }
    return null;
  }, [file, choice, bankAccount.decimals]);

  const statement = file.kind === "pdf" ? (file.statements[picked] ?? file.statements[0]) : null;
  // Every line read, in file order.
  const lines: StatementLine[] = useMemo(
    () => (statement ? toStatementLines(statement) : (parsed?.rows ?? [])),
    [statement, parsed],
  );
  const kind: StatementKind = statement ? "pdf" : file.kind === "file" ? (file.format === "OFX" ? "ofx" : "qif") : "csv";
  const figures: StatementFigures | undefined = useMemo(
    () => (statement ? pdfFigures(statement) : file.kind === "file" ? fileFigures(file.result) : undefined),
    [statement, file],
  );
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);
  const fileAccount = file.kind === "file" ? file.result.accountId : (statement?.accountNumber ?? null);
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);
  const wrongAccountText = `The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`;

  // What the person did — lines ticked, figures typed — belongs to the
  // statement it was done to: another file, another statement of a PDF or
  // other CSV columns start again from nothing.
  const linesKey = `${token}|${picked}|${file.kind === "csv" ? JSON.stringify(choice) : ""}`;
  const [marksOf, setMarksOf] = useState<{ key: string; marks: DialogMarks }>({ key: "", marks: NO_MARKS });
  const marks = marksOf.key === linesKey ? marksOf.marks : NO_MARKS;
  const mark = (change: (current: DialogMarks) => Partial<DialogMarks>) =>
    setMarksOf((was) => {
      const current = was.key === linesKey ? was.marks : NO_MARKS;
      return { key: linesKey, marks: { ...current, ...change(current) } };
    });
  const toggle = (list: readonly number[], index: number, on: boolean) =>
    on ? [...new Set([...list, index])] : list.filter((i) => i !== index);

  // The prior statement's closing: the account's last completed reconciliation.
  // A read that fails leaves it out; the figure can still be typed.
  const [priorOf, setPriorOf] = useState<{ accountId: string; prior: PriorClosing | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const accountId = bankAccount.id;
    priorClosingAction(accountId)
      .then((res) => {
        if (live) setPriorOf({ accountId, prior: res.ok ? (res.data ?? null) : null });
      })
      .catch(() => {
        if (live) setPriorOf({ accountId, prior: null });
      });
    return () => {
      live = false;
    };
  }, [open, bankAccount.id]);
  const prior = priorOf?.accountId === bankAccount.id ? priorOf.prior : null;

  // Which lines are already in Bank Transactions, from this statement or from
  // another source. The server is asked once per statement read, never on a
  // tick: for the account's bank lines over the file's days, with their keys.
  // The lines' own keys are worked out here, once, for every occurrence a line
  // can be sent as. Nothing is imported until both are in. Both belong to the
  // account: its id is part of every key.
  const factsKey = purpose === "import" && lines.length ? `${bankAccount.id}|${linesKey}` : "";
  const [factsOf, setFactsOf] = useState<{
    key: string;
    lines: readonly StatementLine[];
    facts: StatementLineFacts | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    const days = statementDays(lines);
    if (!factsKey || !days) return;
    let live = true;
    const key = factsKey;
    Promise.all([bankLinesOnAction(bankAccount.id, days.from, days.to), statementLineKeyTable(bankAccount.id, lines)])
      .then(([res, keys]) => {
        if (!live) return;
        setFactsOf(
          res.ok
            ? { key, lines, facts: { keys, bankLines: res.data ?? [] }, error: null }
            : { key, lines, facts: null, error: res.error ?? serverFailure(null) },
        );
      })
      .catch((error: unknown) => {
        if (live) setFactsOf({ key, lines, facts: null, error: serverFailure(error) });
      });
    return () => {
      live = false;
    };
  }, [factsKey, bankAccount.id, lines]);
  const factsHere = factsOf?.key === factsKey && factsOf.lines === lines ? factsOf : null;
  const facts = factsHere?.facts ?? null;
  const checkError = factsHere?.error ?? null;
  // Worked out again here on every Not a transaction tick, with no round trip:
  // the keys are counted over the lines sent, as the import counts them.
  const check = useMemo(() => (facts ? checkStatementLinesFrom(lines, marks.aside, facts) : null), [facts, lines, marks.aside]);

  // A credit card's lines, balances and the balances typed are proved and
  // listed as its statement prints them (2.45); the keys, the check against
  // Bank Transactions and what is sent stay the books' way round.
  const shownLines = useMemo(() => cardStatementLines(lines, side), [lines, side]);
  const shownFigures = useMemo(() => cardFigures(figures, side), [figures, side]);
  const shownPrior = useMemo(
    () => (prior && side === "card" ? { ...prior, endingMinor: shown(prior.endingMinor, side) } : prior),
    [prior, side],
  );

  // Worked out again only when something it rests on changes: a statement can
  // hold thousands of lines, and a render for anything else — the import
  // starting, the dialog's own busy state — should not walk them again.
  const { currencyCode, decimals } = bankAccount;
  const view = useMemo(
    () =>
      statementDialogView(
        { purpose, kind, lines: shownLines, figures: shownFigures, prior: shownPrior, marks, check, canOverride },
        (minor) => formatMoney(minor, currencyCode, decimals),
      ),
    [purpose, kind, shownLines, shownFigures, shownPrior, marks, check, canOverride, currencyCode, decimals],
  );
  const aside = useMemo(() => new Set(marks.aside), [marks.aside]);

  function send(override: StatementOverride | null) {
    if (!lines.length || !chosen) return;
    if (file.kind === "csv" && choice) rememberColumns(bankAccount.id, choice);
    // The rows go as read; the proof's balances, worked out as shown, go back the books' way round.
    const confirmed = confirmStatement(lines, marks, view, override);
    onConfirm({ fileName, file: chosen, statement, lines, ...confirmed, proof: storedProof(confirmed.proof, side) });
  }

  function confirm() {
    if (view.okDisabled || importing) return;
    send(null);
  }

  /**
   * "Import anyway…": an administrator's reason, required. The button stays
   * disabled until a reason is typed, and the same rule is checked again
   * before anything is sent; the server and the database check once more.
   */
  function importAnyway() {
    if (view.override !== "button" || view.checking || importing) return;
    let reason = "";
    const dialog = modal.confirm({
      title: OVERRIDE_DIALOG.title,
      content: (
        <Space orientation="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{view.proof.sentences.summary}</Typography.Text>
          <Typography.Text type="secondary">{OVERRIDE_DIALOG.kept}</Typography.Text>
          <Input.TextArea
            aria-label={OVERRIDE_DIALOG.reasonLabel}
            placeholder={OVERRIDE_DIALOG.placeholder}
            maxLength={OVERRIDE_REASON_MAX}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={(e) => {
              reason = e.target.value;
              dialog.update({ okButtonProps: { danger: true, disabled: overrideReasonProblem(reason) !== null } });
            }}
          />
        </Space>
      ),
      okText: OVERRIDE_DIALOG.ok,
      okButtonProps: { danger: true, disabled: true },
      cancelText: "Cancel",
      onOk: async () => {
        const problem = overrideReasonProblem(reason);
        if (problem) {
          message.error(problem);
          throw new Error(problem);
        }
        send({ reason: reason.trim() });
      },
    });
  }

  const okText = purpose === "attach" ? (okLabel ?? "Attach") : (okLabel ?? view.okLabel);

  // Choosing the date column reads that column again for which way round its
  // dates are written; the reader can still override it.
  const setColumn = (key: keyof StatementColumnMap, value: string | null) =>
    setChoice((current) => {
      if (!current) return current;
      const dateOrder =
        key === "date" && value && file.kind === "csv"
          ? detectDateOrder(file.records.map((record) => record[value] ?? ""))
          : current.dateOrder;
      return { ...current, columns: { ...current.columns, [key]: value }, dateOrder };
    });

  return (
    <Modal
      title={title ?? `Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: view.okDisabled, loading: importing }}
      cancelText="Cancel"
      width={IMPORT_DIALOG_WIDTH}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{intro}</Typography.Paragraph>
      {BALANCE_WORDS[side].note ? (
        <Typography.Paragraph type="secondary">
          {`${BALANCE_WORDS[side].note} ${CARD_IMPORT_NOTE}`}
        </Typography.Paragraph>
      ) : null}
      <Upload.Dragger
        accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo,.qif,application/pdf"
        beforeUpload={read}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a statement file here</p>
      </Upload.Dragger>
      {/* Which files are read exactly and which can be misread, wherever the dialog is opened from (2.03). */}
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        {STATEMENT_READING_NOTE}
      </Typography.Text>

      {file.kind === "reading" ? <ReadingPdf /> : null}

      {file.kind === "unsupported" ? <UnreadableFile message={file.message} /> : null}

      {file.kind === "csv" && choice ? (
        <div style={{ marginTop: 12 }}>
          {showColumns ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text strong>Choose columns</Typography.Text>
              <div className={styles.columns}>
                {/* A div, not a label: a label forwards the click to the select
                    inside it, which opens the list and closes it again. */}
                {COLUMN_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {field.label}
                    </Typography.Text>
                    <Select
                      aria-label={field.label}
                      style={{ width: "100%" }}
                      allowClear={!field.required}
                      placeholder="None"
                      value={choice.columns[field.key] ?? undefined}
                      onChange={(value: string | undefined) => setColumn(field.key, value ?? null)}
                      options={file.headers.map((h) => ({ value: h, label: h }))}
                    />
                  </div>
                ))}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Dates
                  </Typography.Text>
                  <Select
                    aria-label="Dates"
                    style={{ width: "100%" }}
                    value={choice.dateOrder}
                    onChange={(value: DateOrder) => setChoice({ ...choice, dateOrder: value })}
                    options={[
                      { value: "mdy", label: "Month/Day/Year" },
                      { value: "dmy", label: "Day/Month/Year" },
                    ]}
                  />
                </div>
              </div>
              <Checkbox checked={choice.flipSigns} onChange={(e) => setChoice({ ...choice, flipSigns: e.target.checked })}>
                {flipSignsLabel(side)}
              </Checkbox>
              {!statementColumnsComplete(choice.columns) ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  Choose the date column, and an amount column or money out and money in.
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Button type="link" style={{ padding: 0 }} onClick={() => setShowColumns(true)}>
              Choose columns
            </Button>
          )}
        </div>
      ) : null}

      {wrongAccount && file.kind !== "pdf" ? <WrongAccountAlert description={wrongAccountText} /> : null}

      {file.kind === "pdf" ? (
        <PdfStatementPreview
          fileName={fileName}
          statements={file.statements}
          picked={picked}
          onPick={setPicked}
          pickPrompt="Import the one for:"
          money={money}
        >
          {wrongAccount ? <WrongAccountAlert description={wrongAccountText} /> : null}
        </PdfStatementPreview>
      ) : null}

      {parsed && !statement ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>{fileName}</strong>
            {file.kind === "file" ? ` (${file.format})` : " (CSV)"}:{" "}
            {describeStatementParse({ ...parsed, rows: cardStatementLines(parsed.rows, side) })}
          </Typography.Paragraph>
          {file.kind === "csv" && file.note ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {file.note}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}

      {lines.length ? (
        <>
          <StatementProofPanel
            view={view}
            decimals={bankAccount.decimals}
            typedOpeningMinor={marks.typedOpeningMinor}
            typedClosingMinor={marks.typedClosingMinor}
            onTypedOpening={(minor) => mark(() => ({ typedOpeningMinor: minor }))}
            onTypedClosing={(minor) => mark(() => ({ typedClosingMinor: minor }))}
            onUsePrior={(use) => mark(() => ({ usePrior: use }))}
            onImportAnyway={importAnyway}
            busy={importing}
          />
          {checkError ? (
            <Alert style={{ marginTop: 12 }} type="error" showIcon title={linesCheckFailed(checkError)} />
          ) : view.checking ? (
            <Space style={{ marginTop: 12 }}>
              <Spin size="small" />
              <Typography.Text type="secondary">{CHECKING_LINES}</Typography.Text>
            </Space>
          ) : null}
          <StatementLinesPreview
            lines={shownLines}
            aside={aside}
            onAside={(index, on) => mark((current) => ({ aside: toggle(current.aside, index, on) }))}
            view={view}
            onBack={(index, on) => mark((current) => ({ back: toggle(current.back, index, on) }))}
            money={money}
          />
        </>
      ) : null}
    </Modal>
  );
}
