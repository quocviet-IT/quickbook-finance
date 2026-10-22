"use client";
import { plural, pluralWord } from "@/lib/format";
import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import UnresolvedAccountsTable from "./UnresolvedAccountsTable";
import type { AccountRow } from "@/lib/db/types";
import type { ImportPreflight, UnbankedRef } from "@/lib/services/import-preflight";

export interface ImportPreflightPanelProps {
  preflight: ImportPreflight;
  /** Every account the chart holds, for the picker. */
  accounts: AccountRow[];
  /** Name in the file → the account code it should be read as. */
  overrides: Record<string, string>;
  onOverride: (ref: string, accountCode: string | null) => void;
  onCreateAccount: (ref: string) => void;
  onAddBankRecord: (row: UnbankedRef) => void;
}


/**
 * What this file needs from this company, said before a column is agreed.
 *
 * The tester's report made the same complaint twice — of the chart of accounts
 * and of Banking — in the same words: the requirement "is only revealed after
 * the user has already gone through the upload and mapping steps". It was true.
 * Both were red panels under a preview, reached after mapping seven columns.
 *
 * They are also both answerable here rather than somewhere else. A name the
 * chart does not have can be pointed at an account that exists, which is what
 * the reader usually wants and what a file they did not write usually needs; a
 * bank the file uses can be declared without leaving the screen. Sending
 * somebody to two other pages and back was the whole of the complaint.
 */
export default function ImportPreflightPanel({
  preflight,
  accounts,
  overrides,
  onOverride,
  onCreateAccount,
  onAddBankRecord,
}: ImportPreflightPanelProps) {
  const ready =
    preflight.unresolved.length === 0 &&
    preflight.unbanked.length === 0 &&
    preflight.bankAsCategory.length === 0;
  // One name doing both jobs. Whatever account it is pointed at answers for
  // both columns: the bank, and every row puts its money straight back; an
  // income or expense account, and the bank side is wrong. Only the file can
  // say what each row was for (2026-10-22).
  const bothColumns = [
    ...preflight.unresolved.filter((row) => row.column === "both").map(({ ref, rows }) => ({ ref, rows })),
    ...preflight.bankAsCategory,
  ];
  // A name already pointed at the bank has left the table above, which was the
  // only place its choice could be changed. The notice that says the choice is
  // wrong offers to take it back.
  const chosen = bothColumns.find(({ ref }) => overrides[ref]);

  return (
    <Card size="small" title="What this file needs">
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <Space wrap size={4}>
          <Tag color="blue">{preflight.chartAccounts} accounts in the chart</Tag>
          <Tag color="blue">{preflight.bankAccounts} bank accounts under Banking</Tag>
          <Tag>{preflight.categoryRefs} account names in the file</Tag>
          <Tag>{preflight.bankRefs} bank names in the file</Tag>
        </Space>

        {ready ? (
          <Alert
            type="success"
            showIcon
            message="Every account this file names already exists"
            description="Nothing to set up first. Agree the columns below, then see what will happen."
          />
        ) : null}

        {bothColumns.length > 0 ? (
          <Alert
            type="error"
            showIcon
            message="The Chart of account column names the bank itself"
            action={
              chosen ? (
                <Button size="small" onClick={() => onOverride(chosen.ref, null)}>
                  Undo the choice
                </Button>
              ) : undefined
            }
            description={
              <>
                {bothColumns.map(({ ref, rows }) => `"${ref}" on ${plural(rows, "row")}`).join("; ")}.
                Each row&apos;s Chart of account has to say what the money was for, such as
                Service Revenue or Operating Expenses; the bank cannot be both sides of a
                transaction. Correct that column in the file, or, if it has no such column,
                bring it in under <b>Banking → Import statement</b> and give each line a
                category there.
              </>
            }
          />
        ) : null}

        {preflight.unresolved.length > 0 ? (
          <>
            <Alert
              type="warning"
              showIcon
              message={`${plural(preflight.unresolved.length, "name")} in this file ${pluralWord(preflight.unresolved.length, "does", "do")} not name one account`}
              description="Point each at an account that already exists, or create it. Nothing is created on your behalf: a file names accounts and describes transactions in the same column, and only you can tell which is which."
            />
            <UnresolvedAccountsTable
              rows={preflight.unresolved}
              accounts={accounts}
              overrides={overrides}
              onOverride={onOverride}
              onCreateAccount={onCreateAccount}
            />
          </>
        ) : null}

        {preflight.unbanked.length > 0 ? (
          <>
            <Alert
              type="warning"
              showIcon
              message={`${plural(preflight.unbanked.length, "bank account")} ${pluralWord(preflight.unbanked.length, "has", "have")} no record under Banking`}
              description="Each row also writes a bank line, and that line is what stops a second import of the same file posting the same money twice. Declare them here."
            />
            <Table<UnbankedRef>
              size="small"
              rowKey="ref"
              pagination={false}
              dataSource={preflight.unbanked}
              columns={[
                {
                  title: "Name in the file",
                  dataIndex: "ref",
                  render: (ref: string, row) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text>{ref}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.accountCode} — {row.accountName}
                      </Typography.Text>
                    </Space>
                  ),
                },
                { title: "Rows", dataIndex: "rows", width: 80, align: "right" },
                {
                  title: "",
                  key: "add",
                  width: 380,
                  render: (_, row) =>
                    row.canBeBanked ? (
                      <Button size="small" onClick={() => onAddBankRecord(row)}>
                        Add under Banking
                      </Button>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Banking will never list this — it is not a bank or credit card account.
                        Point these rows at the account the money really moved through.
                      </Typography.Text>
                    ),
                },
              ]}
            />
          </>
        ) : null}
      </Space>
    </Card>
  );
}
