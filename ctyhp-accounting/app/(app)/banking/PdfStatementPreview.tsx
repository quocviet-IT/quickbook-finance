"use client";
import type { ReactNode } from "react";
import { Alert, Select, Space, Spin, Typography } from "antd";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { periodLabel, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";

/**
 * A PDF statement as read, before it is used: which statement (a PDF can hold
 * several), its period, its opening and closing balances, money in and out, and
 * whether the opening balance plus the lines comes to the closing balance.
 * Import statement and starting a reconciliation from a PDF both show it.
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
            This PDF holds {statements.length} statements. {pickPrompt}
          </Typography.Text>
          <Select
            aria-label="Statement"
            style={{ width: "100%" }}
            value={picked}
            onChange={(value: number) => onPick(value)}
            options={statements.map((s, i) => ({ value: i, label: statementLabel(s) }))}
          />
        </div>
      ) : null}

      {children}

      <div style={{ marginTop: 12 }}>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <strong>{fileName}</strong> (PDF): {periodLabel(statement.from, statement.to)}
        </Typography.Paragraph>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          <Figure label="Opening balance" value={statement.openingMinor === null ? "—" : money(statement.openingMinor)} />
          <Figure label={`Money in · ${summary.moneyIn.count}`} value={money(summary.moneyIn.minor)} />
          <Figure label={`Money out · ${summary.moneyOut.count}`} value={money(summary.moneyOut.minor)} />
          <Figure label="Closing balance" value={statement.closingMinor === null ? "—" : money(statement.closingMinor)} />
        </div>
        <Alert style={{ marginTop: 8 }} type={summary.proves ? "success" : "warning"} showIcon title={summary.proof} />
        {statement.skipped > 0 ? (
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {skippedNote(statement.skipped)}
          </Typography.Text>
        ) : null}
      </div>
    </>
  );
}
