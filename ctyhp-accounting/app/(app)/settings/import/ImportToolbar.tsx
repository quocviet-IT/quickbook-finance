"use client";
import { Button, Segmented, Select, Space, Typography, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { AccountRow } from "@/lib/db/types";
import { TARGET_LABEL, type ImportTarget } from "@/lib/domain/import-mapping";

export interface ImportToolbarProps {
  targets: readonly ImportTarget[];
  target: ImportTarget;
  onTargetChange: (next: ImportTarget) => void;
  /** Where a transaction row posts when the file does not name a bank. */
  bankAccounts: AccountRow[];
  bankAccountId: string | null;
  onBankAccountChange: (next: string | null) => void;
  /** The ledger tab has no columns to agree on, so it takes no file here. */
  ledgerTab: boolean;
  fileName: string | null;
  onFile: (file: File) => boolean;
}

/**
 * Which kind of file, where it posts, and the file itself.
 *
 * Lifted out of `ImportClient` to keep that file inside the 400-line ceiling
 * once the pre-flight arrived. It is also the one row that means the same thing
 * on every tab, which is a reason of its own to have it in one place.
 */
export default function ImportToolbar({
  targets,
  target,
  onTargetChange,
  bankAccounts,
  bankAccountId,
  onBankAccountChange,
  ledgerTab,
  fileName,
  onFile,
}: ImportToolbarProps) {
  return (
    <Space wrap>
      <Segmented
        value={target}
        onChange={(value) => onTargetChange(value as ImportTarget)}
        options={targets.map((t) => ({ label: TARGET_LABEL[t], value: t }))}
      />
      {target === "transactions" ? (
        <Select
          allowClear
          style={{ minWidth: 280 }}
          placeholder="Post to bank account"
          value={bankAccountId ?? undefined}
          onChange={(value) => onBankAccountChange(value ?? null)}
          options={bankAccounts.map((account) => ({
            value: account.id,
            label: `${account.account_code} — ${account.name}`,
          }))}
        />
      ) : null}
      {ledgerTab ? null : (
        <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={onFile}>
          <Button icon={<UploadOutlined />}>Choose a CSV file</Button>
        </Upload>
      )}
      {fileName && !ledgerTab ? (
        <Typography.Text type="secondary">{fileName}</Typography.Text>
      ) : null}
    </Space>
  );
}
