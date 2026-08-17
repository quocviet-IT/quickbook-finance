"use client";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, BillPaymentRow, BillRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import { allocateAcrossBills } from "@/lib/domain/payables";
import { describeNoOpenBills } from "@/lib/domain/settlement";
import { openBillsForVendorAction, payBillsAction, voidBillPaymentAction } from "./actions";
import PayRunPanel from "@/components/payables/PayRunPanel";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const PAYMENTS_DEFAULT_PAGE_SIZE = 20;

export default function PayBillsClient({
  payments,
  vendors,
  paymentAccounts,
  currencies,
  canWrite,
}: {
  payments: (BillPaymentRow & { vendor_name: string })[];
  vendors: VendorRow[];
  paymentAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const currency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const [openBills, setOpenBills] = useState<BillRow[]>([]);
  /** Bills whose early payment discount is being taken, by bill id. */
  const [discounts, setDiscounts] = useState<Record<string, number>>({});
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // bill_id -> decimal amount
  const [paymentsPageSize, setPaymentsPageSize] = useState<number>(PAYMENTS_DEFAULT_PAGE_SIZE);

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function onVendorChange(vendorId: string) {
    setAlloc({});
    setDiscounts({});
    const res = await openBillsForVendorAction(vendorId);
    if (res.ok) setOpenBills(res.data ?? []);
    else message.error(res.error ?? "Failed to load open bills");
  }

  /**
   * What this bill still offers for paying early, today. Zero once the window
   * has closed or the discount has already been taken — the database enforces
   * the same rule, this only decides what to put on screen.
   */
  function discountOffered(bill: BillRow): number {
    const remaining = (bill.discount_amount_minor ?? 0) - (bill.discount_taken_minor ?? 0);
    if (remaining <= 0 || !bill.discount_due_date) return 0;
    const today = new Date().toISOString().slice(0, 10);
    if (today > bill.discount_due_date) return 0;
    return Math.min(remaining, bill.balance_due_minor);
  }

  const allocTotalMinor = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + Math.round((v ?? 0) * 10 ** decimals), 0),
    [alloc, decimals],
  );

  const selectedVendorId: string | undefined = Form.useWatch("vendor_id", form);
  const selectedVendorName = vendors.find((v) => v.id === selectedVendorId)?.name ?? null;

  /**
   * Spread the payment amount across the open bills, oldest first. The rule is
   * in the domain so the awkward part — a discounted bill is all or nothing —
   * is written down and tested rather than living in this handler.
   */
  function autoApply() {
    const paymentMinor = Math.round((form.getFieldValue("amount") ?? 0) * 10 ** decimals);
    const planned = allocateAcrossBills(
      paymentMinor,
      openBills.map((b) => ({
        billId: b.id,
        balanceDueMinor: b.balance_due_minor,
        discountMinor: discounts[b.id] ?? 0,
      })),
    );
    setAlloc(
      Object.fromEntries(
        Object.entries(planned).map(([billId, minor]) => [billId, minor / 10 ** decimals]),
      ),
    );
  }

  async function submit() {
    const values = await form.validateFields();
    const allocations = openBills
      .map((b) => ({
        bill_id: b.id,
        amount_minor: Math.round((alloc[b.id] ?? 0) * 10 ** decimals),
        discount_minor: discounts[b.id] ?? 0,
      }))
      .filter((a) => a.amount_minor > 0);
    setSaving(true);
    const res = await payBillsAction({
      vendor_id: values.vendor_id,
      payment_date: values.payment_date ? values.payment_date.format("YYYY-MM-DD") : undefined,
      currency_code: currency,
      amount_minor: Math.round((values.amount ?? 0) * 10 ** decimals),
      payment_account_id: values.payment_account_id,
      method: values.method ?? null,
      reference: values.reference ?? null,
      allocations,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Payment recorded");
      setOpen(false);
      form.resetFields();
      setOpenBills([]);
      setAlloc({});
      setDiscounts({});
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill payment?",
      content: "This reverses the journal entry and restores the bill balances.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillPaymentAction(id);
        if (res.ok) message.success("Payment voided");
        else message.error(res.error ?? "Failed to void payment");
      },
    });
  }

  return (
    <>
      {/* What to pay, before how to pay it. */}
      <PayRunPanel
        baseDecimals={decimals}
        onPayVendor={
          canWrite
            ? (vendorId) => {
                form.setFieldValue("vendor_id", vendorId);
                void onVendorChange(vendorId);
                setOpen(true);
              }
            : undefined
        }
      />

      <Space style={{ marginTop: 24, marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Pay bills
          </Button>
        )}
      </Space>
      <Table<BillPaymentRow & { vendor_name: string }>
        rowKey="id"
        dataSource={payments}
        scroll={{ x: "max-content" }}
        pagination={{
          // Explicit, unlike the rest of this sweep's default DataTable/Table
          // behaviour: this screen wants the size changer shown regardless of
          // row count, not only once the list passes Ant Design's own
          // 50-row threshold.
          ...clientTablePagination(paymentsPageSize, setPaymentsPageSize, pageSizeOptionsFor(PAYMENTS_DEFAULT_PAGE_SIZE)),
          showSizeChanger: true,
        }}
        columns={[
          { title: "Payment Number", dataIndex: "payment_number", render: (v) => v ?? "—" },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Date", dataIndex: "payment_date" },
          { title: "Amount", dataIndex: "amount_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Unapplied", dataIndex: "unapplied_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "blue"}>{s}</Tag> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite && r.status !== "void" ? (
                <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                  Void
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        title="Pay bills"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record payment"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                onChange={onVendorChange}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="payment_account_id"
              label="Pay from"
              rules={[{ required: true, message: "Select a payment account" }]}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                options={paymentAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
              />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                disabled
                value={currency}
                style={{ width: 120 }}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="payment_date" label="Date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="method" label="Method" style={{ width: 170 }}>
              <Select
                allowClear
                placeholder="Method"
                options={["ACH", "check", "wire", "bank_transfer", "card", "cash"].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="reference"
              label="Reference"
              style={{ width: 190 }}
              tooltip="Check number, wire reference or ACH trace"
            >
              <Input placeholder="Check / wire ref" maxLength={80} />
            </Form.Item>
          </Space>
          <Form.Item name="amount" label="Payment amount" rules={[{ required: true, message: "Enter an amount" }]}>
            <InputNumber min={0} precision={decimals} style={{ width: 200 }} />
          </Form.Item>

          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <Typography.Text strong>Open bills</Typography.Text>
            <Button size="small" onClick={autoApply} disabled={!openBills.length}>
              Auto apply
            </Button>
          </Space>
          <Table<BillRow>
            rowKey="id"
            dataSource={openBills}
            locale={{ emptyText: describeNoOpenBills(selectedVendorId ? (selectedVendorName ?? "This vendor") : null) }}
            size="small"
            pagination={false}
            scroll={{ x: "max-content" }}
            style={{ marginTop: 8 }}
            columns={[
              { title: "Bill Number", dataIndex: "bill_number", render: (v) => v ?? "—" },
              { title: "Date", dataIndex: "bill_date" },
              { title: "Balance", dataIndex: "balance_due_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
              {
                title: "Discount",
                key: "discount",
                render: (_, r) => {
                  const available = discountOffered(r);
                  if (available <= 0) return <Typography.Text type="secondary">—</Typography.Text>;
                  const taking = (discounts[r.id] ?? 0) > 0;
                  return (
                    <Checkbox
                      checked={taking}
                      onChange={(e) => {
                        // Taking it settles the bill in full for less cash, so
                        // the allocation is the balance less the discount.
                        const next = e.target.checked ? available : 0;
                        setDiscounts((prev) => ({ ...prev, [r.id]: next }));
                        setAlloc((prev) => ({
                          ...prev,
                          [r.id]: (r.balance_due_minor - next) / 10 ** decimals,
                        }));
                      }}
                    >
                      {fmt(available, r.currency_code)} by {r.discount_due_date}
                    </Checkbox>
                  );
                },
              },
              {
                title: "Payment",
                key: "pay",
                render: (_, r) => (
                  <InputNumber
                    min={0}
                    max={r.balance_due_minor / 10 ** decimals}
                    precision={decimals}
                    value={alloc[r.id]}
                    onChange={(v) => setAlloc((prev) => ({ ...prev, [r.id]: Number(v ?? 0) }))}
                  />
                ),
              },
            ]}
          />
          <Typography.Paragraph style={{ marginTop: 8 }}>
            Allocated: {(allocTotalMinor / 10 ** decimals).toFixed(decimals)} {currency}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
