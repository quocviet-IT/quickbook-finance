"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Tag,
} from "antd";
import type { CustomerRow } from "@/lib/db/types";
import { toMinorUnits } from "@/lib/format";
import { createCustomerAction, updateCustomerAction } from "./actions";
import { closeOrConfirmDiscard } from "@/lib/client/destructive-confirm";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { validateOrFocus } from "@/lib/client/validate-or-focus";
import { customerSavedMessage } from "@/lib/domain/sales-form";

const CONTACT_FIELDS = [
  "name",
  "email",
  "contact_name",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "region",
  "postal_code",
  "country",
] as const;

/**
 * The create / edit customer form, shared by the Customers list and the
 * customer page. `customer === null` means a new customer.
 */
export default function CustomerFormModal({
  open,
  customer,
  usStates,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerRow | null;
  usStates: { code: string; name: string }[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // Set by the reader's edits, not by the record the form opens with.
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(open && dirty, modal, "this customer");
  /** Why the last save failed, shown in the form until the next attempt (3.0.10). */
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the record (or a blank form) each time the form opens or is pointed
  // at another customer.
  useEffect(() => {
    if (!open) return;
    if (customer) {
      form.setFieldsValue({
        ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field, customer[field] ?? ""])),
        // The form works in dollars; the record and the ledger work in cents.
        credit_limit:
          customer.credit_limit_minor === null ? undefined : customer.credit_limit_minor / 100,
        credit_terms_days: customer.credit_terms_days ?? undefined,
        credit_hold: customer.credit_hold,
        credit_review_note: customer.credit_review_note ?? "",
      });
    } else {
      form.resetFields();
    }
  }, [open, customer, form]);

  function finishForm() {
    // Left clean, so the next opening starts without a stale warning or error.
    setDirty(false);
    setSaveError(null);
    onClose();
  }

  /** Escape, the close button and Cancel: asks first once something has been typed. */
  function closeForm() {
    closeOrConfirmDiscard({
      dirty,
      what: customer ? `the changes to ${customer.name}` : "this customer",
      confirm: modal.confirm,
      close: finishForm,
    });
  }

  async function submit() {
    // On a wrong or missing field: focus goes to the first one, nothing is sent.
    const values = await validateOrFocus(form);
    if (!values) return;
    // An empty limit box means "no limit", which is not the same as a limit of
    // zero — that one means cash only, and both have to reach the server intact.
    const { credit_limit: creditLimit, ...rest } = values;
    const payload = {
      ...rest,
      credit_limit_minor:
        creditLimit === undefined || creditLimit === null
          ? null
          : toMinorUnits(Number(creditLimit), 2),
      credit_terms_days:
        values.credit_terms_days === undefined || values.credit_terms_days === null
          ? null
          : Number(values.credit_terms_days),
      credit_hold: Boolean(values.credit_hold),
    };
    setSaving(true);
    setSaveError(null);
    const res = customer
      ? await updateCustomerAction({ ...payload, id: customer.id })
      : await createCustomerAction(payload);
    setSaving(false);
    if (res.ok) {
      message.success(customerSavedMessage(String(values.name), customer ? "updated" : "created"));
      finishForm();
      form.resetFields();
      onSaved?.();
      // Whichever page shows the customer reads it again.
      router.refresh();
    } else {
      // In the form, where it stays until the next save: a toast disappeared
      // before it could be read (3.0.10).
      setSaveError(res.error ?? "Failed to save the customer");
    }
  }

  return (
    <Modal
      title={customer ? `Edit ${customer.name}` : "New customer"}
      open={open}
      onOk={submit}
      onCancel={closeForm}
      // A click beside the form is too easy to make to cost what was typed.
      maskClosable={false}
      confirmLoading={saving}
      okText="Save"
      cancelText="Cancel"
      width={640}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="Name"
              rules={[{ required: true, message: "Enter a name" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="email" label="Email">
              <Input type="email" autoComplete="email" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contact_name" label="Contact person">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="phone" label="Phone">
              <Input type="tel" autoComplete="tel" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="address_line1" label="Address line 1">
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="address_line2" label="Address line 2">
              <Input />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item name="city" label="City">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="region" label="State">
              {/* The two-letter code, because that is what an American
                  invoice prints and what a sales tax rate is filed under. */}
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="State"
                options={usStates.map((state) => ({
                  value: state.code,
                  label: `${state.code} — ${state.name}`,
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="postal_code" label="ZIP code">
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="country" label="Country">
              <Input />
            </Form.Item>
          </Col>

          <Col span={24}>
            <Tag color="blue" style={{ marginBottom: 12 }}>
              Credit control
            </Tag>
          </Col>
          <Col span={8}>
            <Form.Item
              name="credit_limit"
              label="Credit limit"
              extra="Empty = no limit. 0 = cash only."
            >
              <InputNumber min={0} step={100} precision={2} prefix="$" style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="credit_terms_days"
              label="Terms (days)"
              extra="Empty = company default."
            >
              <InputNumber min={0} max={365} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="credit_hold"
              label="Credit hold"
              valuePropName="checked"
              extra="Blocks issuing any invoice."
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="credit_review_note" label="Credit review note">
              <Input.TextArea
                rows={2}
                placeholder="Why this limit, and when it was last reviewed"
              />
            </Form.Item>
          </Col>
        </Row>
        {saveError ? <Alert type="error" showIcon role="alert" title={saveError} /> : null}
      </Form>
    </Modal>
  );
}
