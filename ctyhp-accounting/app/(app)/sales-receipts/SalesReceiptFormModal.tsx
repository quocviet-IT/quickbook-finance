"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Space } from "antd";
import SalesLineItems from "@/components/SalesLineItems";
import NewCustomerButton from "@/components/NewCustomerButton";
import { ToneBadge } from "@/lib/design/tone";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE, USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  estimateLineToFormLine,
  formLineToLineInput,
  formLinesTotals,
  type DocumentFormLine,
} from "@/lib/domain/estimates";
import {
  SALES_RECEIPT_METHODS,
  SALES_RECEIPT_METHOD_LABEL,
  type SalesReceiptLineRow,
  type SalesReceiptMethod,
  type SalesReceiptRow,
} from "@/lib/domain/sales-receipts";
import { defaultTaxCodeForState, groupTaxCodesByState, taxCodeLabel } from "@/lib/domain/tax-jurisdiction";
import { formatDate, formatMoney } from "@/lib/format";
import { createSalesReceiptAction } from "./actions";
import { SALES_RECEIPT_STATUS_TONES } from "./sales-receipt-columns";
import styles from "./sales-receipts.module.css";

/** A saved receipt, with its lines, as the dialog shows it. */
export interface SalesReceiptDetailView {
  receipt: SalesReceiptRow;
  lines: SalesReceiptLineRow[];
}

interface Props {
  open: boolean;
  /** The receipt being viewed; null for a new one. */
  detail: SalesReceiptDetailView | null;
  /** The company's today, from the server: the date a new receipt starts on. */
  today: string;
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  defaultDepositAccountId: string | null;
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  items: ItemRow[];
  canWrite: boolean;
  canManageItems: boolean;
  onClose: () => void;
  /** Hands a posted receipt back to the list, which asks for the reason. */
  onVoid: (receipt: SalesReceiptRow) => void;
}

interface FormValues {
  customer_id?: string;
  receipt_date?: Dayjs;
  deposit_account_id?: string;
  payment_method?: SalesReceiptMethod | null;
  reference?: string;
  memo?: string;
  lines?: DocumentFormLine[];
}

const ISO = "YYYY-MM-DD";

/**
 * New sales receipt, or a read-only view of a saved one. A saved receipt is
 * already in the books, so it is not edited: a mistake is voided with a reason
 * and the sale entered again, as an issued invoice is.
 *
 * The body mounts only while the dialog is open, so the form starts from the
 * receipt being viewed without an effect, as the estimate form does.
 */
export default function SalesReceiptFormModal(props: Props) {
  if (!props.open) return null;
  return <SalesReceiptFormBody {...props} />;
}

