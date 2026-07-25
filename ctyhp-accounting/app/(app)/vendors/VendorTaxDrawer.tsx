"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { Box1099Row, VendorRow, VendorTaxProfileRow } from "@/lib/db/types";
import { maskTin } from "@/lib/domain/vendorTax";
import { TAX_CLASSIFICATIONS, TIN_TYPES, W9_STATUSES } from "@/lib/domain/schemas";
import { listVendorTaxVersionsAction, saveVendorTaxProfileAction } from "./tax-actions";

const W9_COLOR: Record<string, string> = {
  not_requested: "default",
  requested: "gold",
  on_file: "green",
  expired: "red",
};

const label = (v: string) => v.replace(/_/g, " ");

interface Props {
  open: boolean;
  vendor: VendorRow | null;
  boxes: Box1099Row[];
  canManage: boolean;
  onClose: () => void;
}

/** Mounts only while open, so the form initializes from the current version. */
export default function VendorTaxDrawer(props: Props) {
  if (!props.open || !props.vendor) return null;
  return <VendorTaxDrawerBody {...props} vendor={props.vendor} />;
}

function VendorTaxDrawerBody({ vendor, boxes, canManage, onClose }: Props & { vendor: VendorRow }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [versions, setVersions] = useState<VendorTaxProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const eligible = Form.useWatch("is_1099_eligible", form) as boolean | undefined;
  const override = Form.useWatch("eligibility_override", form) as boolean | undefined;

  const current = versions[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    listVendorTaxVersionsAction(vendor.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) {
        setVersions(res.data);
        const c = res.data[0];
        if (c) {
          form.setFieldsValue({
            w9_status: c.w9_status,
            w9_received_date: c.w9_received_date ? dayjs(c.w9_received_date) : undefined,
            w9_expires_date: c.w9_expires_date ? dayjs(c.w9_expires_date) : undefined,
            classification: c.classification ?? undefined,
            reporting_name: c.reporting_name ?? undefined,
            tin_type: c.tin_type ?? undefined,
            address_line1: c.address_line1 ?? undefined,
            address_line2: c.address_line2 ?? undefined,
            city: c.city ?? undefined,
            region: c.region ?? undefined,
            postal_code: c.postal_code ?? undefined,
            country: c.country,
            is_1099_eligible: c.is_1099_eligible,
            box_code: c.box_code ?? undefined,
            eligibility_override: c.eligibility_override,
            override_reason: c.override_reason ?? undefined,
          });
        }
      } else {
        message.error(res.error ?? "Failed to load the tax profile");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vendor.id, form, message]);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await saveVendorTaxProfileAction(vendor.id, {
      w9_status: v.w9_status,
      w9_received_date: v.w9_received_date ? v.w9_received_date.format("YYYY-MM-DD") : null,
      w9_expires_date: v.w9_expires_date ? v.w9_expires_date.format("YYYY-MM-DD") : null,
      classification: v.classification ?? null,
      reporting_name: v.reporting_name ?? null,
      // Left blank, the identifier already on file is kept.
      tin_ref: v.tin_ref?.trim() ? v.tin_ref.trim() : current?.tin_ref ?? null,
      tin_type: v.tin_type ?? null,
      address_line1: v.address_line1 ?? null,
      address_line2: v.address_line2 ?? null,
      city: v.city ?? null,
      region: v.region ?? null,
      postal_code: v.postal_code ?? null,
      country: v.country || "US",
      is_1099_eligible: !!v.is_1099_eligible,
      box_code: v.box_code ?? null,
      eligibility_override: !!v.eligibility_override,
      override_reason: v.override_reason ?? null,
      reason: v.reason,
    });
    setSaving(false);
    if (res.ok) {
      message.success(
        res.data?.submittedForApproval
          ? "Tax profile change submitted for approval"
          : "Tax profile saved as a new version",
      );
      onClose();
      if (!res.data?.submittedForApproval) router.refresh();
    } else {
      message.error(res.error ?? "Failed to save the tax profile");
    }
  }

  return (
    <Drawer
      title={`Tax profile — ${vendor.name}`}
      open
      onClose={onClose}
      width={560}
      extra={
        canManage ? (
          <Button type="primary" loading={saving} onClick={submit}>
            Save new version
          </Button>
        ) : null
      }
    >
      {!canManage && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Read only"
          description="Changing tax information needs the elevated 'Manage vendor tax profiles' permission."
        />
      )}

      <Space direction="vertical" size="small" style={{ display: "flex", marginBottom: 16 }}>
        <Typography.Text type="secondary">
          Taxpayer identifier on file: <strong>{maskTin(current?.tin_ref ?? null, current?.tin_type ?? null)}</strong>
        </Typography.Text>
        <Typography.Text type="secondary">
          Current version: {current ? `v${current.version}` : "none yet"}
        </Typography.Text>
      </Space>

      <Form form={form} layout="vertical" disabled={!canManage} initialValues={{ w9_status: "not_requested", country: "US" }}>
        <Form.Item name="w9_status" label="W-9 status" rules={[{ required: true }]}>
          <Select options={W9_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        </Form.Item>
        <Space size="middle">
          <Form.Item name="w9_received_date" label="W-9 received">
            <DatePicker />
          </Form.Item>
          <Form.Item name="w9_expires_date" label="W-9 expires">
            <DatePicker />
          </Form.Item>
        </Space>
        <Form.Item name="classification" label="Tax classification">
          <Select
            allowClear
            options={TAX_CLASSIFICATIONS.map((c) => ({ value: c, label: label(c) }))}
          />
        </Form.Item>
        <Form.Item name="reporting_name" label="Legal reporting name" extra="As it appears on the W-9, if different from the display name">
          <Input />
        </Form.Item>
        <Space size="middle" align="start">
          <Form.Item name="tin_ref" label="Taxpayer identifier" extra="Leave blank to keep the one on file">
            <Input placeholder={current?.tin_ref ? "unchanged" : "12-3456789"} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="tin_type" label="Type">
            <Select allowClear style={{ width: 120 }} options={TIN_TYPES.map((t) => ({ value: t, label: t.toUpperCase() }))} />
          </Form.Item>
        </Space>

        <Typography.Title level={5}>Payee address</Typography.Title>
        <Form.Item name="address_line1" label="Address line 1">
          <Input />
        </Form.Item>
        <Form.Item name="address_line2" label="Address line 2">
          <Input />
        </Form.Item>
        <Space size="middle" wrap>
          <Form.Item name="city" label="City">
            <Input style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="region" label="State">
            <Input style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="postal_code" label="ZIP">
            <Input style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="country" label="Country">
            <Input style={{ width: 90 }} />
          </Form.Item>
        </Space>

        <Typography.Title level={5}>1099 reporting</Typography.Title>
        <Form.Item name="is_1099_eligible" label="Eligible for a 1099" valuePropName="checked">
          <Switch />
        </Form.Item>
        {eligible && (
          <Form.Item name="box_code" label="Reporting box" rules={[{ required: true, message: "Select the reporting box" }]}>
            <Select options={boxes.map((b) => ({ value: b.code, label: `${b.form} · ${b.box_label}` }))} />
          </Form.Item>
        )}
        <Form.Item name="eligibility_override" label="Documented override" valuePropName="checked" extra="Report regardless of classification or threshold">
          <Switch />
        </Form.Item>
        {override && (
          <Form.Item name="override_reason" label="Override reason" rules={[{ required: true, message: "An override needs its own reason" }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        )}

        <Form.Item name="reason" label="Change reason" rules={[{ required: true, message: "A change reason is required" }]}>
          <Input.TextArea rows={2} placeholder="Why is this changing? Recorded with the version." />
        </Form.Item>
      </Form>

      <Typography.Title level={5}>Version history</Typography.Title>
      <Table<VendorTaxProfileRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={versions}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "No tax profile recorded yet" }}
        columns={[
          { title: "v", dataIndex: "version", width: 50 },
          {
            title: "W-9",
            dataIndex: "w9_status",
            render: (v: string) => <Tag color={W9_COLOR[v]}>{label(v)}</Tag>,
          },
          {
            title: "1099",
            dataIndex: "is_1099_eligible",
            render: (v: boolean, r) => (v ? <Tag color="blue">{r.box_code}</Tag> : <Tag>no</Tag>),
          },
          { title: "Reason", dataIndex: "change_reason" },
          { title: "Saved", dataIndex: "created_at", render: (v: string) => v.slice(0, 10) },
        ]}
      />
    </Drawer>
  );
}
