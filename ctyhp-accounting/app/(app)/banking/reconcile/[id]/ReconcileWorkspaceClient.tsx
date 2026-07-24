"use client";
import { useEffect, useState, useCallback } from "react";
import { App, Alert, Button, Form, Input, Modal, Select, Space, Statistic, Table, Tag } from "antd";
import { fromMinor } from "@/lib/domain/money";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
  setClearedAction,
  recordAdjustmentAction,
  completeReconciliationAction,
  reopenReconciliationAction,
} from "../actions";
import type { ReconLineView, ReconDetail } from "@/lib/services/bankrec";

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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
          message.success("Reopened");
          void load();
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

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
        <Space>
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