function SalesReceiptFormBody({
  detail,
  today,
  customers,
  depositAccounts,
  defaultDepositAccountId,
  incomeAccounts,
  taxCodes,
  usStates,
  items,
  canWrite,
  canManageItems,
  onClose,
  onVoid,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receipt = detail?.receipt ?? null;
  const readOnly = receipt !== null || !canWrite;
  const noDepositAccount = receipt === null && depositAccounts.length === 0;

  // A customer added from inside this dialog has to be pickable now; the
  // page's own list catches up when the receipt is saved.
  const [addedCustomers, setAddedCustomers] = useState<{ id: string; name: string }[]>([]);
  const customerOptions = useMemo(() => {
    const listed = customers
      // The database takes only an active customer, but a receipt already
      // written to one since made inactive must still show its name.
      .filter((c) => c.is_active || c.id === receipt?.customer_id)
      .map((c) => ({ value: c.id, label: c.name }));
    const added = addedCustomers
      .filter((c) => !listed.some((option) => option.value === c.id))
      .map((c) => ({ value: c.id, label: c.name }));
    return [...listed, ...added].sort((a, b) => a.label.localeCompare(b.label));
  }, [customers, addedCustomers, receipt?.customer_id]);

  const depositOptions = useMemo(() => {
    const options = depositAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }));
    // A receipt deposited to an account since closed still names it.
    if (receipt && !options.some((o) => o.value === receipt.deposit_account_id)) {
      options.push({ value: receipt.deposit_account_id, label: receipt.deposit_account_label });
    }
    return options;
  }, [depositAccounts, receipt]);

  const taxOptions = useMemo(
    () =>
      groupTaxCodesByState(taxCodes, usStates).map((group) => ({
        label: group.stateName,
        title: group.stateName,
        options: group.codes.map((code) => ({ value: code.id, label: taxCodeLabel(code) })),
      })),
    [taxCodes, usStates],
  );

  const initialValues = useMemo<FormValues>(() => {
    if (!detail) {
      return {
        receipt_date: dayjs(today),
        deposit_account_id: defaultDepositAccountId ?? undefined,
        lines: [{ quantity: 1 }],
      };
    }
    return {
      customer_id: detail.receipt.customer_id,
      receipt_date: dayjs(detail.receipt.receipt_date),
      deposit_account_id: detail.receipt.deposit_account_id,
      payment_method: detail.receipt.payment_method,
      reference: detail.receipt.reference ?? undefined,
      memo: detail.receipt.memo ?? undefined,
      lines: detail.lines.map(estimateLineToFormLine),
    };
    // Computed once at mount; the dialog remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchedLines: DocumentFormLine[] = Form.useWatch("lines", form) ?? [];
  const taxRateOf = (id: string | null | undefined) =>
    id ? Number(taxCodes.find((t) => t.id === id)?.rate_percent ?? 0) : 0;
  const totals = receipt
    ? { subtotalMinor: receipt.subtotal_minor, taxTotalMinor: receipt.tax_minor, totalMinor: receipt.total_minor }
    : formLinesTotals(watchedLines, taxRateOf);
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, USD_DECIMAL_PLACES);

  /**
   * As on the New invoice form: the customer's state rate goes on every line
   * that has no rate yet, never over one somebody chose, and only where the
   * company has exactly one rate in that state.
   */
  function onCustomerChange(customerId: string) {
    const customer = customers.find((c) => c.id === customerId);
    const rate = defaultTaxCodeForState(customer?.region, taxCodes);
    if (!rate) return;
    const lines: DocumentFormLine[] = form.getFieldValue("lines") ?? [];
    let filled = 0;
    lines.forEach((line, index) => {
      if (line?.tax_code_id) return;
      form.setFields([{ name: ["lines", index, "tax_code_id"], value: rate.id }]);
      filled += 1;
    });
    if (filled > 0) message.info(`Applied ${taxCodeLabel(rate)} for ${customer?.region}`);
  }

  function addCustomer(customer: { id: string; name: string }) {
    setAddedCustomers((prev) => [...prev, customer]);
    form.setFieldValue("customer_id", customer.id);
  }

  async function submit() {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    setError(null);
    const res = await createSalesReceiptAction({
      customer_id: values.customer_id,
      receipt_date: values.receipt_date?.format(ISO),
      deposit_account_id: values.deposit_account_id,
      payment_method: values.payment_method ?? null,
      reference: values.reference?.trim() || null,
      memo: values.memo?.trim() || null,
      lines: (values.lines ?? []).map(formLineToLineInput),
    });
    setSaving(false);
    if (!res.ok || !res.data) {
      // The server's words, in the form, where the thing to fix is.
      setError(res.error ?? "Failed to save the sales receipt");
      return;
    }
    message.success(`${res.data.receipt_number} saved and posted: ${money(res.data.total_minor)}.`);
    onClose();
  }

  const title = receipt ? (
    <span className={styles.formTitle}>
      <span>{`Sales receipt ${receipt.receipt_number}`}</span>
      <span className={styles.formTitleState}>
        <ToneBadge tone={SALES_RECEIPT_STATUS_TONES[receipt.status].tone}>
          {SALES_RECEIPT_STATUS_TONES[receipt.status].label}
        </ToneBadge>
      </span>
    </span>
  ) : (
    "New sales receipt"
  );

  const footer = [
    <Button key="close" onClick={onClose}>
      {readOnly ? "Close" : "Cancel"}
    </Button>,
  ];
  if (receipt && canWrite && receipt.status === "posted") {
    footer.push(
      <Button key="void" danger onClick={() => onVoid(receipt)}>
        Void
      </Button>,
    );
  }
  if (!readOnly) {
    footer.push(
      <Button key="save" type="primary" loading={saving} disabled={noDepositAccount} onClick={submit}>
        Save and post
      </Button>,
    );
  }

  return (
    <Modal title={title} open onCancel={onClose} footer={footer} width={860}>
      {receipt?.status === "void" ? (
        <Alert
          className={styles.notice}
          type="warning"
          showIcon
          title={`Voided${receipt.voided_at ? ` on ${formatDate(receipt.voided_at.slice(0, 10))}` : ""}`}
          description={receipt.void_reason ?? undefined}
        />
      ) : null}
      {receipt?.status === "posted" ? (
        <Alert
          className={styles.notice}
          type="info"
          showIcon
          title="This receipt is in the books, so it cannot be changed."
          description="To correct it, void it with a reason and enter the sale again."
        />
      ) : null}
      {noDepositAccount ? (
        <Alert
          className={styles.notice}
          type="warning"
          showIcon
          title="There is no account to deposit the money to yet."
          description={
            <>
              Add the bank account the money goes to in <Link href="/banking">Banking</Link> first.
            </>
          }
        />
      ) : null}

      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={readOnly}
        initialValues={initialValues}
      >
        {/* A block row, so the deposit row below starts on its own line. */}
        <Space align="end" wrap style={{ display: "flex" }}>
          <Form.Item
            name="customer_id"
            label="Customer"
            rules={[{ required: true, message: "Select a customer" }]}
            style={{ minWidth: 280 }}
            tooltip="Who bought. For walk-in sales, add one customer such as Cash Customer and use it for all of them."
          >
            <Select
              showSearch
              filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              placeholder="Select a customer"
              options={customerOptions}
              onChange={onCustomerChange}
            />
          </Form.Item>
          <Form.Item label=" ">
            <NewCustomerButton onCreated={addCustomer} disabled={readOnly} />
          </Form.Item>
          <Form.Item
            name="receipt_date"
            label="Receipt date"
            rules={[{ required: true, message: "Choose the receipt date." }]}
          >
            <DatePicker allowClear={false} />
          </Form.Item>
        </Space>

        <Space align="end" wrap style={{ display: "flex" }}>
          <Form.Item
            name="deposit_account_id"
            label="Deposit to"
            rules={[{ required: true, message: "Choose where the money was deposited" }]}
            style={{ minWidth: 280 }}
            tooltip="The bank account the money goes into, so the deposit the bank shows is matched to this receipt. Choose 1210 Undeposited Funds only for money that will be banked together with other takings later."
          >
            <Select placeholder="Bank / cash account" options={depositOptions} />
          </Form.Item>
          <Form.Item name="payment_method" label="Payment method" style={{ width: 180 }}>
            <Select
              allowClear
              placeholder="Method"
              options={SALES_RECEIPT_METHODS.map((m) => ({ value: m, label: SALES_RECEIPT_METHOD_LABEL[m] }))}
            />
          </Form.Item>
          <Form.Item
            name="reference"
            label="Reference"
            style={{ width: 200 }}
            tooltip="Check number, card slip or transfer reference: what the bank statement will show"
          >
            <Input placeholder="Check no. / ref" maxLength={80} />
          </Form.Item>
        </Space>

        <SalesLineItems
          items={items}
          incomeAccounts={incomeAccounts}
          taxOptions={taxOptions}
          decimals={USD_DECIMAL_PLACES}
          canManageItems={canManageItems}
          removeLabel="Remove sales receipt line"
        />

        <Form.Item name="memo" label="Note printed on the receipt" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>

        <div className={styles.totals} aria-live="polite">
          <div>Subtotal: {money(totals.subtotalMinor)}</div>
          <div>Sales tax: {money(totals.taxTotalMinor)}</div>
          <div>
            <strong>
              {receipt?.status === "void" ? "Total (void)" : "Total paid"}: {money(totals.totalMinor)}
            </strong>
          </div>
        </div>

        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} /> : null}
      </Form>
    </Modal>
  );
}
