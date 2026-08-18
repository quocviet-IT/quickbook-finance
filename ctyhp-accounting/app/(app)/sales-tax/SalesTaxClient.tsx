"use client";
import { useState } from "react";
import {
  App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography,
} from "antd";
import dayjs from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, TaxCodeRow, TaxPaymentRow, UsStateRow } from "@/lib/db/types";
import type { SalesTaxLiability } from "@/lib/domain/salestax";
import {
  groupTaxCodesByState,
  liabilityByState,
  stateName,
  type StateLiabilityLine,
} from "@/lib/domain/tax-jurisdiction";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  liabilityAction, recordTaxPaymentAction, voidTaxPaymentAction,
  createTaxCodeAction, updateTaxCodeAction, setTaxCodeActiveAction,
} from "./actions";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const TAX_PAYMENTS_DEFAULT_PAGE_SIZE = 20;

interface Props {
  initialFrom: string;
  initialTo: string;
  initialLiability: SalesTaxLiability;
  payments: TaxPaymentRow[];
  taxCodes: TaxCodeRow[];
  usStates: UsStateRow[];
  taxPayableAccounts: AccountRow[];
  bankAccounts: AccountRow[];
  postingAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
  isAdmin: boolean;
}

export default function SalesTaxClient(props: Props) {
  const { message, modal } = App.useApp();
  const baseCurrency = props.currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => props.currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const money = (minor: number) => formatMoney(minor, baseCurrency, decimalsOf(baseCurrency));

  // --- Liability ---
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs(props.initialFrom), dayjs(props.initialTo)]);
  const [liability, setLiability] = useState<SalesTaxLiability>(props.initialLiability);
  const [loading, setLoading] = useState(false);
  const [paymentsPageSize, setPaymentsPageSize] = useState<number>(TAX_PAYMENTS_DEFAULT_PAGE_SIZE);

  async function reloadLiability(r: [dayjs.Dayjs, dayjs.Dayjs]) {
    setLoading(true);
    const res = await liabilityAction(r[0].format("YYYY-MM-DD"), r[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (res.ok && res.data) setLiability(res.data);
    else message.error(res.error ?? "Failed to load liability");
  }

  // --- Jurisdictions ---
  // The rate list and the liability are read state-first: that is how a return
  // is filed, and with rates in ten states a flat list of codes is unusable.
  const byState = liabilityByState(liability.lines, props.taxCodes, props.usStates);
  const stateOfCode = (taxCodeId: string) =>
    stateName(props.taxCodes.find((t) => t.id === taxCodeId)?.state_code ?? null, props.usStates);
  const ratesByState = groupTaxCodesByState(props.taxCodes, props.usStates, {
    direction: "",
    activeOnly: false,
  }).flatMap((group) => group.codes as TaxCodeRow[]);
  const stateFilters = [
    ...new Map(
      props.taxCodes.map((t) => [
        t.state_code ?? "",
        { text: stateName(t.state_code, props.usStates), value: t.state_code ?? "" },
      ]),
    ).values(),
  ].sort((a, b) => a.text.localeCompare(b.text));

  // --- Record payment ---
  const [payOpen, setPayOpen] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payForm] = Form.useForm();

  async function submitPayment() {
    const v = await payForm.validateFields();
    setPaySaving(true);
    const res = await recordTaxPaymentAction({
      tax_account_id: v.tax_account_id,
      bank_account_id: v.bank_account_id,
      currency_code: baseCurrency,
      amount_minor: toMinorUnits(Number(v.amount ?? 0), decimalsOf(baseCurrency)),
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      period_start: v.period ? v.period[0].format("YYYY-MM-DD") : null,
      period_end: v.period ? v.period[1].format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
    });
    setPaySaving(false);
    if (res.ok) {
      message.success("Tax payment recorded");
      setPayOpen(false);
      payForm.resetFields();
      reloadLiability(range);
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  function confirmVoidPayment(id: string) {
    modal.confirm({
      title: "Void this tax payment?",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidTaxPaymentAction(id);
        if (res.ok) { message.success("Tax payment voided"); reloadLiability(range); }
        else message.error(res.error ?? "Failed to void payment");
      },
    });
  }

  // --- Tax code edit ---
  const [tcOpen, setTcOpen] = useState(false);
  const [tcSaving, setTcSaving] = useState(false);
  const [tcEditing, setTcEditing] = useState<TaxCodeRow | null>(null);
  const [tcForm] = Form.useForm();

  function openTaxCode(tc: TaxCodeRow | null) {
    setTcEditing(tc);
    tcForm.resetFields();
    if (tc) tcForm.setFieldsValue({
      code: tc.code, name: tc.name, rate_percent: Number(tc.rate_percent),
      direction: tc.direction, tax_account_id: tc.tax_account_id ?? undefined, is_active: tc.is_active,
      state_code: tc.state_code ?? undefined,
    });
    else tcForm.setFieldsValue({ direction: "sales", rate_percent: 0, is_active: true });
    setTcOpen(true);
  }

  async function submitTaxCode() {
    const v = await tcForm.validateFields();
    const payload = {
      code: v.code, name: v.name, rate_percent: Number(v.rate_percent),
      direction: v.direction, tax_account_id: v.tax_account_id ?? null, is_active: v.is_active ?? true,
      state_code: v.state_code ?? null,
    };
    setTcSaving(true);
    const res = tcEditing ? await updateTaxCodeAction(tcEditing.id, payload) : await createTaxCodeAction(payload);
    setTcSaving(false);
    if (res.ok) { message.success(tcEditing ? "Rate updated" : "Rate created"); setTcOpen(false); }
    else message.error(res.error ?? "Failed to save rate");
  }

  return (
    <Tabs
      defaultActiveKey="liability"
      items={[
        {
          key: "liability",
          label: "Liability",
          children: (
            <>
              <Space style={{ marginBottom: 16 }} wrap>
                <DatePicker.RangePicker
                  value={range}
                  onChange={(r) => { if (r && r[0] && r[1]) { const rr: [dayjs.Dayjs, dayjs.Dayjs] = [r[0], r[1]]; setRange(rr); reloadLiability(rr); } }}
                />
                {props.canWrite && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setPayOpen(true)}>Record payment</Button>
                )}
              </Space>
              {/* A return is filed per state, so the state total comes first and
                  the codes behind it stay below. */}
              <Table<StateLiabilityLine>
                rowKey={(row) => row.stateCode ?? "none"}
                loading={loading}
                dataSource={byState}
                pagination={false}
                scroll={{ x: "max-content" }}
                style={{ marginBottom: 24 }}
                title={() => <Typography.Text strong>Owed by state</Typography.Text>}
                locale={{ emptyText: "No tax collected in this period" }}
                columns={[
                  { title: "State", dataIndex: "stateName" },
                  {
                    title: "Rates",
                    key: "codes",
                    render: (_: unknown, r) => r.codes.map((c) => c.code).join(", "),
                  },
                  { title: "Taxable", dataIndex: "taxableMinor", align: "right", render: (v: number) => money(v) },
                  { title: "Tax collected", dataIndex: "taxMinor", align: "right", render: (v: number) => money(v) },
                ]}
              />
              <Table<SalesTaxLiability["lines"][number]>
                rowKey="taxCodeId"
                loading={loading}
                dataSource={liability.lines}
                pagination={false}
                scroll={{ x: "max-content" }}
                title={() => <Typography.Text strong>By rate</Typography.Text>}
                columns={[
                  { title: "Code", dataIndex: "code" },
                  {
                    title: "State",
                    key: "state",
                    render: (_: unknown, r) => stateOfCode(r.taxCodeId),
                  },
                  { title: "Name", dataIndex: "name" },
                  { title: "Rate", dataIndex: "ratePercent", align: "right", render: (v: number) => `${v}%` },
                  { title: "Taxable", dataIndex: "taxableMinor", align: "right", render: (v: number) => money(v) },
                  { title: "Tax collected", dataIndex: "taxMinor", align: "right", render: (v: number) => money(v) },
                ]}
              />
              <div style={{ textAlign: "right", marginTop: 12 }}>
                <div>Tax collected (period): <b>{money(liability.totalTaxCollectedMinor)}</b></div>
                <div>Payments (period): {money(liability.paymentsMinor)}</div>
                <Typography.Text strong>Net owed now: {money(liability.netOwedMinor)}</Typography.Text>
              </div>
            </>
          ),
        },
        {
          key: "payments",
          label: "Payments",
          children: (
            <Table<TaxPaymentRow>
              rowKey="id"
              dataSource={props.payments}
              scroll={{ x: "max-content" }}
              pagination={clientTablePagination(
                paymentsPageSize,
                setPaymentsPageSize,
                pageSizeOptionsFor(TAX_PAYMENTS_DEFAULT_PAGE_SIZE),
              )}
              columns={[
                { title: "Number", dataIndex: "payment_number", render: (v) => v ?? "—" },
                { title: "Date", dataIndex: "payment_date" },
                { title: "Period", key: "period", render: (_, r) => (r.period_start && r.period_end ? `${r.period_start} → ${r.period_end}` : "—") },
                { title: "Amount", dataIndex: "amount_minor", align: "right", render: (v: number) => money(v) },
                { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "green"}>{s}</Tag> },
                {
                  title: "Actions", key: "actions",
                  render: (_, r) => props.canWrite && r.status !== "void"
                    ? <Button size="small" type="link" danger onClick={() => confirmVoidPayment(r.id)}>Void</Button>
                    : null,
                },
              ]}
            />
          ),
        },
        {
          key: "rates",
          label: "Tax rates",
          children: (
            <>
              <Space style={{ marginBottom: 16 }}>
                {props.isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => openTaxCode(null)}>New rate</Button>}
              </Space>
              <Table<TaxCodeRow>
                rowKey="id"
                dataSource={ratesByState}
                scroll={{ x: "max-content" }}
                pagination={false}
                columns={[
                  {
                    title: "State",
                    dataIndex: "state_code",
                    filters: stateFilters,
                    onFilter: (value, record) => (record.state_code ?? "") === value,
                    render: (v: string | null) => stateName(v, props.usStates),
                  },
                  { title: "Code", dataIndex: "code" },
                  { title: "Name", dataIndex: "name" },
                  { title: "Rate", dataIndex: "rate_percent", align: "right", render: (v: number) => `${v}%` },
                  { title: "Direction", dataIndex: "direction" },
                  { title: "Status", dataIndex: "is_active", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
                  {
                    title: "Actions", key: "actions",
                    render: (_, r) => props.isAdmin ? (
                      <Space>
                        <Button size="small" type="link" onClick={() => openTaxCode(r)}>Edit</Button>
                        <Button size="small" type="link" onClick={async () => {
                          const res = await setTaxCodeActiveAction(r.id, !r.is_active);
                          if (res.ok) message.success("Updated"); else message.error(res.error ?? "Failed");
                        }}>{r.is_active ? "Deactivate" : "Activate"}</Button>
                      </Space>
                    ) : null,
                  },
                ]}
              />
            </>
          ),
        },
      ]}
      tabBarExtraContent={
        <>
          {/* Record payment modal */}
          <Modal title="Record tax payment" open={payOpen} onOk={submitPayment} onCancel={() => setPayOpen(false)} confirmLoading={paySaving} okText="Record">
            <Form form={payForm} layout="vertical">
              <Form.Item name="tax_account_id" label="Sales Tax Payable account" rules={[{ required: true, message: "Select the tax account" }]}>
                <Select showSearch optionFilterProp="label" options={props.taxPayableAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="bank_account_id" label="Pay from" rules={[{ required: true, message: "Select a bank account" }]}>
                <Select showSearch optionFilterProp="label" options={props.bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter an amount" }]}>
                <InputNumber min={0} precision={decimalsOf(baseCurrency)} prefix="$" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="payment_date" label="Payment date"><DatePicker /></Form.Item>
              <Form.Item name="period" label="Period covered"><DatePicker.RangePicker /></Form.Item>
              <Form.Item name="memo" label="Memo"><Input.TextArea rows={2} /></Form.Item>
            </Form>
          </Modal>

          {/* Tax code modal */}
          <Modal title={tcEditing ? "Edit rate" : "New rate"} open={tcOpen} onOk={submitTaxCode} onCancel={() => setTcOpen(false)} confirmLoading={tcSaving} okText={tcEditing ? "Save" : "Create"}>
            <Form form={tcForm} layout="vertical">
              <Form.Item
                name="state_code"
                label="State"
                extra="Leave empty for a code that is not filed in one state, such as an exemption."
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Select a state"
                  options={props.usStates.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` }))}
                />
              </Form.Item>
              <Form.Item name="code" label="Code" rules={[{ required: true, message: "Code is required" }]}><Input /></Form.Item>
              <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}><Input /></Form.Item>
              <Form.Item name="rate_percent" label="Rate (%)" rules={[{ required: true, message: "Rate is required" }]}>
                <InputNumber min={0} max={100} precision={4} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="direction" label="Direction" rules={[{ required: true }]}>
                <Select options={[{ value: "sales", label: "Sales" }, { value: "purchase", label: "Purchase" }, { value: "none", label: "None" }]} />
              </Form.Item>
              <Form.Item name="tax_account_id" label="Tax account">
                <Select allowClear showSearch optionFilterProp="label" options={props.postingAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="is_active" label="Active" valuePropName="checked" initialValue={true}>
                <input type="checkbox" />
              </Form.Item>
            </Form>
          </Modal>
        </>
      }
    />
  );
}
