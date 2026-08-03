"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  App,
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { parseCsv } from "@/lib/csv";
import {
  describeStatementParse,
  parseStatementRows,
} from "@/lib/domain/statement-import";
import { fromMinor } from "@/lib/domain/money";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
  setClearedAction,
  recordAdjustmentAction,
  completeReconciliationAction,
  reopenReconciliationAction,
  importStatementIntoReconciliationAction,
  reconciliationStatementLinesAction,
  type StatementLineView,
} from "../actions";
import type { ReconLineView, ReconDetail } from "@/lib/services/bankrec";
import {
  statementLineState,
  summariseStatementLines,
  STATEMENT_LINE_STATES,
} from "@/lib/domain/bankrec";

interface Offset {
  id: string;
  label: string;
}
interface Props {
  reconciliationId: string;
  canWrite: boolean;
  canReopen: boolean;
  offsetAccounts: Offset[];
  baseCurrency: string;
  baseDecimals: number;
}

export default function ReconcileWorkspaceClient({
  reconciliationId,
  canWrite,
  canReopen,
  offsetAccounts,
  baseCurrency,
  baseDecimals,
}: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [statementLines, setStatementLines] = useState<StatementLineView[]>([]);
  // How much of the statement is settled, and how much is still an exception
  // the reconciler has to clear. Derived, never stored.
  const summary = summariseStatementLines(statementLines);
  const [importing, setImporting] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    const [l, d] = await Promise.all([
      reconciliationLinesAction(reconciliationId),
      reconciliationDetailAction(reconciliationId),
    ]);
    setLoading(false);
    if (l.ok && l.data) setLines(l.data);
    else message.error(l.error ?? "Failed");
    if (d.ok && d.data) setDetail(d.data);
    else message.error(d.error ?? "Failed");
  }, [reconciliationId, message]);
  const loadStatement = useCallback(async () => {
    const res = await reconciliationStatementLinesAction(reconciliationId);
    if (res.ok && res.data) setStatementLines(res.data);
  }, [reconciliationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadStatement();
  }, [load, loadStatement]);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const completed = detail?.status === "completed";

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load();
    else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    const v = await form.validateFields();
    const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
    if (r.ok) {
      message.success("Adjustment recorded");
      setAdjOpen(false);
      form.resetFields();
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) {
      message.success("Reconciliation completed");
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const reopen = () => {
    let reason = "";
    modal.confirm({
      title: "Reopen reconciliation?",
      content: (
        <Input
          placeholder="Reason"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Reconciliation reopen submitted for approval"
              : "Reopened",
          );
          if (!r.data?.submittedForApproval) void load();
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  /**
   * Load the statement into the account this reconciliation belongs to, match
   * it, and show what landed — without leaving the page the statement is being
   * worked from.
   */
  function importStatementFile(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const parsed = parseStatementRows(parseCsv(String(reader.result)), {
        decimals: baseDecimals,
      });
      if (parsed.rows.length === 0) {
        message.warning(describeStatementParse(parsed));
        return;
      }
      setImporting(true);
      const res = await importStatementIntoReconciliationAction(
        reconciliationId,
        file.name,
        parsed.rows,
      );
      setImporting(false);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to import the statement");
        return;
      }
      message.success(
        `${res.data.inserted} transaction(s) imported, ${res.data.duplicates} already on file, ` +
          `${res.data.matched} matched to a ledger entry.`,
      );
      void loadStatement();
      void load();
    };
    reader.readAsText(file);
    return false;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {detail && (
        <Space size="large" wrap>
          <Statistic title="Beginning" value={fmt(detail.beginningMinor)} />
          <Statistic title="Cleared" value={fmt(detail.clearedTotalMinor)} />
          <Statistic title="Reconciled balance" value={fmt(detail.reconciledBalanceMinor)} />
          <Statistic title="Statement ending" value={fmt(detail.statementEndingMinor)} />
          <Statistic title="Difference" value={fmt(detail.differenceMinor)} />
          <Tag color={completed ? "green" : "blue"}>{detail.status}</Tag>
        </Space>
      )}
      <p><Link href={`/banking/reconcile/${reconciliationId}/report`}>View report</Link></p>
      {detail && !completed && (
        <Alert
          type={detail.differenceMinor === 0 ? "success" : "warning"}
          message={
            detail.differenceMinor === 0
              ? "Difference is zero — ready to complete."
              : `Unexplained difference: ${fmt(detail.differenceMinor)} ${baseCurrency}.`
          }
        />
      )}
      {canWrite && !completed && (
        <Space wrap>
          <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={importStatementFile}>
            <Button icon={<UploadOutlined />} loading={importing}>
              Import bank statement
            </Button>
          </Upload>
          <Button type="primary" disabled={!detail || detail.differenceMinor !== 0} onClick={complete}>
            Complete
          </Button>
          <Button disabled={!detail || detail.differenceMinor === 0} onClick={() => setAdjOpen(true)}>
            Record adjustment
          </Button>
        </Space>
      )}
      {completed && canReopen && (
        <Button danger onClick={reopen}>
          Reopen
        </Button>
      )}
      <div>
        <Space size="small" style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>Statement lines</Typography.Text>
          <Typography.Text type="secondary">
            {statementLines.length === 0
              ? "None imported for this period yet — load the statement above."
              : `${summary.total} line(s) up to the statement date`}
          </Typography.Text>
          {statementLines.length > 0 ? (
            <Space size={4} wrap>
              <Tag color="green">{summary.matched} matched</Tag>
              {summary.requiresReview > 0 ? (
                <Tag color="gold">{summary.requiresReview} requires review</Tag>
              ) : null}
              {summary.unmatched > 0 ? <Tag color="orange">{summary.unmatched} unmatched</Tag> : null}
              {summary.excluded > 0 ? <Tag>{summary.excluded} excluded</Tag> : null}
            </Space>
          ) : null}
        </Space>
        <Table<StatementLineView>
          rowKey="id"
          size="small"
          pagination={statementLines.length > 10 ? { pageSize: 10 } : false}
          dataSource={statementLines}
          locale={{ emptyText: "No statement lines imported for this period" }}
          columns={[
            { title: "Date", dataIndex: "txnDate", width: 110 },
            { title: "Description", dataIndex: "description" },
            {
              title: "Reference",
              dataIndex: "reference",
              width: 130,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "Amount",
              dataIndex: "amountMinor",
              width: 130,
              align: "right",
              render: (value: number) => fmt(value),
            },
            {
              // A proposal used to be painted the same green as an approved
              // link, which told the reconciler a line was settled when a
              // machine had only guessed. The state is now explicit.
              title: "Status",
              key: "state",
              width: 240,
              render: (_: unknown, line) => {
                const state = statementLineState(line.status, line.hasSuggestion);
                const meta = STATEMENT_LINE_STATES[state];
                return (
                  <Space size={4} direction="vertical">
                    <Tag color={meta.color}>{meta.label}</Tag>
                    {line.suggestedEntry ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {state === "matched" ? "linked to" : "suggested"} {line.suggestedEntry}
                      </Typography.Text>
                    ) : null}
                  </Space>
                );
              },
            },
          ]}
        />
      </div>

      <Typography.Text strong>Ledger lines in this reconciliation</Typography.Text>
      <Table
        rowKey="journalLineId"
        loading={loading}
        dataSource={lines}
        columns={[
          {
            title: "Cleared",
            render: (_, l) => (
              <input
                type="checkbox"
                checked={l.cleared}
                disabled={!canWrite || completed}
                onChange={(e) => void toggle(l, e.target.checked)}
              />
            ),
          },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Entry", dataIndex: "entryNumber" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Memo", dataIndex: "memo" },
          { title: "Amount", align: "right", render: (_, l) => fmt(l.signedMinor) },
        ]}
      />
      <Modal open={adjOpen} title="Record adjustment" onCancel={() => setAdjOpen(false)} onOk={submitAdjust}>
        <p>
          An adjusting entry for the outstanding difference{" "}
          {detail ? `(${fmt(detail.differenceMinor)} ${baseCurrency})` : ""} will post to the selected account.
        </p>
        <Form form={form} layout="vertical">
          <Form.Item name="offset_account_id" label="Offset account (bank charges / interest)" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={offsetAccounts.map((a) => ({ value: a.id, label: a.label }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
