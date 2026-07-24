"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import {
  createCreditMemoAction,
  listCreditMemosAction,
  voidCreditMemoAction,
  applyCreditMemoAction,
  listOpenInvoicesAction,
} from "./actions";
import type { CreditMemoRow, CustomerRow, AccountRow, TaxCodeRow } from "@/lib/db/types";

interface Props {
  canWrite: boolean;
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  baseCurrency: string;
  baseDecimals: number;
}
interface LineForm {
  description?: string;
  quantity?: number;
  unit_price?: number;
  income_account_id?: string;
  tax_code_id?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  issued: "blue",
  partial: "gold",
  applied: "green",
  voided: "red",
};

export default function CreditMemosClient({
  canWrite,
  customers,
  incomeAccounts,
  taxCodes,
  baseCurrency,
  baseDecimals,
}: Props) {
  const { message } = App.useApp();
  const [memos, setMemos] = useState<CreditMemoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}]);
  const [applyFor, setApplyFor] = useState<CreditMemoRow | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<{ id: string; invoice_number: string; balance_due_minor: number }[]>(
    [],
  );
  const [allocs, setAllocs] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const r = await listCreditMemosAction();
    setLoading(false);
    if (r.ok && r.data) setMemos(r.data);
    else message.error(r.error ?? "Failed to load credit memos");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (m: number) =>
    fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const total = useMemo(
    () => lines.reduce((s, l) => s + toMinor((l.quantity ?? 0) * (l.unit_price ?? 0), baseDecimals), 0),
    [lines, baseDecimals],
  );

  const resetForm = () => {
    setLines([{}]);
    form.resetFields();
  };

  const submit = async () => {
    const h = await form.validateFields();
    const payload = {
      customer_id: h.customer_id,
      currency_code: baseCurrency,
      memo_date: h.memo_date ? h.memo_date.format("YYYY-MM-DD") : undefined,
      reason: h.reason ?? null,
      memo: h.memo ?? null,
      lines: lines
        .filter((l) => l.income_account_id && (l.unit_price ?? 0) > 0)
        .map((l) => ({
          description: l.description ?? "",
          quantity: l.quantity ?? 1,
          unit_price_minor: toMinor(l.unit_price ?? 0, baseDecimals),
          income_account_id: l.income_account_id!,
          tax_code_id: l.tax_code_id || null,
        })),
    };
    setSaving(true);
    const r = await createCreditMemoAction(payload);
    setSaving(false);
    if (r.ok) {
      message.success("Credit memo issued");
      setOpen(false);
      resetForm();
      void load();
    } else {
      message.error(r.error ?? "Failed to create credit memo");
    }
  };

  const voidMemo = async (m: CreditMemoRow) => {
    const r = await voidCreditMemoAction(m.id);
    if (r.ok) {
      message.success("Credit memo voided");
      void load();
    } else {
      message.error(r.error ?? "Failed to void credit memo");
    }
  };

  const openApply = async (m: CreditMemoRow) => {
    setApplyFor(m);
    setAllocs({});
    setOpenInvoices([]);
    const r = await listOpenInvoicesAction(m.customer_id, m.currency_code);
    if (r.ok && r.data) setOpenInvoices(r.data);
    else message.error(r.error ?? "Failed to load open invoices");
  };

  const submitApply = async () => {
    if (!applyFor) return;
    const arr = Object.entries(allocs)
      .filter(([, v]) => v > 0)
      .map(([target_id, v]) => ({ target_id, amount_minor: toMinor(v, baseDecimals) }));
    if (arr.length === 0) {
      message.error("Enter at least one allocation amount");
      return;
    }
    setApplyBusy(true);
    const r = await applyCreditMemoAction(applyFor.id, arr);
    setApplyBusy(false);
    if (r.ok) {
      message.success("Credit memo applied");
      setApplyFor(null);
      void load();
    } else {
      message.error(r.error ?? "Failed to apply credit memo");
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {canWrite && (
        <Button type="primary" onClick={() => setOpen(true)}>
          New Credit Memo
        </Button>
      )}
      <Table<CreditMemoRow>
        rowKey="id"
        loading={loading}
        dataSource={memos}
        columns={[
          { title: "Number", dataIndex: "credit_memo_number", render: (n) => n ?? <Tag>draft</Tag> },
          { title: "Date", dataIndex: "memo_date" },
          { title: "Total", align: "right", render: (_, m) => fmt(m.total_minor) },
          { title: "Remaining", align: "right", render: (_, m) => fmt(m.balance_remaining_minor) },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "",
            key: "actions",
            render: (_, m) =>
              canWrite && (m.status === "issued" || m.status === "partial") ? (
                <Space>
                  <Button size="small" onClick={() => openApply(m)}>
                    Apply
                  </Button>
                  <Button size="small" danger onClick={() => voidMemo(m)}>
                    Void
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />

      <Modal
        open={open}
        title="New Credit Memo"
        width={780}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okButtonProps={{ disabled: total <= 0 }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]}>
              <Select
                style={{ width: 280 }}
                showSearch
                optionFilterProp="label"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
            <Form.Item name="memo_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="Reason">
            <Input />
          </Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }} wrap>
              <Input
                placeholder="Description"
                style={{ width: 200 }}
                value={l.description}
                onChange={(e) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                }
              />
              <InputNumber
                placeholder="Quantity"
                min={0}
                value={l.quantity}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, quantity: v ?? undefined } : x)))}
              />
              <InputNumber
                placeholder="Unit price"
                min={0}
                precision={baseDecimals}
                value={l.unit_price}
                onChange={(v) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, unit_price: v ?? undefined } : x)))
                }
              />
              <Select
                placeholder="Income account"
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                value={l.income_account_id}
                options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, income_account_id: v } : x)))}
              />
              <Select
                allowClear
                placeholder="Tax"
                style={{ width: 160 }}
                value={l.tax_code_id ?? undefined}
                options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate_percent}%)` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, tax_code_id: v ?? null } : x)))}
              />
              <Button danger onClick={() => setLines((p) => p.filter((_, j) => j !== i))} disabled={lines.length <= 1}>
                ×
              </Button>
            </Space>
          ))}
          <Button onClick={() => setLines((p) => [...p, {}])}>Add line</Button>
          <div style={{ marginTop: 12 }}>
            Total: {fmt(total)} {baseCurrency}
          </div>
        </Card>
      </Modal>

      <Modal
        open={!!applyFor}
        title={`Apply ${applyFor?.credit_memo_number ?? ""}`}
        onCancel={() => setApplyFor(null)}
        onOk={submitApply}
        confirmLoading={applyBusy}
        destroyOnHidden
      >
        <p>
          Remaining: {applyFor ? fmt(applyFor.balance_remaining_minor) : ""} {baseCurrency}
        </p>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={openInvoices}
          columns={[
            { title: "Invoice", dataIndex: "invoice_number" },
            { title: "Balance", align: "right", render: (_, r) => fmt(r.balance_due_minor) },
            {
              title: "Apply",
              render: (_, r) => (
                <InputNumber
                  min={0}
                  precision={baseDecimals}
                  max={fromMinor(
                    Math.min(r.balance_due_minor, applyFor?.balance_remaining_minor ?? r.balance_due_minor),
                    baseDecimals,
                  )}
                  onChange={(v) => setAllocs((p) => ({ ...p, [r.id]: (v as number) ?? 0 }))}
                />
              ),
            },
          ]}
        />
      </Modal>
    </Space>
  );
}
