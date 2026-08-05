"use client";
import { Button, Space, Tag, Typography, type TableColumnsType } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow, BankTxnStatus } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";

export type BankReviewTableRow = BankReviewRow<BankTransactionRow, SuggestionView>;

const TXN_STATUS: Record<BankTxnStatus, { text: string; color: string }> = {
  unmatched: { text: "For review", color: "orange" },
  matched: { text: "Matched", color: "green" },
  ignored: { text: "Excluded", color: "default" },
};

export interface BankTransactionsTableProps {
  rows: BankReviewTableRow[];
  loading: boolean;
  initialFocusId: string | null;
  canWrite: boolean;
  canReadDocuments: boolean;
  /** The suggestion currently being approved or rejected, if any. */
  busy: string | null;
  formatRowMoney: (row: BankReviewTableRow) => string;
  onSettle: (row: BankReviewTableRow) => void;
  onApprove: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
  onAttachments: (row: BankReviewTableRow) => void;
}

/**
 * The bank lines, and the decision about each one.
 *
 * Lifted out of `BankingClient` — which was 1042 lines — so this table can be
 * read, and changed, without holding the whole screen in your head. Every
 * behaviour here arrived unchanged from that file.
 */
export default function BankTransactionsTable({
  rows,
  loading,
  initialFocusId,
  canWrite,
  canReadDocuments,
  busy,
  formatRowMoney,
  onSettle,
  onApprove,
  onReject,
  onAttachments,
}: BankTransactionsTableProps) {
  const columns: TableColumnsType<BankReviewTableRow> = [
    { title: "Date", dataIndex: ["transaction", "txn_date"], width: 115 },
    {
      title: "Description",
      key: "description",
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Space direction="vertical" size={0}>
          <span>{row.transaction.description}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.transaction.category
              ? row.transaction.category.replaceAll("_", " ")
              : row.transaction.source === "bank_feed"
                ? "Direct bank feed"
                : "File upload"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Account source",
      key: "account",
      width: 200,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Typography.Text type="secondary">{row.accountName}</Typography.Text>
      ),
    },
    {
      title: "Reference",
      dataIndex: ["transaction", "reference"],
      width: 135,
      render: (reference: string | null) => reference ?? "—",
    },
    {
      title: "Amount",
      key: "amount",
      width: 140,
      align: "right",
      render: (_value: unknown, row: BankReviewTableRow) => (
        <span style={{ color: row.transaction.amount_minor < 0 ? "#b91c1c" : "#15803d" }}>
          {formatRowMoney(row)}
        </span>
      ),
    },
    {
      // What the line looks like it is, and the decision, in the same place the
      // line is read. This used to be a separate tab.
      title: "Match",
      key: "match",
      width: 300,
      render: (_value: unknown, row: BankReviewTableRow) => {
        // Offered on any line still awaiting review, with or without a
        // suggestion: a suggestion says "this is already in the books", and
        // settling says "it is not, and it pays this invoice".
        const settleButton =
          canWrite && row.transaction.status === "unmatched" ? (
            <Button size="small" onClick={() => onSettle(row)}>
              {row.transaction.amount_minor > 0 ? "Settle invoice" : "Settle bill"}
            </Button>
          ) : null;

        if (!row.suggestion) {
          return (
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">
                {row.transaction.status === "matched" ? "Matched" : "No suggestion"}
              </Typography.Text>
              {settleButton}
            </Space>
          );
        }
        const match = row.suggestion;
        return (
          <Space direction="vertical" size={2}>
            <Space size={6} wrap>
              <Tag color="blue">{match.target_number ?? "Ledger entry"}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {match.target_type.replaceAll("_", " ")} · {Math.round(match.confidence * 100)}%
              </Typography.Text>
            </Space>
            {match.target_description ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {match.target_description}
              </Typography.Text>
            ) : null}
            {canWrite ? (
              <Space size={4} wrap>
                <Button
                  size="small"
                  type="primary"
                  loading={busy === match.id}
                  onClick={() => onApprove(match.id)}
                >
                  Approve
                </Button>
                <Button size="small" loading={busy === match.id} onClick={() => onReject(match.id)}>
                  Reject
                </Button>
                {settleButton}
              </Space>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      width: 130,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <Space size={4}>
          <Tag color={TXN_STATUS[row.transaction.status].color}>
            {TXN_STATUS[row.transaction.status].text}
          </Tag>
          {row.transaction.pending ? <Tag>Pending</Tag> : null}
        </Space>
      ),
    },
    ...(canReadDocuments
      ? [
          {
            title: "",
            key: "attachments",
            width: 56,
            fixed: "right" as const,
            render: (_value: unknown, row: BankReviewTableRow) => (
              <IconActionButton
                label="View bank transaction attachments"
                icon={<PaperClipOutlined />}
                onClick={() => onAttachments(row)}
              />
            ),
          } as TableColumnsType<BankReviewTableRow>[number],
        ]
      : []),
  ];

  return (
    <DataTable
      rowKey={(row: BankReviewTableRow) => row.transaction.id}
      columns={columns}
      dataSource={rows}
      rowClassName={(row: BankReviewTableRow) =>
        row.transaction.id === initialFocusId ? "accounting-data-row--focused" : ""
      }
      pagination={{ pageSize: 25 }}
      sticky
      loading={loading}
      emptyTitle="No bank transactions"
      emptyDescription="Synchronize a bank feed or import a statement to start the review workflow."
    />
  );
}
