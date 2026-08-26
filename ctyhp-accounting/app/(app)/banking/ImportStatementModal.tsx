"use client";
import { Modal, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";

/**
 * The CSV import dialog, in its own file so it is fetched when somebody opens
 * it rather than when they open /banking.
 *
 * It carries Ant Design's uploader, which nothing else on that screen uses.
 * /banking was the heaviest page in the app — 1.077 KB of JavaScript, against
 * 780 KB for a plain dashboard — and this dialog is opened by a fraction of
 * the people who read the transaction list.
 *
 * Presentation only, deliberately. Parsing lives in
 * lib/domain/statement-import.ts and the import itself is a server action;
 * both stay exactly where they were. This component decides nothing.
 */
export interface ImportStatementModalProps {
  open: boolean;
  /** How many rows the chosen file parsed into, for the button's label. */
  parsedCount: number;
  fileName: string;
  importing: boolean;
  /** Returns false so Ant Design never uploads the file itself. */
  onFile: (file: File) => boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ImportStatementModal({
  open,
  parsedCount,
  fileName,
  importing,
  onFile,
  onConfirm,
  onCancel,
}: ImportStatementModalProps) {
  return (
    <Modal
      title="Import bank statement"
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={parsedCount ? `Import ${parsedCount} rows` : "Import"}
      okButtonProps={{ disabled: !parsedCount, loading: importing }}
      cancelText="Cancel"
      width={640}
    >
      <Typography.Paragraph type="secondary">
        Upload a comma-separated values file with columns: <code>date, description, amount, reference, balance</code>.
        Positive amounts are money in. Dates may use YYYY-MM-DD or MM/DD/YYYY.
      </Typography.Paragraph>
      <Upload.Dragger accept=".csv" beforeUpload={onFile} maxCount={1} showUploadList={{ showRemoveIcon: false }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Click or drag a comma-separated values file here</p>
      </Upload.Dragger>
      {parsedCount > 0 ? (
        <Typography.Paragraph style={{ marginTop: 12 }}>
          Parsed <strong>{parsedCount}</strong> transactions from <strong>{fileName}</strong>.
        </Typography.Paragraph>
      ) : null}
    </Modal>
  );
}
