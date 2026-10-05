"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Modal, Select, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { parseCsv } from "@/lib/csv";
import {
  describeStatementParse,
  detectDateOrder,
  detectStatementColumns,
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
import { pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
import PdfStatementPreview, { WrongAccountAlert } from "./PdfStatementPreview";

/**
 * The statement import dialog, in its own file so it is fetched when somebody
 * opens it rather than when they open /banking.
 *
 * It reads the file in the browser — a PDF statement, CSV, OFX, QFX, QBO or QIF
 * — and, for a CSV whose headings it does not know, asks which column is which.
 * A PDF is read by its layout, so it needs no columns; before importing, the
 * dialog shows whether its opening balance plus the lines read comes to its
 * closing balance. The import itself is a server action of the screen that
 * opened the dialog: Banking opens Review import after it, and a
 * reconciliation pairs the lines with the books.
 */
export interface ImportStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  importing: boolean;
  /** `statement` is the PDF statement imported, with its period and balances; null for any other file. */
  onConfirm: (fileName: string, rows: StatementLine[], statement: PdfStatement | null) => void;
  onCancel: () => void;
  /** What happens to the lines, said above the file picker. */
  intro?: ReactNode;
}

const BANKING_INTRO =
  "Choose the file your bank gives you: a PDF statement, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx, " +
  ".qbo, .qif). After the import, Review import proposes an account, a match or a document for every line, and " +
  "nothing is posted until you click Post.";

interface CsvState {
  kind: "csv";
  headers: string[];
  records: Record<string, string>[];
}
type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | CsvState
  | { kind: "file"; format: "OFX" | "QIF"; result: StatementFileResult }
  | { kind: "pdf"; statements: PdfStatement[] };

interface CsvChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;
const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

function rememberedChoice(bankAccountId: string, headers: string[]): CsvChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

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
}: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [picked, setPicked] = useState(0);
  // A PDF is read asynchronously; choosing another file meanwhile makes the first answer stale.
  const reading = useRef(0);

  async function readPdf(chosen: File, token: number) {
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
    setFileName(chosen.name);
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
      const records = parseCsv(text);
      const headers = records.length ? Object.keys(records[0]) : [];
      const detected = detectStatementColumns(headers);
      const remembered = rememberedChoice(bankAccount.id, headers);
      const next: CsvChoice = remembered ?? {
        columns: detected.columns,
        dateOrder: detectDateOrder(records.map((r) => (detected.columns.date ? r[detected.columns.date] ?? "" : ""))),
        flipSigns: false,
      };
      setFile({ kind: "csv", headers, records });
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
  const rows: StatementLine[] = useMemo(
    () => (statement ? toStatementLines(statement) : (parsed?.rows ?? [])),
    [statement, parsed],
  );
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);
  const summary = statement ? summarizeStatement(statement, money) : null;
  const fileAccount = file.kind === "file" ? file.result.accountId : (statement?.accountNumber ?? null);
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);
  const wrongAccountText = `The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`;

  const okText = !rows.length
    ? "Import"
    : summary
      ? `Import ${rows.length} line${rows.length === 1 ? "" : "s"}${summary.proves ? "" : " anyway"}`
      : `Import ${rows.length} rows`;

  function confirm() {
    if (!rows.length) return;
    if (file.kind === "csv" && choice) {
      try {
        localStorage.setItem(storageKey(bankAccount.id), JSON.stringify(choice));
      } catch {
        // Remembering the columns is a convenience; the import does not need it.
      }
    }
    onConfirm(fileName, rows, statement);
  }

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
      title={`Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: !rows.length, loading: importing }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{intro}</Typography.Paragraph>
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

      {file.kind === "reading" ? (
        <Space style={{ marginTop: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">Reading the PDF…</Typography.Text>
        </Space>
      ) : null}

      {file.kind === "unsupported" ? (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={file.message} />
      ) : null}

      {file.kind === "csv" && choice ? (
        <div style={{ marginTop: 12 }}>
          {showColumns ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text strong>Choose columns</Typography.Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
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
                Flip signs: my file shows payments as positive
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
            {file.kind === "file" ? ` (${file.format})` : " (CSV)"}: {describeStatementParse(parsed)}
          </Typography.Paragraph>
        </div>
      ) : null}

      {rows.length ? (
        <div style={{ marginTop: 4 }}>
          {rows.slice(0, 3).map((row, i) => (
            <Typography.Text key={i} type="secondary" style={{ display: "block", fontSize: 12 }}>
              {row.txn_date} · {row.description} · {(row.amount_minor / 10 ** bankAccount.decimals).toFixed(bankAccount.decimals)}
            </Typography.Text>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
