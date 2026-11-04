"use client";
import { plural } from "@/lib/format";
import type { ReactNode } from "react";
import { Alert, Button, Select, Space, Spin, Typography } from "antd";
import { OCR_TEXT, balanceBreaks, type ScannedReading } from "@/lib/domain/ocr-statement";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { periodLabel, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { statementFileKindLabel } from "@/lib/domain/statement-evidence";
import styles from "./import-statement.module.css";

/**
 * A PDF statement as read, before it is used: which statement (a PDF can hold
 * several), its period, its opening and closing balances, and money in and out.
 * Whether the opening balance plus the lines comes to the closing balance is
 * the import dialog's proof panel to say (2.04), for every format alike and
 * with the lines ticked Not a transaction left out, so it is not said twice.
 */
export interface PdfStatementPreviewProps {
  fileName: string;
  statements: PdfStatement[];
  picked: number;
  onPick: (index: number) => void;
  /** Said above the list when the PDF holds several statements. */
  pickPrompt: string;
  money: (minor: number) => string;
  /** Shown between the list and the figures: a warning about the chosen statement. */
  children?: ReactNode;
}

/** The warning when a file names an account other than the one it is used for. */
export function WrongAccountAlert({ description }: { description: string }) {
  return (
    <Alert style={{ marginTop: 12 }} type="warning" showIcon title="This file names a different account" description={description} />
  );
}

/** Said while a PDF is being read. */
export function ReadingPdf() {
  return (
    <Space style={{ marginTop: 12 }}>
      <Spin size="small" />
      <Typography.Text type="secondary">Reading the PDF…</Typography.Text>
    </Space>
  );
}

/** Said when a chosen file cannot be read, with why. */
export function UnreadableFile({ message }: { message: string }) {
  return <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={message} />;
}

/**
 * A PDF with no text (3.0.3), or a photo of a statement (3.0.5): offered to the
 * company's OCR server, and how far reading it has got. A photo is called a
 * photo (3.0.6), not a scanned PDF.
 */
export function ScannedPdf({
  reading,
  onRead,
  disabled,
  photo = false,
}: {
  reading: ScannedReading;
  onRead: () => void;
  disabled?: boolean;
  photo?: boolean;
}) {
  const title = photo ? OCR_TEXT.photoTitle : OCR_TEXT.title;
  if (reading.phase === "offline") {
    return <Alert style={{ marginTop: 12 }} type="error" showIcon title={title} description={OCR_TEXT.offline} />;
  }
  if (reading.phase === "failed") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="error"
        showIcon
        title={photo ? "The photo could not be read" : "The scanned statement could not be read"}
        description={reading.message}
        action={<Button onClick={onRead} disabled={disabled}>Try again</Button>}
      />
    );
  }
  if (reading.phase === "ready") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="info"
        showIcon
        title={title}
        description={OCR_TEXT.ready}
        action={<Button type="primary" onClick={onRead} disabled={disabled}>{OCR_TEXT.button}</Button>}
      />
    );
  }
  const text =
    reading.phase === "sending" ? OCR_TEXT.sending
    : reading.phase === "waiting" ? OCR_TEXT.waiting
    : OCR_TEXT.reading(reading.pagesDone, reading.pagesTotal);
  return (
    <Space style={{ marginTop: 12 }}>
      <Spin size="small" />
      <Typography.Text role="status" aria-live="polite">{text}</Typography.Text>
    </Space>
  );
}

/** Said above the lines of a statement read by OCR: check them, and where the running balance breaks. */
export function OcrNotice({ statement }: { statement: PdfStatement }) {
  const breaks = balanceBreaks(statement.lines, statement.openingMinor);
  return (
    <Alert
      style={{ marginTop: 12 }}
      type={breaks.length ? "warning" : "info"}
      showIcon
      title={OCR_TEXT.banner}
      description={breaks.length ? OCR_TEXT.breaks(breaks) : undefined}
    />
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </div>
  );
}

export default function PdfStatementPreview({
  fileName,
  statements,
  picked,
  onPick,
  pickPrompt,
  money,
  children,
}: PdfStatementPreviewProps) {
  const statement = statements[picked] ?? statements[0];
  const summary = summarizeStatement(statement, money);
  return (
    <>
      {statements.length > 1 ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            This PDF holds {plural(statements.length, "statement")}. {pickPrompt}
          </Typography.Text>
          <Select
            aria-label="Statement"
            style={{ width: "100%" }}
            value={picked}
            onChange={(value: number) => onPick(value)}
            options={statements.map((st, i) => ({ value: i, label: statementLabel(st) }))}
          />
        </div>
      ) : null}

      {children}

      <div style={{ marginTop: 12 }}>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <strong>{fileName}</strong> ({statementFileKindLabel(fileName)}): {periodLabel(statement.from, statement.to)}
        </Typography.Paragraph>
        <div className={styles.figures}>
          <Figure label="Opening balance" value={statement.openingMinor === null ? "—" : money(statement.openingMinor)} />
          <Figure label={`Money in · ${summary.moneyIn.count}`} value={money(summary.moneyIn.minor)} />
          <Figure label={`Money out · ${summary.moneyOut.count}`} value={money(summary.moneyOut.minor)} />
          <Figure label="Closing balance" value={statement.closingMinor === null ? "—" : money(statement.closingMinor)} />
        </div>
        {statement.skipped > 0 ? (
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {skippedNote(statement.skipped)}
          </Typography.Text>
        ) : null}
      </div>
    </>
  );
}
