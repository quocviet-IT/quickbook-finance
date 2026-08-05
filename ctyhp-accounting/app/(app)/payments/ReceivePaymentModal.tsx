"use client";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  App,
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { AccountRow, CurrencyRow, CustomerRow, InvoiceRow, PaymentRow } from "@/lib/db/types";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { describeNoOpenInvoices, unappliedRemainderMinor } from "@/lib/domain/settlement";
import { paymentReplacementDraft } from "@/lib/domain/payment-void";
import { getOpenInvoicesAction, recordPaymentAction } from "./actions";

export interface ReceivePaymentModalProps {
  open: boolean;
  /**
   * The void payment this receipt is replacing, if any. A void payment is never
   * revived; a replacement is an ordinary new receipt that starts from the old
   * one's facts and has its allocations chosen again.
   */
  replacement: (PaymentRow & { customer_name: string }) | null;
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  currencies: CurrencyRow[];
  onClose: () => void;
  onDone: () => void;
}

export default function ReceivePaymentModal({
  open,
  replacement,
  customers,
  depositAccounts,
  currencies,
  onClose,
  onDone,
}: ReceivePaymentModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<InvoiceRow[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // invoiceId -> major units

  const baseCurrency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const currency: string = Form.useWatch("currency_code", form) ?? baseCurrency;
  const amount: number = Form.useWatch("amount", form) ?? 0;

  async function loadOpenInvoices(customerId: string) {
    const res = await getOpenInvoicesAction(customerId);
    if (res.ok && res.data) setOpenInvoices(res.data);
    else {
      setOpenInvoices([]);
      message.error(res.error ?? "Failed to load open invoices");
    }
  }

  // The modal is mounted per session (see PaymentsClient's `key`), so the form
  // starts from these values and nothing has to be reset on the way in.
  const draft = replacement
    ? paymentReplacementDraft(replacement, decimalsOf(replacement.currency_code))
    : null;
  const initialValues = draft
    ? { ...draft, payment_date: dayjs(draft.payment_date) }
    : { currency_code: baseCurrency };

  // Prefilled, never pre-submitted: a replacement shows the same customer's open
  // invoices, and which of them it settles is chosen again on purpose.
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    void (async () => {
      const res = await getOpenInvoicesAction(draft.customer_id);
      if (cancelled) return;
      if (res.ok && res.data) setOpenInvoices(res.data);
      else message.error(res.error ?? "Failed to load open invoices");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.customer_id]);

  async function onCustomerChange(customerId: string) {
    setAlloc({});
    await loadOpenInvoices(customerId);
  }

  function autoApply() {
    let remaining = amount;
    const next: Record<string, number> = {};
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const dueMajor = inv.balance_due_minor / 10 ** decimalsOf(inv.currency_code);
      const take = Math.min(dueMajor, remaining);
      next[inv.id] = Number(take.toFixed(decimalsOf(inv.currency_code)));
      remaining -= take;
    }
    setAlloc(next);
  }

  const allocTotal = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);
  const selectedCustomerId: string | undefined = Form.useWatch("customer_id", form);
  const selectedCustomerName = customers.find((c) => c.id === selectedCustomerId)?.name ?? null;

  // "No open invoices" reads as a broken screen when it is really an empty
  // ledger. Say which of the two it is, and what recording anyway would do.
  const openInvoicesEmptyText = describeNoOpenInvoices(
    selectedCustomerId ? (selectedCustomerName ?? "This customer") : null,
  );

  // Compared in minor units, so a cent of float drift cannot invent a credit.
  const paymentDecimals = decimalsOf(currency);
  const unallocatedMinor = unappliedRemainderMinor(
    toMinorUnits(amount, paymentDecimals),
    toMinorUnits(allocTotal, paymentDecimals),
  );

  async function submit() {
    const v = await form.validateFields();
    const dec = decimalsOf(v.currency_code);
    const allocations = Object.entries(alloc)
      .filter(([, amt]) => (amt || 0) > 0)
      .map(([invoice_id, amt]) => ({ invoice_id, amount_minor: toMinorUnits(amt, dec) }));

    if (allocTotal > (v.amount ?? 0) + 1e-9) {
      message.error("Allocations exceed the payment amount");
      return;
    }

    setSaving(true);
    try {
      const res = await recordPaymentAction({
        customer_id: v.customer_id,
        payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
        currency_code: v.currency_code,
        amount_minor: toMinorUnits(Number(v.amount), dec),
        deposit_account_id: v.deposit_account_id,
        method: v.method ?? null,
        reference: v.reference ?? null,
        memo: v.memo ?? null,
        allocations,
      });
      if (!res.ok) {
        message.error(res.error ?? "Failed to record payment");
        return;
      }
      message.success(
        replacement
          ? "Replacement payment recorded and posted to the ledger"
          : "Payment recorded and posted to the ledger",
      );
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={replacement ? "Create replacement payment" : "Receive payment"}
      open={open}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Record payment"
      cancelText="Cancel"
      width={760}
      destroyOnHidden
    >
      {replacement ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Replacing ${replacement.payment_number ?? "a void payment"}`}
          description="The void payment and its number stay on record. This is a new receipt — check the amount and choose the invoices it settles."
        />
      ) : null}
      {/* Same defaults the New payment button applies, so the top-bar New menu
          can open this modal directly. */}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initialValues}>
        <Space wrap align="end">
          <Form.Item name="customer_id" label="Customer" rules={[{ required: true, message: "Select a customer" }]} style={{ minWidth: 280 }}>
            <Select
              showSearch
              filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
              placeholder="Select a customer"
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              onChange={onCustomerChange}
            />
          </Form.Item>
          <Form.Item name="currency_code" label="Currency" rules={[{ required: true }]} style={{ width: 120 }}>
            <Select disabled options={currencies.map((c) => ({ value: c.code, label: c.code }))} />
          </Form.Item>
          <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter amount" }]}>
            <InputNumber min={0} step={0.01} prefix="$" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="payment_date" label="Date">
            <DatePicker />
          </Form.Item>
        </Space>
        <Space wrap>
          <Form.Item
            name="deposit_account_id"
            label="Deposit to"
            rules={[{ required: true, message: "Select an account" }]}
            style={{ minWidth: 280 }}
            tooltip="Where the money landed. For a card or marketplace settlement — Stripe, Square, a storefront — choose 1210 Undeposited Funds: each receipt clears its invoice into that holding account, and the merchant's later payout is what reconciles against the bank, net of fees. Recording the receipt here is what closes the receivable; the merchant's own dashboard never does."
          >
            <Select
              placeholder="Bank / cash account"
              options={depositAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
            />
          </Form.Item>
          <Form.Item name="method" label="Method" style={{ width: 180 }}>
            <Select
              allowClear
              placeholder="Method"
              options={["cash", "bank_transfer", "card", "check"].map((m) => ({ value: m, label: m }))}
            />
          </Form.Item>
          <Form.Item
            name="reference"
            label="Reference"
            style={{ width: 200 }}
            tooltip="Check number, wire reference or ACH trace — what the bank statement will show"
          >
            <Input placeholder="Check / wire ref" maxLength={80} />
          </Form.Item>
        </Space>

        <Space style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Text strong>Apply to open invoices</Typography.Text>
          <Button size="small" onClick={autoApply} disabled={!openInvoices.length}>
            Auto apply
          </Button>
        </Space>
        <Table<InvoiceRow>
          rowKey="id"
          size="small"
          pagination={false}
          style={{ marginTop: 8 }}
          dataSource={openInvoices}
          locale={{ emptyText: openInvoicesEmptyText }}
          columns={[
            { title: "Invoice", dataIndex: "invoice_number", render: (n) => n ?? "—" },
            {
              title: "Balance due",
              dataIndex: "balance_due_minor",
              width: 140,
              align: "right",
              render: (v: number, r) => formatMoney(v, r.currency_code, decimalsOf(r.currency_code)),
            },
            {
              title: "Apply",
              key: "apply",
              width: 160,
              render: (_: unknown, r) => (
                <InputNumber
                  min={0}
                  step={0.01}
                  prefix="$"
                  style={{ width: 140 }}
                  value={alloc[r.id]}
                  max={r.balance_due_minor / 10 ** decimalsOf(r.currency_code)}
                  onChange={(val) => setAlloc((prev) => ({ ...prev, [r.id]: Number(val ?? 0) }))}
                />
              ),
            },
          ]}
        />

        <div style={{ textAlign: "right", marginTop: 8 }}>
          <Typography.Text type={allocTotal > amount + 1e-9 ? "danger" : "secondary"}>
            Allocated {formatMoney(toMinorUnits(allocTotal, decimalsOf(currency)), currency, decimalsOf(currency))} of{" "}
            {formatMoney(toMinorUnits(amount, decimalsOf(currency)), currency, decimalsOf(currency))}
          </Typography.Text>
          {unallocatedMinor !== null ? (
            <div style={{ marginTop: 2 }}>
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {formatMoney(unallocatedMinor, currency, paymentDecimals)} stays unapplied as a credit on{" "}
                {selectedCustomerName ? `${selectedCustomerName}'s` : "the customer's"} account — apply or refund it
                later.
              </Typography.Text>
            </div>
          ) : null}
        </div>

        <Form.Item name="memo" label="Memo" style={{ marginTop: 8 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
