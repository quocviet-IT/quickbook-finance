"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createJournalAction, reverseEntryAction, listJournalAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

interface Account {
  id: string;
  account_code: string;
  name: string;
}
interface Props {
  canWrite: boolean;
  accounts: Account[];
  baseCurrency: string;
  baseDecimals: number;
}
interface LineForm {
  account_id?: string;
  debit?: number;
  credit?: number;
}

export default function JournalClient({ canWrite, accounts, baseCurrency, baseDecimals }: Props) {
  const { message, modal } = App.useApp();
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}, {}]);

  const load = async () => {
    setLoading(true);
    const r = await listJournalAction({});
    setLoading(false);
    if (r.ok && r.data) setEntries(r.data);
    else message.error(r.error ?? "Failed to load journal entries");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + toMinor(l.debit ?? 0, baseDecimals), 0);
    const c = lines.reduce((s, l) => s + toMinor(l.credit ?? 0, baseDecimals), 0);
    return { d, c, diff: d - c };
  }, [lines, baseDecimals]);

  const resetForm = () => {
    setLines([{}, {}]);
    form.resetFields();
  };

  const submit = async () => {
    const header = await form.validateFields();
    const payload = {
      entry_date: header.entry_date?.format("YYYY-MM-DD"),
      description: header.description ?? null,
      source_ref: header.source_ref ?? null,
      currency_code: baseCurrency,
      lines: lines
        .filter((l) => l.account_id && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0))
        .map((l) => ({
          account_id: l.account_id!,
          debit_minor: toMinor(l.debit ?? 0, baseDecimals),
          credit_minor: toMinor(l.credit ?? 0, baseDecimals),
        })),
    };
    setSaving(true);
    const r = await createJournalAction(payload);
    setSaving(false);
    if (r.ok) {
      message.success("Journal entry posted");
      setOpen(false);
      resetForm();
      void load();
    } else {
      message.error(r.error ?? "Failed to post journal entry");
    }
  };

  const reverse = (entry: JournalEntrySummary) => {
    let reason = "";
    modal.confirm({
      title: `Reverse ${entry.entryNumber}?`,
      content: (
        <Input
          placeholder="Reason for reversal"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okText: "Reverse",
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await reverseEntryAction({ entry_id: entry.id, reason });
        if (r.ok) {
          message.success("Reversal posted");
          void load();
        } else {
          message.error(r.error ?? "Failed to reverse entry");
          throw new Error(r.error ?? "Failed to reverse entry");
        }
      },
    });
  };

  const fmt = (m: number) =>
    m ? fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals }) : "";

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {canWrite && (
        <Button type="primary" onClick={() => setOpen(true)}>
          New Journal Entry
        </Button>
      )}
      <Table<JournalEntrySummary>
        rowKey="id"
        loading={loading}
        dataSource={entries}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (e) => (
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={e.lines}
              columns={[
                { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                { title: "Memo", dataIndex: "memo" },
                { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
              ]}
            />
          ),
        }}
        columns={[
          { title: "Number", dataIndex: "entryNumber" },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Source", dataIndex: "sourceType", render: (s: string) => <Tag>{s}</Tag> },
          { title: "Description", dataIndex: "description" },
          {
            title: "Status",
            render: (_, e) => (e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag>),
          },
          {
            title: "",
            key: "actions",
            render: (_, e) =>
              canWrite && e.status === "posted" && !e.isReversed && !e.isReversal && e.sourceType === "manual" ? (
                <Button size="small" onClick={() => reverse(e)}>
                  Reverse
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        open={open}
        title="New Journal Entry"
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okButtonProps={{ disabled: totals.diff !== 0 || totals.d === 0 }}
        width={760}
      >
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="entry_date" label="Date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="source_ref" label="Source reference">
              <Input placeholder="Optional" />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }}>
              <Select
                showSearch
                style={{ width: 280 }}
                placeholder="Account"
                optionFilterProp="label"
                value={l.account_id}
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, account_id: v } : x)))}
              />
              <InputNumber
                placeholder="Debit"
                min={0}
                precision={baseDecimals}
                value={l.debit}
                onChange={(v) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, debit: v ?? undefined, credit: undefined } : x)))
                }
              />
              <InputNumber
                placeholder="Credit"
                min={0}
                precision={baseDecimals}
                value={l.credit}
                onChange={(v) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, credit: v ?? undefined, debit: undefined } : x)))
                }
              />
              <Button danger onClick={() => setLines((p) => p.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
                ×
              </Button>
            </Space>
          ))}
          <Button onClick={() => setLines((p) => [...p, {}])}>Add line</Button>
          <div style={{ marginTop: 12 }}>
            Debit: {fmt(totals.d)} &nbsp; Credit: {fmt(totals.c)} &nbsp;
            <Tag color={totals.diff === 0 ? "green" : "red"}>Difference: {fmt(Math.abs(totals.diff))}</Tag>
          </div>
        </Card>
      </Modal>
    </Space>
  );
}
