"use client";
import { Button, Select, Space, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import type { UnresolvedRef } from "@/lib/services/import-preflight";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The count, then Read it as. "Name in the file" takes what is left, at least
 * COLUMN.TEXT_MIN. Read it as holds a 250px picker and the Create button, so it
 * has a width of its own.
 */
export const UNRESOLVED_ACCOUNTS_FIXED_WIDTHS = [COLUMN.QTY, 380] as const;

export interface UnresolvedAccountsTableProps {
  rows: UnresolvedRef[];
  /** Every account the chart holds, for the picker. */
  accounts: AccountRow[];
  /** Name in the file → the account code it should be read as. */
  overrides: Record<string, string>;
  onOverride: (ref: string, accountCode: string | null) => void;
  onCreateAccount: (ref: string) => void;
  /** What the count column is counting: rows on one tab, lines on the other. */
  countLabel?: string;
}

const COLUMN_LABEL: Record<UnresolvedRef["column"], string> = {
  bank: "Bank account",
  category: "Chart of account",
  both: "Bank account and Chart of account",
};

/**
 * The names a file uses that the chart cannot turn into one account, and the
 * two ways to answer that.
 *
 * Shared by both tabs on purpose. A general ledger hits exactly the same wall
 * as a transactions file — the same names, the same chart — and it had only
 * half the answer: it listed what was missing and sent you to another screen to
 * create it, which is no use at all when the file is a customer's export you
 * are not allowed to edit and the account it names already exists under another
 * name.
 */
export default function UnresolvedAccountsTable({
  rows,
  accounts,
  overrides,
  onOverride,
  onCreateAccount,
  countLabel = "Rows",
}: UnresolvedAccountsTableProps) {
  const options = accounts
    .filter((account) => account.status !== "archived")
    .map((account) => ({
      value: account.account_code,
      label: `${account.account_code} — ${account.name}`,
    }));

  return (
    <DataTable<UnresolvedRef>
      rowKey="ref"
      pagination={false}
      rows={rows}
      columns={[
        flexColumn<UnresolvedRef>({
          title: "Name in the file",
          dataIndex: "ref",
          render: (ref: string, row) => (
            <Space direction="vertical" size={0}>
              <Typography.Text>{ref}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {COLUMN_LABEL[row.column]}
                {row.candidates.length > 1
                  ? ` · matches ${row.candidates.join(" and ")}`
                  : " · not in the chart"}
              </Typography.Text>
            </Space>
          ),
        }),
        { title: countLabel, dataIndex: "rows", width: UNRESOLVED_ACCOUNTS_FIXED_WIDTHS[0], align: "right" },
        {
          title: "Read it as",
          key: "as",
          width: UNRESOLVED_ACCOUNTS_FIXED_WIDTHS[1],
          render: (_, row) => (
            <Space>
              <Select
                showSearch
                allowClear
                style={{ minWidth: 250 }}
                placeholder="Choose an account"
                value={overrides[row.ref]}
                optionFilterProp="label"
                options={options}
                onChange={(value) => onOverride(row.ref, value ?? null)}
              />
              {/* Two accounts already answer to this name; a third would not help. */}
              {row.candidates.length > 1 ? null : (
                <Button size="small" onClick={() => onCreateAccount(row.ref)}>
                  Create
                </Button>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}
