"use client";
import { useState } from "react";
import { Alert, App, Button, Modal, Space, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { batchResultSeverity, describeBatchResult, summarizeBatchResults } from "@/lib/domain/bank-transaction-batch";
import type { CodeOutcome } from "@/lib/services/coding";
import { codeFromSuggestionsAction } from "./actions";

export interface CodeAllRow {
  id: string;
  accountId: string;
  txnDate: string;
  description: string;
  amount: string;
  accountLabel: string;
  why: string;
}

/**
 * Every line Code all is about to post, with where it goes and why — then,
 * after posting, what happened to each. A line whose suggestion changed since
 * the list was drawn is not posted, and says so.
 */
export default function CodeAllModal({
  rows,
  onClose,
  onDone,
}: {
  rows: CodeAllRow[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<CodeOutcome[] | null>(null);
  const list = rows ?? [];
  const summary = outcomes ? summarizeBatchResults(outcomes, 0) : null;
  const byId = new Map(list.map((row) => [row.id, row]));

  async function post() {
    setSaving(true);
    const res = await codeFromSuggestionsAction(list.map((row) => ({ transactionId: row.id, accountId: row.accountId })));
    setSaving(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not code these lines");
      return;
    }
    setOutcomes(res.data.outcomes);
  }

  function close() {
    const posted = outcomes !== null;
    setOutcomes(null);
    if (posted) onDone();
    else onClose();
  }

  const columns: TableColumnsType<CodeAllRow> = [
    { title: "Date", key: "date", dataIndex: "txnDate", width: COLUMN.DATE },
    {
      ...flexColumn<CodeAllRow>({
        title: "Line",
        key: "line",
        render: (_: unknown, row: CodeAllRow) => (
          <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
            <Typography.Text ellipsis={{ tooltip: row.description }}>{row.description}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: row.why }}>
              {row.why}
            </Typography.Text>
          </Space>
        ),
      }),
    },
    { title: "Amount", key: "amount", dataIndex: "amount", width: COLUMN.MONEY, align: "right" },
    {
      title: "Posts to",
      key: "account",
      width: COLUMN.PICKER,
      render: (_: unknown, row: CodeAllRow) => (
        <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
      ),
    },
  ];

  return (
    <Modal
      open={rows !== null}
      title={summary ? "Coded from suggestions" : `Code ${list.length} line${list.length === 1 ? "" : "s"} from their suggestions`}
      width={980}
      onCancel={close}
      destroyOnHidden
      footer={
        summary
          ? [
              <Button key="close" type="primary" onClick={close}>
                Close
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={close}>
                Cancel
              </Button>,
              <Button key="post" type="primary" loading={saving} onClick={post}>
                Post {list.length} line{list.length === 1 ? "" : "s"}
              </Button>,
            ]
      }
    >
      {summary ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert type={batchResultSeverity(summary)} showIcon title={describeBatchResult(summary)} />
          {summary.failures.length > 0 ? (
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {summary.failures.map((failure) => {
                const row = byId.get(failure.id);
                return (
                  <div key={failure.id} style={{ marginBottom: 8 }}>
                    <Typography.Text>{row ? `${row.txnDate} · ${row.description} · ${row.amount}` : failure.id}</Typography.Text>
                    <br />
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {failure.error}
                    </Typography.Text>
                  </div>
                );
              })}
            </div>
          ) : null}
        </Space>
      ) : (
        <>
          <Typography.Paragraph>
            Each line is posted to the account shown, exactly as if it were chosen in its Category cell. Nothing else changes, and
            any of them can be taken back afterwards with Change.
          </Typography.Paragraph>
          <DataTable<CodeAllRow> rowKey="id" columns={columns} dataSource={list} />
        </>
      )}
    </Modal>
  );
}
