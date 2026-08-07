"use client";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { fieldsFor, TARGET_LABEL, type ImportTarget } from "@/lib/domain/import-mapping";
import {
  describeShapeMismatch,
  templateCsvFor,
  type FileShapeDetection,
} from "@/lib/domain/import-shape";

/** Where each kind of file comes from in the product being left behind. */
const SOURCE_HINT: Record<ImportTarget, string> = {
  chart_of_accounts:
    "QuickBooks: Reports → Account List. Wave: Accounting → Chart of Accounts → Export.",
  customers: "QuickBooks: Reports → Customer Contact List. Wave: Sales → Customers → Export.",
  vendors: "QuickBooks: Reports → Vendor Contact List. Wave: Purchases → Vendors → Export.",
  items: "QuickBooks: Reports → Product/Service List. Wave: Sales → Products & Services → Export.",
  invoices: "QuickBooks: Reports → Invoice List with line detail. Wave: Sales → Invoices → Export.",
  transactions:
    "QuickBooks: Reports → Transaction List by Date. Wave: Accounting → Transactions → Export. " +
    "The file must name both the bank and the chart-of-account for each row.",
  general_ledger:
    "Wave: Reports → Account Transactions → Export. QuickBooks: Reports → General Ledger. " +
    "One file holds every account; there is nothing to import separately.",
};

/**
 * What has to exist before a tab can accept a file.
 *
 * The tester's report said it twice, of two different prerequisites: "this
 * requirement is not communicated upfront". Both were only discovered as a red
 * panel after mapping every column.
 */
const BEFORE_YOU_START: Partial<Record<ImportTarget, string[]>> = {
  transactions: [
    "Import the chart of accounts first. Every account this file names must already exist — a transaction row never creates one, because the same name means different things in two charts.",
    "Add the bank accounts under Banking first. The bank line is what stops a second import of the same file posting the same money twice, so a file cannot be imported without one.",
    "Re-importing the same file is safe: rows already brought across are recognised and skipped, not doubled.",
  ],
  general_ledger: [
    "Import the chart of accounts first. The file names accounts; it does not create them.",
    "Do not close a period until you have checked the import. An entry in a closed period can no longer be voided, and undo is how a mistaken import is put right.",
  ],
  chart_of_accounts: [
    "An account code that already exists is left exactly as it is and reported. The same number means different things in two charts, so nothing here overwrites an account you already rely on.",
  ],
  invoices: [
    "Import customers first. An invoice row names a customer; it does not create one.",
  ],
};

export interface ImportGuidanceProps {
  target: ImportTarget;
  /** Null until a file has been read. */
  detection: FileShapeDetection | null;
  onSwitchTarget: (target: ImportTarget) => void;
}

/**
 * What this tab needs, before anyone maps a column.
 *
 * Feedback 428ca4db asked for instructions and for batch import. The second was
 * a misunderstanding worth correcting here rather than building: one file already
 * carries every account, one row each. The first was fair — the screen showed a
 * mapping table and never said what the file was supposed to look like.
 */
export default function ImportGuidance({ target, detection, onSwitchTarget }: ImportGuidanceProps) {
  const fields = fieldsFor(target);
  const required = fields.filter((field) => field.required);
  const optional = fields.filter((field) => !field.required);
  const mismatch = detection ? describeShapeMismatch(target, detection) : null;
  const switchTo = detection?.target ?? null;

  function downloadTemplate() {
    const blob = new Blob([templateCsvFor(target)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `one-book-${target.replaceAll("_", "-")}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Card size="small" title={`What a ${TARGET_LABEL[target]} file needs`}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Space wrap size={4}>
            {required.map((field) => (
              <Tag color="blue" key={field.key}>
                {field.label}
              </Tag>
            ))}
            {optional.map((field) => (
              <Tag key={field.key}>{field.label}</Tag>
            ))}
          </Space>
          <Typography.Text type="secondary">
            Blue columns are required. One file, every account — each row is one record, so a
            second file is only needed for a second kind of data.
          </Typography.Text>
          <Typography.Text type="secondary">{SOURCE_HINT[target]}</Typography.Text>
          <Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate}>
            Download template
          </Button>
        </Space>
      </Card>

      {BEFORE_YOU_START[target] ? (
        <Alert
          type="warning"
          showIcon
          message="Before you start"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {BEFORE_YOU_START[target]?.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {mismatch ? (
        <Alert
          type="warning"
          showIcon
          message="This file may not belong in this tab"
          description={mismatch}
          action={
            switchTo ? (
              <Button size="small" onClick={() => onSwitchTarget(switchTo)}>
                Switch to {TARGET_LABEL[switchTo]}
              </Button>
            ) : null
          }
        />
      ) : null}

      {/* Only before a file is chosen. Once somebody is working on a real file
          this is noise, and it appeared beside a warning about the tab — two
          alerts over a correct file, which reads as "you are doing it wrong". */}
      {detection ? null : (
        <Alert
          type="info"
          showIcon
          message="Holding a report rather than a data file?"
          description={
            <>
              A Profit and Loss, a Balance Sheet or a bank statement you only want to keep can be
              saved under <a href="/reports/saved">Reports → Saved Reports</a>. Importing posts;
              saving does not affect a balance at all.
            </>
          }
        />
      )}
    </Space>
  );
}
