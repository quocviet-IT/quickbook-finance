"use client";
import { useRef, useState } from "react";
import { Alert, App, Modal, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { bringForwardAdvice, dayBefore, type BringForwardAdvice } from "@/lib/domain/reconcile-statement";
import { accountNumberDiffers } from "@/lib/domain/statement-files";
import { formatMoney } from "@/lib/format";
import PdfStatementPreview, { WrongAccountAlert } from "../PdfStatementPreview";
import {
  broughtForwardPreviewAction,
  startReconciliationFromStatementAction,
  type StartFromStatementSummary,
} from "./statement-actions";

/**
 * Starting a reconciliation from a PDF statement, in its own file so pdf.js and
 * the dialog are fetched when somebody opens it.
 *
 * The statement's last day is the reconciliation's date and its closing balance
 * the ending balance — nothing retyped. On an account never reconciled, the
 * books on the day before the statement's period are set beside the opening
 * balance the statement prints; when they agree, the earlier lines can be
 * brought forward as reconciled, as the prototype does, and the button says so.
 */
export interface StartFromStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  onStarted: (summary: StartFromStatementSummary) => void;
  onCancel: () => void;
}

type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | { kind: "pdf"; statements: PdfStatement[] };

const NO_FIGURES =
  "This statement prints no statement date or no closing balance, so a reconciliation cannot be started from it. " +
  "Start one with New reconciliation and import the file inside it.";

export default function StartFromStatementModal({ open, bankAccount, onStarted, onCancel }: StartFromStatementModalProps) {
  const { message } = App.useApp();
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [picked, setPicked] = useState(0);
  const [advice, setAdvice] = useState<BringForwardAdvice | null>(null);
  const [starting, setStarting] = useState(false);
  // Reading and asking the books are asynchronous; a later choice makes an earlier answer stale.
  const reading = useRef(0);
  const asking = useRef(0);
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);

  async function advise(statement: PdfStatement) {
    const token = ++asking.current;
    setAdvice(null);
    if (!statement.from || statement.openingMinor === null) return;
    const res = await broughtForwardPreviewAction(bankAccount.id, dayBefore(statement.from));
    if (token !== asking.current) return;
    if (res.ok && res.data) setAdvice(bringForwardAdvice(res.data, statement, money));
    else message.error(res.error ?? "The books could not be read for the statement's opening balance");
  }

  async function readFile(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setFile({ kind: "reading" });
    setAdvice(null);
    const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
    const result = await readPdfStatementFile(chosen, bankAccount.decimals);
    if (token !== reading.current) return;
    if ("message" in result) {
      setFile({ kind: "unsupported", message: result.message });
      return;
    }
    const index = pickStatement(result.statements, bankAccount.maskedNumber);
    setPicked(index);
    setFile({ kind: "pdf", statements: result.statements });
    void advise(result.statements[index]);
  }

  function pick(index: number) {
    setPicked(index);
    if (file.kind === "pdf") void advise(file.statements[index]);
  }

  const statement = file.kind === "pdf" ? (file.statements[picked] ?? file.statements[0]) : null;
  const usable = Boolean(statement && statement.to && statement.closingMinor !== null);
  const proves = statement ? summarizeStatement(statement, money).proves : false;
  const wrongAccount = accountNumberDiffers(statement?.accountNumber ?? null, bankAccount.maskedNumber);
  const okText = `${advice?.canBringForward ? "Bring forward and start" : "Start"}${statement && !proves ? " anyway" : ""}`;

  async function start() {
    if (!statement || !statement.to || statement.closingMinor === null) return;
    setStarting(true);
    const res = await startReconciliationFromStatementAction({
      bank_account_id: bankAccount.id,
      file_name: fileName,
      period_from: statement.from,
      statement_date: statement.to,
      opening_minor: statement.openingMinor,
      closing_minor: statement.closingMinor,
      bring_forward: advice?.canBringForward ?? false,
      lines: toStatementLines(statement),
    });
    setStarting(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The reconciliation could not be started");
      return;
    }
    onStarted(res.data);
  }

  return (
    <Modal
      title={`Reconcile ${bankAccount.label} from a PDF statement`}
      open={open}
      onOk={() => void start()}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: !usable, loading: starting }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Choose the statement&apos;s PDF. The reconciliation takes the statement&apos;s last day as its date and its closing
        balance as its ending balance. The lines are imported into Bank Transactions, kept with the reconciliation and
        paired with the books, and every pair is ticked. Nothing is posted, and nothing is completed until you click
        Complete.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".pdf,application/pdf"
        beforeUpload={(chosen) => {
          void readFile(chosen);
          return false;
        }}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a PDF statement here</p>
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

      {file.kind === "pdf" ? (
        <PdfStatementPreview
          fileName={fileName}
          statements={file.statements}
          picked={picked}
          onPick={pick}
          pickPrompt="Reconcile the one for:"
          money={money}
        >
          {wrongAccount ? (
            <WrongAccountAlert
              description={`The file is for an account ending ${(statement?.accountNumber ?? "").slice(-4)}, and you are reconciling ${bankAccount.label}. Check before starting.`}
            />
          ) : null}
        </PdfStatementPreview>
      ) : null}

      {statement && !usable ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={NO_FIGURES} /> : null}

      {usable && advice ? (
        <Alert
          style={{ marginTop: 12 }}
          type={advice.canBringForward ? "info" : "warning"}
          showIcon
          title={advice.canBringForward ? "The first reconciliation of this account" : "The earlier lines stay open"}
          description={advice.text}
        />
      ) : null}
    </Modal>
  );
}
