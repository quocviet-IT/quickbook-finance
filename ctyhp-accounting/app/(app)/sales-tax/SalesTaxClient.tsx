"use client";
import { useState } from "react";
import Link from "next/link";
import {
  App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tabs, Typography,
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
import { formatDate, formatMoney } from "@/lib/format";
import {
  liabilityAction, voidTaxPaymentAction,
  createTaxCodeAction, updateTaxCodeAction, setTaxCodeActiveAction,
} from "./actions";
import RecordTaxPaymentModal from "@/components/sales-tax/RecordTaxPaymentModal";
import { LIABILITY_REPORT_LINK_LABEL } from "@/lib/domain/sales-tax-liability";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import FilterBar from "@/components/ui/FilterBar";
import TableEmpty from "@/components/ui/TableEmpty";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const TAX_PAYMENTS_DEFAULT_PAGE_SIZE = 20;

/** Owed by state: Taxable and Tax collected. State and its Rates take what is left. */
export const SALES_TAX_BY_STATE_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.MONEY] as const;

/**
 * By rate: Code, State, Rate, Taxable and Tax collected. The rate's Name takes
 * what is left, at least COLUMN.TEXT_MIN. State is a name of up to "District of
 * Columbia", which is the picker width.
 */
export const SALES_TAX_BY_RATE_FIXED_WIDTHS = [
  COLUMN.CODE,
  COLUMN.PICKER,
  COLUMN.QTY,
  COLUMN.MONEY,
  COLUMN.MONEY,
] as const;

/**
 * Payments: Number, Date, Amount, Status and Actions. Nothing here is free
 * text, so Period, two dates and an arrow, takes what is left and keeps the
 * room it needs as its floor.
 */
export const SALES_TAX_PAYMENTS_FIXED_WIDTHS = [
  COLUMN.CODE,
  COLUMN.DATE,
  COLUMN.MONEY,
  COLUMN.STATUS,
  COLUMN.ACTION * 2,
] as const;
/** What Period needs: two dates and an arrow. */
export const SALES_TAX_PERIOD_FLOOR = COLUMN.DATE * 2 + COLUMN.ACTION;

/**
 * Tax rates: State (with its filter), Code, Rate, Direction, Status and the
 * Edit and Deactivate buttons. The rate's Name takes what is left, at least
 * COLUMN.TEXT_MIN.
 */
