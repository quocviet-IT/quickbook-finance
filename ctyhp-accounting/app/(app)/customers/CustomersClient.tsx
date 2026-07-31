"use client";
import { useState } from "react";
import {
  App,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Tag,
  Tooltip,
  type TableColumnsType,
} from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import type { CustomerRow } from "@/lib/db/types";
import type { CustomerCreditRow } from "@/lib/services/credit";
import { formatPostalAddress } from "@/lib/domain/invoice-document";
import { creditStateColor } from "@/lib/domain/credit";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { createCustomerAction, updateCustomerAction } from "./actions";

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

const money = (minor: number) => formatMoney(minor, "USD", 2);

export default function CustomersClient({
  customers,
  credit,
  usStates,
  canWrite,
}: {
  customers: CustomerRow[];
  /** Exposure per customer, read from the open invoices on every request. */
  credit: CustomerCreditRow[];
  usStates: { code: string; name: string }[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const creditByCustomer = new Map(credit.map((row) => [row.customerId, row]));
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditing(customer);
    form.setFieldsValue({
      ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field, customer[field] ?? ""])),
      // The form works in dollars; the record and the ledger work in cents.
      credit_limit:
        customer.credit_limit_minor === null ? undefined : customer.credit_limit_minor / 100,
      credit_terms_days: customer.credit_terms_days ?? undefined,
      credit_hold: customer.credit_hold,
      credit_review_note: customer.credit_review_note ?? "",
    });
    setOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
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
    const res = editing
      ? await updateCustomerAction({ ...payload, id: editing.id })
      : await createCustomerAction(payload);
    setSaving(false);
    if (res.ok) {
      message.success(editing ? "Customer updated" : "Customer created");
      setOpen(false);
      setEditing(null);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to save the customer");
    }
  }

  const columns: TableColumnsType<CustomerRow> = [
    { title: "Name", dataIndex: "name" },
    { title: "Email", dataIndex: "email", render: (e) => e ?? "—" },
    {
      title: "Billing address",
      render: (_, row) => {
        const lines = formatPostalAddress(row);
        // An invoice for a customer without an address prints without a
        // "Bill to" block, so the gap is worth showing here.
        return lines.length ? lines.join(" · ") : <Tag color="orange">Not set</Tag>;
      },
    },
    {
      title: "Credit limit",
      key: "credit_limit",
      width: 120,
      align: "right",
      render: (_, row) =>
        row.credit_limit_minor === null ? (
          <Tooltip title="No limit is enforced for this customer">
            <span className="accounting-muted">Not set</span>
          </Tooltip>
        ) : (
          money(row.credit_limit_minor)
        ),
    },
    {
      title: "Owed now",
      key: "balance",
      width: 120,
      align: "right",
      render: (_, row) => money(creditByCustomer.get(row.id)?.openBalanceMinor ?? 0),
    },
    {
      title: "Available",
      key: "available",
      width: 120,
      align: "right",
      render: (_, row) => {
        const available = creditByCustomer.get(row.id)?.status.availableMinor ?? null;
        if (available === null) return "\u2014";
        return (
          <span className={available < 0 ? "accounting-negative" : undefined}>
            {money(available)}
          </span>
        );
      },
    },
    {
      title: "Credit status",
      key: "credit_status",
      width: 160,
      render: (_, row) => {
        const status = creditByCustomer.get(row.id)?.status;
        if (!status) return "\u2014";
        const tag = <Tag color={creditStateColor(status.state)}>{status.label}</Tag>;
        return status.reasons.length ? (
          <Tooltip title={status.reasons.join(". ")}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    {
      title: "Status",
      dataIndex: "is_active",
      width: 100,
      render: (a: boolean) => <Tag color={a ? "green" : "default"}>{a ? "Active" : "Inactive"}</Tag>,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            width: 80,
            render: (_: unknown, row: CustomerRow) => (
              <IconActionButton
                icon={<EditOutlined />}
                label="Edit contact details"
                onClick={() => openEdit(row)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        resultCount={customers.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New customer
            </Button>
          ) : null
        }
      />
      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={customers}
        sticky
        emptyTitle="No customers yet"
        emptyDescription="Add a customer to create invoices and receive payments."
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : "New customer"}
        open={open}
        onOk={submit}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        confirmLoading={saving}
        okText="Save"
        cancelText="Cancel"
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
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
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact_name" label="Contact person">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone">
                <Input />
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
        </Form>
      </Modal>
    </div>
  );
}
