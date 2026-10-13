"use client";
import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Space } from "antd";
import SalesLineItems from "@/components/SalesLineItems";
import NewCustomerButton from "@/components/NewCustomerButton";
import { ToneBadge } from "@/lib/design/tone";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE, USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  ESTIMATE_STATE_LABELS,
  defaultExpiryDate,
  estimateActions,
  estimateLineToFormLine,
  estimateMessages,
  estimateState,
  formLineToLineInput,
  formLinesTotals,
  type DocumentFormLine,
} from "@/lib/domain/estimates";
import {
  defaultTaxCodeForState,
  groupTaxCodesByState,
  taxCodeLabel,
} from "@/lib/domain/tax-jurisdiction";
import { formatMoney } from "@/lib/format";
import { saveEstimateAction, type EstimateDetailView } from "./actions";
import { ESTIMATE_STATE_TONES } from "./estimate-columns";
import styles from "./estimates.module.css";

/** What "Turn into an invoice" hands back to the list, which asks first when it has expired. */
export interface ConversionTarget {
  id: string;
  estimate_number: string;
  expiry_date: string;
  expired: boolean;
}

interface Props {
  open: boolean;
  /** The estimate being edited or viewed; null for a new one. */
  detail: EstimateDetailView | null;
  /** The company's today, from the server: the default estimate date and the day "expired" is judged on. */
  today: string;
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  items: ItemRow[];
  canWrite: boolean;
  canManageItems: boolean;
  onClose: () => void;
  onConvert: (target: ConversionTarget) => void;
}

interface FormValues {
  customer_id?: string;
  estimate_date?: Dayjs;
  expiry_date?: Dayjs | null;
  memo?: string;
  lines?: DocumentFormLine[];
}

const ISO = "YYYY-MM-DD";

/**
 * New estimate, Edit estimate, or a read-only view of one that can no longer
 * change (Converted) or of any estimate to someone who cannot write.
 *
 * The body mounts only while the dialog is open, so the form starts from the
 * estimate being edited without an effect, as the purchase order form does.
 */
export default function EstimateFormModal(props: Props) {
  if (!props.open) return null;
  return <EstimateFormBody {...props} />;
}

