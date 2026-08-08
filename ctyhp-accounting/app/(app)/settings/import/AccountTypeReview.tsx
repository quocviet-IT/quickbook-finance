"use client";
import { Alert, Select, Space, Table, Tag, Typography } from "antd";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/domain/accounts";
import type { AccountTypeReading } from "@/lib/domain/account-type-readings";

export interface AccountTypeReviewProps {
  readings: AccountTypeReading[];
  onChange: (source: string, type: AccountType | null) => void;
}

/**
 * How this file's type words were read, and a chance to disagree.
 *
 * "Provide a mapping step where users can review and correct account types
 * before the import is finalized." Reviewing ninety-five rows to check thirteen
 * decisions is proof-reading, not review — the decisions repeat, so they are
 * grouped and the repetition disappears.
 *
 * It is worth the look because the reading is a translation with consequences
 * that outlive the import: QuickBooks writes "Other Current Asset", and which
 * One Book type that becomes decides where the money sits on the balance sheet
 * for every transaction afterwards. A word nothing here matches is already a
 * row the import refuses; this is for the ones it matched, plausibly, wrongly.
 */
export default function AccountTypeReview({ readings, onChange }: AccountTypeReviewProps) {
  if (readings.length === 0) return null;
  const unreadable = readings.filter((reading) => reading.type === null);

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Alert
        type={unreadable.length > 0 ? "error" : "info"}
        showIcon
        message={
          unreadable.length > 0
            ? `${unreadable.length} type(s) in this file mean nothing here`
            : `How the ${readings.length} type(s) in this file were read`
        }
        description={
          unreadable.length > 0
            ? "Choose what each one means, or those rows are left out. The type decides which report an account's money appears in, and it cannot be inferred from the rest of the row."
            : "Each word in your file's type column, and what it was taken to mean. Change any of them — this is the last point at which it costs nothing."
        }
      />
      <Table<AccountTypeReading>
        size="small"
        rowKey="source"
        pagination={false}
        dataSource={readings}
        columns={[
          {
            title: "In your file",
            dataIndex: "source",
            render: (source: string, row) => (
              <Space direction="vertical" size={0}>
                <Typography.Text>{source}</Typography.Text>
                {row.example ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    e.g. {row.example}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          { title: "Accounts", dataIndex: "rows", width: 90, align: "right" },
          {
            title: "Read as",
            key: "type",
            width: 320,
            render: (_, row) => (
              <Space>
                <Select
                  allowClear
                  showSearch
                  style={{ minWidth: 220 }}
                  placeholder="Nothing here matches this"
                  status={row.type === null ? "error" : undefined}
                  value={row.type ?? undefined}
                  optionFilterProp="label"
                  options={ACCOUNT_TYPES.map((type) => ({
                    value: type,
                    label: ACCOUNT_TYPE_LABEL[type],
                  }))}
                  onChange={(value) => onChange(row.source, (value as AccountType) ?? null)}
                />
                {row.chosen ? <Tag color="blue">yours</Tag> : null}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
