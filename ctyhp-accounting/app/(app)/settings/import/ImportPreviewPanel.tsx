"use client";
import { useState } from "react";
import { Alert, Button, Checkbox, DatePicker, Space, Statistic, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import type { ImportTarget } from "@/lib/domain/import-mapping";
import type { ImportPreview } from "@/lib/services/data-import";
import { DownloadOutlined } from "@ant-design/icons";
import { TOKENS } from "@/lib/design/tokens";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const PREVIEW_DEFAULT_PAGE_SIZE = 10;

export interface ImportPreviewPanelProps {
  preview: ImportPreview;
  target: ImportTarget;
  busy: boolean;
  money: (minor: number) => string;
  withBalances: boolean;
  onWithBalancesChange: (next: boolean) => void;
  asOf: Dayjs;
  onAsOfChange: (next: Dayjs) => void;
  onImport: () => void;
  /** Writes the rows this import will leave out, from the file already read. */
  onDownloadExcluded?: () => void;
}

/**
 * What the import will do, before it does it.
 *
 * Lifted out of `ImportClient` when the transactions tab pushed that file over
 * the 400-line ceiling. Two refusals live here and nowhere else: an account the
 * chart does not have blocks the button, and rows already imported are named
 * rather than posted a second time.
 */
export default function ImportPreviewPanel({
  preview,
  target,
  busy,
  money,
  withBalances,
  onWithBalancesChange,
  asOf,
  onAsOfChange,
  onImport,
  onDownloadExcluded,
}: ImportPreviewPanelProps) {
  const [pageSize, setPageSize] = useState<number>(PREVIEW_DEFAULT_PAGE_SIZE);
  const blocked =
    (preview.missingAccounts?.length ?? 0) > 0 ||
    (preview.unbankedAccounts?.length ?? 0) > 0 ||
    (preview.nonBankAccounts?.length ?? 0) > 0 ||
    (preview.ambiguousAccounts?.length ?? 0) > 0;

  /**
   * On the transactions tab this figure is the net of the transactions, not an
   * opening balance. Labelling it "Opening balances in the file" put
   * −$2,257,487.08 in front of a tester under a heading that made it look like
   * a balance nobody recognised.
   */
  const totalTitle =
    target === "transactions" ? "Net of these transactions" : "Opening balances in the file";

  /**
   * Every row one way is the shape a mis-mapped sign column makes.
   *
   * The review asked for a prompt above "a certain threshold". A threshold on
   * money is arbitrary — three years of a real business nets to a large
   * negative number and nothing is wrong. This is not arbitrary: a file of
   * payments and receipts that shows no receipts is either a very unusual file
   * or a column read backwards, and the reader is the only one who can say.
   */
  const oneWayOnly =
    target === "transactions" &&
    preview.rows.length > 1 &&
    (preview.moneyInMinor === 0 || preview.moneyOutMinor === 0);

  return (
    <>
      {/* Named so the guide capture can frame exactly this row. */}
      <Space size="large" wrap className="import-preview__figures">
        <Statistic title="To create" value={preview.creates} />
        <Statistic title="To update" value={preview.updates} />
        <Statistic
          title="Rows with problems"
          value={preview.problems.length}
          valueStyle={preview.problems.length ? { color: TOKENS.intent.danger } : undefined}
        />
        {preview.emptyRows ? (
          <Statistic title="Rows carrying no money" value={preview.emptyRows} />
        ) : null}
        {target === "transactions" && preview.moneyInMinor !== undefined ? (
          <>
            <Statistic title="Money in" value={money(preview.moneyInMinor)} />
            <Statistic title="Money out" value={money(preview.moneyOutMinor ?? 0)} />
          </>
        ) : null}
        {preview.openingTotalMinor !== 0 && target !== "invoices" ? (
          <Statistic title={totalTitle} value={money(preview.openingTotalMinor)} />
        ) : null}
      </Space>

      {oneWayOnly ? (
        <Alert
          type="warning"
          showIcon
          message="Every row in this file moves money the same way"
          description={
            preview.moneyOutMinor === 0
              ? "Nothing is going out. If the file records both payments and receipts, the sign or the money column is probably mapped the wrong way round — check before importing."
              : "Nothing is coming in. If the file records both payments and receipts, the sign or the money column is probably mapped the wrong way round — check before importing."
          }
        />
      ) : null}

      {preview.excluded && preview.excluded.length > 0 && onDownloadExcluded ? (
        <Space>
          <Button size="small" icon={<DownloadOutlined />} onClick={onDownloadExcluded}>
            Download the {preview.excluded.length} row(s) left out
          </Button>
          <Typography.Text type="secondary">
            The file&apos;s own columns, with the line number and the reason beside each.
          </Typography.Text>
        </Space>
      ) : null}

      {preview.emptyRows ? (
        <Alert
          type="info"
          showIcon
          message={`${preview.emptyRows} row(s) carry no money and will be left out`}
          description="A fee that was waived, or a line recorded as 0.00. There is nothing to post for them, and nothing to fix."
        />
      ) : null}

      {preview.problems.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message={`${preview.problems.length} row(s) will be left out`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {preview.problems.slice(0, 8).map((problem, index) => (
                <li key={index}>
                  Row {problem.row}: {problem.message}
                </li>
              ))}
              {preview.problems.length > 8 ? <li>…and {preview.problems.length - 8} more</li> : null}
            </ul>
          }
        />
      ) : null}

      {preview.openingTotalMinor !== 0 && target !== "transactions" ? (
        <Space direction="vertical" size={4}>
          <Checkbox
            checked={withBalances}
            onChange={(event) => onWithBalancesChange(event.target.checked)}
          >
            Also bring the opening balances across
          </Checkbox>
          {withBalances ? (
            <Space>
              <span>as of</span>
              <DatePicker
                value={asOf}
                onChange={(date) => date && onAsOfChange(date)}
                allowClear={false}
              />
              <Typography.Text type="secondary">
                {target === "customers" || target === "vendors"
                  ? "Raised as one opening document each, so the ageing and the control account agree."
                  : "Posted against Opening Balance Equity."}
              </Typography.Text>
            </Space>
          ) : null}
        </Space>
      ) : null}

      <Table
        size="small"
        rowKey={(row) => `${row.action}-${row.key}`}
        pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PREVIEW_DEFAULT_PAGE_SIZE))}
        dataSource={preview.rows}
        columns={[
          {
            title: "",
            dataIndex: "action",
            width: 90,
            render: (action: string) => (
              <Tag color={action === "create" ? "green" : "blue"}>{action}</Tag>
            ),
          },
          { title: "Name", dataIndex: "name" },
          { title: "Matched on", dataIndex: "key", width: 200 },
          {
            title:
              target === "invoices"
                ? "Invoice subtotal"
                : target === "transactions"
                  ? "Amount"
                  : "Opening balance",
            dataIndex: "openingBalanceMinor",
            width: 150,
            align: "right",
            render: (value: number) => (value === 0 ? "—" : money(value)),
          },
        ]}
      />

      {preview.missingAccounts && preview.missingAccounts.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="Some accounts in this file are not in this company's chart of accounts"
          description={`${preview.missingAccounts?.join(", ")}. Import the chart of accounts first, then bring the transactions across.`}
        />
      ) : null}

      {preview.ambiguousAccounts && preview.ambiguousAccounts.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="Some names in this file belong to more than one account"
          description={
            <>
              {preview.ambiguousAccounts
                .map(({ ref, codes }) => `"${ref}" matches ${codes.join(" and ")}`)
                .join("; ")}
              . Which account the money belongs in is a question only you can answer, so
              nothing is imported under a name that names two. There are two ways to answer
              it. Write the account code in the file — either{" "}
              <Typography.Text code>{preview.ambiguousAccounts[0].codes[0]}</Typography.Text>{" "}
              on its own, or{" "}
              <Typography.Text code>
                {`${preview.ambiguousAccounts[0].codes[0]} - ${preview.ambiguousAccounts[0].ref}`}
              </Typography.Text>
              ; the name on its own is what does not work. Or, if the file is somebody
              else&apos;s and cannot be edited, set the account you do not use to{" "}
              <b>Inactive</b> in the chart of accounts — one live account of that name is no
              longer a question.
            </>
          }
        />
      ) : null}

      {preview.nonBankAccounts && preview.nonBankAccounts.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="Some accounts used as a bank in this file are not bank accounts"
          description={`${preview.nonBankAccounts.join(", ")}. Banking will never list these — they are not of a bank or credit card type. Either change the account's type under Chart of accounts, or point those rows at the account the money really moved through.`}
        />
      ) : null}

      {preview.unbankedAccounts && preview.unbankedAccounts.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="This bank account has no bank record yet"
          description={`${preview.unbankedAccounts.join(", ")}. Add it under Banking first — the bank line is what stops a second import of this file posting the same money twice.`}
        />
      ) : null}

      {preview.duplicates ? (
        <Alert
          type="info"
          showIcon
          message={`${preview.duplicates} row(s) were imported before and will be skipped.`}
        />
      ) : null}

      <Button
        type="primary"
        onClick={onImport}
        loading={busy}
        disabled={preview.rows.length === 0 || blocked}
      >
        Import {preview.rows.length} row(s)
      </Button>
    </>
  );
}
