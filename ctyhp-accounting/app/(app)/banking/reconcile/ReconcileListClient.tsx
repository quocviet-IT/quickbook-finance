"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
import type { StatementReconciliationRow } from "@/lib/db/types";

interface Bank {
  id: string;
  label: string;
}
interface Props {
  canWrite: boolean;
  banks: Bank[];
  baseDecimals: number;
}

export default function ReconcileListClient({ canWrite, banks, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [bankId, setBankId] = useState<string | undefined>(banks[0]?.id);
  const [rows, setRows] = useState<StatementReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async (id: string | undefined) => {
    if (!id) return;
    setLoading(true);
    const r = await listReconciliationsAction(id);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const submit = async () => {
    const v = await form.validateFields();
    const r = await createReconciliationAction({
      bank_account_id: bankId,
      statement_ending_date: v.ending_date.format("YYYY-MM-DD"),
      statement_ending_balance_minor: toMinor(v.ending_balance ?? 0, baseDecimals),
    });
    if (r.ok) {
      message.success("Reconciliation started");
      setOpen(false);
      form.resetFields();
      void load(bankId);
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select
          style={{ width: 320 }}
          value={bankId}
          onChange={setBankId}
          options={banks.map((b) => ({ value: b.id, label: b.label }))}
        />
        {canWrite && (
          <Button type="primary" onClick={() => setOpen(true)} disabled={!bankId}>
            New reconciliation
          </Button>
        )}
      </Space>
      <Table<StatementReconciliationRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: "Ending date", dataIndex: "statement_ending_date" },
          { title: "Beginning", align: "right", render: (_, r) => fmt(r.beginning_balance_minor) },
          { title: "Statement ending", align: "right", render: (_, r) => fmt(r.statement_ending_balance_minor) },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={s === "completed" ? "green" : "blue"}>{s}</Tag>,
          },
          { title: "", render: (_, r) => <Link href={`/banking/reconcile/${r.id}`}>Open</Link> },
        ]}
      />
      <Modal open={open} title="New reconciliation" onCancel={() => setOpen(false)} onOk={submit} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="ending_date" label="Statement ending date" rules={[{ required: true }]}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="ending_balance" label="Statement ending balance" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} precision={baseDecimals} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