export const SALES_TAX_RATES_FIXED_WIDTHS = [
  COLUMN.PICKER,
  COLUMN.CODE,
  COLUMN.QTY,
  COLUMN.QTY,
  COLUMN.CODE,
  COLUMN.ACTION * 4,
] as const;

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
  const [tab, setTab] = useState("liability");

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

  // Held here so an empty table can send the reader to the tab that fills it.
  const hasRates = props.taxCodes.some((t) => t.is_active);
  const noTaxCollected = hasRates ? (
    <TableEmpty
      title="No sales tax collected in this period"
      description="Tax shows here, by state, once an invoice with a taxed line is issued between these dates."
      action={
        <Link href="/invoices?new=1">
          <Button icon={<PlusOutlined />}>Create an invoice</Button>
        </Link>
      }
    />
  ) : (
    <TableEmpty
      title="No sales tax rates yet"
      description="An invoice can only charge tax at a rate set up here. Add the rates you charge, by state."
      action={<Button onClick={() => setTab("rates")}>Set up tax rates</Button>}
    />
  );

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        {
          key: "liability",
          label: "Liability",
          children: (
            <>
              <FilterBar
                ariaLabel="Liability dates and actions"
                actions={
                  props.canWrite ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPayOpen(true)}>Record payment</Button>
                  ) : undefined
                }
              >
                <DatePicker.RangePicker
                  aria-label="Liability date range"
                  value={range}
                  onChange={(r) => { if (r && r[0] && r[1]) { const rr: [dayjs.Dayjs, dayjs.Dayjs] = [r[0], r[1]]; setRange(rr); reloadLiability(rr); } }}
                />
                <Link href="/reports/sales-tax-liability">{LIABILITY_REPORT_LINK_LABEL}</Link>
              </FilterBar>
              {/* A return is filed per state, so the state total comes first and
                  the codes behind it stay below. */}
              <DataTable<StateLiabilityLine>
                rowKey={(row) => row.stateCode ?? "none"}
                loading={loading}
                rows={byState}
                pagination={false}
                style={{ marginBottom: 24 }}
                title={() => <Typography.Text strong>Owed by state</Typography.Text>}
                locale={{ emptyText: loading ? <TableEmpty loading title="" /> : noTaxCollected }}
                columns={[
                  flexColumn<StateLiabilityLine>({ title: "State", dataIndex: "stateName" }),
                  flexColumn<StateLiabilityLine>({
                    title: "Rates",
                    key: "codes",
                    render: (_: unknown, r: StateLiabilityLine) => r.codes.map((c) => c.code).join(", "),
                  }),
                  { title: "Taxable", dataIndex: "taxableMinor", width: SALES_TAX_BY_STATE_FIXED_WIDTHS[0], align: "right", render: (v: number) => money(v) },
                  { title: "Tax collected", dataIndex: "taxMinor", width: SALES_TAX_BY_STATE_FIXED_WIDTHS[1], align: "right", render: (v: number) => money(v) },
                ]}
              />
              {/* The rates behind the state totals. With no tax at all it was
                  a second empty table under the first, saying "No data". */}
              {liability.lines.length > 0 ? (
              <DataTable<SalesTaxLiability["lines"][number]>
                rowKey="taxCodeId"
                loading={loading}
                rows={liability.lines}
                pagination={false}
                title={() => <Typography.Text strong>By rate</Typography.Text>}
                columns={[
                  { title: "Code", dataIndex: "code", width: SALES_TAX_BY_RATE_FIXED_WIDTHS[0] },
                  {
                    title: "State",
                    key: "state",
                    width: SALES_TAX_BY_RATE_FIXED_WIDTHS[1],
                    render: (_: unknown, r) => stateOfCode(r.taxCodeId),
                  },
                  flexColumn<SalesTaxLiability["lines"][number]>({ title: "Name", dataIndex: "name" }),
                  { title: "Rate", dataIndex: "ratePercent", width: SALES_TAX_BY_RATE_FIXED_WIDTHS[2], align: "right", render: (v: number) => `${v}%` },
                  { title: "Taxable", dataIndex: "taxableMinor", width: SALES_TAX_BY_RATE_FIXED_WIDTHS[3], align: "right", render: (v: number) => money(v) },
                  { title: "Tax collected", dataIndex: "taxMinor", width: SALES_TAX_BY_RATE_FIXED_WIDTHS[4], align: "right", render: (v: number) => money(v) },
                ]}
              />
              ) : null}
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
            <DataTable<TaxPaymentRow>
              rowKey="id"
              rows={props.payments}
              locale={{
                emptyText: (
                  <TableEmpty
                    title="No sales tax payments recorded"
                    description="Record what you pay a state when you file, and Net owed on the Liability tab comes down by it."
                    action={
                      props.canWrite ? (
                        <Button icon={<PlusOutlined />} onClick={() => setPayOpen(true)}>
                          Record payment
                        </Button>
                      ) : null
                    }
                  />
                ),
              }}
              pagination={clientTablePagination(
                paymentsPageSize,
                setPaymentsPageSize,
                pageSizeOptionsFor(TAX_PAYMENTS_DEFAULT_PAGE_SIZE),
              )}
              columns={[
                { title: "Number", dataIndex: "payment_number", width: SALES_TAX_PAYMENTS_FIXED_WIDTHS[0], render: (v) => v ?? "—" },
                { title: "Date", dataIndex: "payment_date", width: SALES_TAX_PAYMENTS_FIXED_WIDTHS[1], render: (v: string) => formatDate(v) },
                flexColumn<TaxPaymentRow>({
                  title: "Period",
                  key: "period",
                  floor: SALES_TAX_PERIOD_FLOOR,
                  render: (_, r) => (r.period_start && r.period_end ? `${formatDate(r.period_start)} → ${formatDate(r.period_end)}` : "—"),
                }),
                { title: "Amount", dataIndex: "amount_minor", width: SALES_TAX_PAYMENTS_FIXED_WIDTHS[2], align: "right", render: (v: number) => money(v) },
                { title: "Status", dataIndex: "status", width: SALES_TAX_PAYMENTS_FIXED_WIDTHS[3], render: (s: string) => <StatusTag status={s} /> },
                {
                  title: "Actions", key: "actions",
                  width: SALES_TAX_PAYMENTS_FIXED_WIDTHS[4],
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
              <FilterBar
                ariaLabel="Tax rates"
                actions={
                  props.isAdmin ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openTaxCode(null)}>New rate</Button>
                  ) : undefined
                }
              />
              <DataTable<TaxCodeRow>
                rowKey="id"
                rows={ratesByState}
                locale={{
                  emptyText: (
                    <TableEmpty
                      title="No sales tax rates yet"
                      description={
                        props.isAdmin
                          ? "Add each rate you charge, with its state, before you invoice a taxable sale."
                          : "An administrator adds the rates this company charges."
                      }
                      action={
                        props.isAdmin ? (
                          <Button icon={<PlusOutlined />} onClick={() => openTaxCode(null)}>
                            New rate
                          </Button>
                        ) : null
                      }
                    />
                  ),
                }}
                pagination={false}
                columns={[
                  {
                    title: "State",
                    dataIndex: "state_code",
                    width: SALES_TAX_RATES_FIXED_WIDTHS[0],
                    filters: stateFilters,
                    onFilter: (value, record) => (record.state_code ?? "") === value,
                    render: (v: string | null) => stateName(v, props.usStates),
                  },
                  { title: "Code", dataIndex: "code", width: SALES_TAX_RATES_FIXED_WIDTHS[1] },
                  flexColumn<TaxCodeRow>({ title: "Name", dataIndex: "name" }),
                  { title: "Rate", dataIndex: "rate_percent", width: SALES_TAX_RATES_FIXED_WIDTHS[2], align: "right", render: (v: number) => `${v}%` },
                  { title: "Direction", dataIndex: "direction", width: SALES_TAX_RATES_FIXED_WIDTHS[3] },
                  { title: "Status", dataIndex: "is_active", width: SALES_TAX_RATES_FIXED_WIDTHS[4], render: (v: boolean) => <StatusTag status={v ? "active" : "inactive"} /> },
                  {
                    title: "Actions", key: "actions",
                    width: SALES_TAX_RATES_FIXED_WIDTHS[5],
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
          <RecordTaxPaymentModal
            open={payOpen}
            onClose={() => setPayOpen(false)}
            onRecorded={() => reloadLiability(range)}
            taxPayableAccounts={props.taxPayableAccounts}
            bankAccounts={props.bankAccounts}
            baseCurrency={baseCurrency}
            decimals={decimalsOf(baseCurrency)}
          />

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
