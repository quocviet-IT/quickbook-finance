"use client";
import { useState } from "react";
import { App, Button, Col, Form, Input, Modal, Row, Tag, type TableColumnsType } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import type { CustomerRow } from "@/lib/db/types";
import { formatPostalAddress } from "@/lib/domain/invoice-document";
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

export default function CustomersClient({
  customers,
  canWrite,
}: {
  customers: CustomerRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
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
    form.setFieldsValue(
      Object.fromEntries(CONTACT_FIELDS.map((field) => [field, customer[field] ?? ""])),
    );
    setOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = editing
      ? await updateCustomerAction({ ...values, id: editing.id })
      : await createCustomerAction(values);
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
                <Input />
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
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