function EstimateFormBody({
  detail,
  today,
  customers,
  incomeAccounts,
  taxCodes,
  usStates,
  items,
  canWrite,
  canManageItems,
  onClose,
  onConvert,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = detail?.estimate ?? null;
  const actions = detail ? estimateActions(detail.state, canWrite) : null;
  const readOnly = detail ? !actions!.edit : !canWrite;

  // A customer added from inside this dialog has to be pickable now; the
  // page's own list catches up when the estimate is saved.
  const [addedCustomers, setAddedCustomers] = useState<{ id: string; name: string }[]>([]);
  const customerOptions = useMemo(() => {
    const listed = customers
      // The database takes only an active customer, but an estimate already
      // written to one since made inactive must still show its name.
      .filter((c) => c.is_active || c.id === estimate?.customer_id)
      .map((c) => ({ value: c.id, label: c.name }));
    const added = addedCustomers
      .filter((c) => !listed.some((option) => option.value === c.id))
      .map((c) => ({ value: c.id, label: c.name }));
    return [...listed, ...added].sort((a, b) => a.label.localeCompare(b.label));
  }, [customers, addedCustomers, estimate?.customer_id]);

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
        estimate_date: dayjs(today),
        expiry_date: dayjs(defaultExpiryDate(today)),
        lines: [{ quantity: 1 }],
      };
    }
    return {
      customer_id: detail.estimate.customer_id,
      estimate_date: dayjs(detail.estimate.estimate_date),
      expiry_date: dayjs(detail.estimate.expiry_date),
      memo: detail.estimate.memo ?? undefined,
      lines: detail.lines.map(estimateLineToFormLine),
    };
    // Computed once at mount; the dialog remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Valid until" follows the estimate date, 30 days on, until somebody sets
  // it by hand. An estimate saved with its own date keeps it.
  const [expiryFollowsDate, setExpiryFollowsDate] = useState(
    () => !detail || detail.estimate.expiry_date === defaultExpiryDate(detail.estimate.estimate_date),
  );

  const watchedLines: DocumentFormLine[] = Form.useWatch("lines", form) ?? [];
  const taxRateOf = (id: string | null | undefined) =>
    id ? Number(taxCodes.find((t) => t.id === id)?.rate_percent ?? 0) : 0;
  const totals = formLinesTotals(watchedLines, taxRateOf);
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, USD_DECIMAL_PLACES);

  function onEstimateDateChange(value: Dayjs | null) {
    if (!value || !expiryFollowsDate) return;
    form.setFieldValue("expiry_date", dayjs(defaultExpiryDate(value.format(ISO))));
  }

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

  /** Saves the form; the number is assigned on the first save. Null when it did not save. */
  async function save(): Promise<{ id: string; estimate_number: string; expiry_date: string } | null> {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return null;
    }
    const expiry = values.expiry_date ? values.expiry_date.format(ISO) : null;
    setSaving(true);
    setError(null);
    const res = await saveEstimateAction(estimate?.id ?? null, {
      customer_id: values.customer_id,
      currency_code: USD_CURRENCY_CODE,
      estimate_date: values.estimate_date?.format(ISO),
      expiry_date: expiry,
      memo: values.memo?.trim() || null,
      lines: (values.lines ?? []).map(formLineToLineInput),
    });
    setSaving(false);
    if (!res.ok || !res.data) {
      // The server's words, in the form, where the thing to fix is.
      setError(res.error ?? "Failed to save the estimate");
      return null;
    }
    const estimateDate = values.estimate_date?.format(ISO) ?? today;
    return {
      id: res.data.id,
      estimate_number: res.data.estimate_number,
      expiry_date: expiry ?? defaultExpiryDate(estimateDate),
    };
  }

  async function submit() {
    const saved = await save();
    if (!saved) return;
    message.success(`${saved.estimate_number} saved.`);
    onClose();
  }

  /**
   * Unsaved changes are saved first, so the invoice is made from what is on
   * the screen rather than from what was stored before.
   */
  async function turnIntoInvoice() {
    if (!estimate) return;
    let target = { id: estimate.id, estimate_number: estimate.estimate_number, expiry_date: estimate.expiry_date };
    if (form.isFieldsTouched()) {
      const saved = await save();
      if (!saved) return;
      message.success(`${saved.estimate_number} saved.`);
      target = saved;
    }
    const state = estimateState({ declinedAt: null, expiryDate: target.expiry_date, hasLiveInvoice: false }, today);
    onConvert({ ...target, expired: state === "expired" });
  }

  const title = estimate ? (
    <span className={styles.formTitle}>
      <span>{readOnly ? `Estimate ${estimate.estimate_number}` : `Edit estimate ${estimate.estimate_number}`}</span>
      <span className={styles.formTitleState}>
        <ToneBadge tone={ESTIMATE_STATE_TONES[detail!.state].tone}>{ESTIMATE_STATE_LABELS[detail!.state]}</ToneBadge>
      </span>
    </span>
  ) : (
    "New estimate"
  );

  const footer = [
    <Button key="close" onClick={onClose}>
      {readOnly ? "Close" : "Cancel"}
    </Button>,
  ];
  if (estimate && actions?.convert) {
    footer.push(
      <Button key="convert" onClick={turnIntoInvoice} disabled={saving}>
        Turn into an invoice
      </Button>,
    );
  }
  if (!readOnly) {
    footer.push(
      <Button key="save" type="primary" loading={saving} onClick={submit}>
        Save
      </Button>,
    );
  }

  return (
    <Modal title={title} open onCancel={onClose} footer={footer} width={860}>
      {estimate?.live_invoice ? (
        <Alert
          className={styles.notice}
          type="info"
          showIcon
          title={estimateMessages.alreadyConverted(estimate.estimate_number, estimate.live_invoice.invoice_number)}
        />
      ) : null}

      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={readOnly}
        initialValues={initialValues}
      >
        {/* A block row, so "Line items" below starts on its own line. */}
        <Space align="end" wrap style={{ display: "flex" }}>
          <Form.Item
            name="customer_id"
            label="Customer"
            rules={[{ required: true, message: "Select a customer" }]}
            style={{ minWidth: 280 }}
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
            name="estimate_date"
            label="Estimate date"
            rules={[{ required: true, message: "Choose the estimate date." }]}
          >
            <DatePicker allowClear={false} onChange={onEstimateDateChange} />
          </Form.Item>
          <Form.Item
            name="expiry_date"
            label="Valid until"
            dependencies={["estimate_date"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value: Dayjs | null | undefined) {
                  const date: Dayjs | undefined = getFieldValue("estimate_date");
                  if (!value || !date || !value.isBefore(date, "day")) return Promise.resolve();
                  return Promise.reject(new Error("Valid until cannot be before the estimate date."));
                },
              }),
            ]}
          >
            <DatePicker allowClear={false} onChange={() => setExpiryFollowsDate(false)} />
          </Form.Item>
        </Space>

        <SalesLineItems
          items={items}
          incomeAccounts={incomeAccounts}
          taxOptions={taxOptions}
          decimals={USD_DECIMAL_PLACES}
          canManageItems={canManageItems}
          removeLabel="Remove estimate line"
        />

        <Form.Item name="memo" label="Note printed at the foot" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>

        <div className={styles.totals} aria-live="polite">
          <div>Subtotal: {money(totals.subtotalMinor)}</div>
          <div>Sales tax: {money(totals.taxTotalMinor)}</div>
          <div>
            <strong>Total: {money(totals.totalMinor)}</strong>
          </div>
        </div>

        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} /> : null}
      </Form>
    </Modal>
  );
}
