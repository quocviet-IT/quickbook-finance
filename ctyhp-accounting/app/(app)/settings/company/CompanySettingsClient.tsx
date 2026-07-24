"use client";
import { useEffect, useState } from "react";
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Table } from "antd";
import { saveCompanySettingsAction, listCompanySettingVersionsAction } from "./actions";
import type { CompanySettingRow } from "@/lib/db/types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function maskEin(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/\s/g, "");
  return t.length <= 4 ? "••" : `•••••${t.slice(-4)}`;
}

export default function CompanySettingsClient({ canEdit, current }: { canEdit: boolean; current: CompanySettingRow | null }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const [versions, setVersions] = useState<CompanySettingRow[]>([]);

  const loadVersions = async () => {
    const r = await listCompanySettingVersionsAction();
    if (r.ok && r.data) setVersions(r.data); else message.error(r.error ?? "Failed to load versions");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = () => {
    form.setFieldsValue({
      legal_name: current?.legal_name, dba_name: current?.dba_name, ein_ref: current?.ein_ref,
      address_line1: current?.address_line1, address_line2: current?.address_line2, city: current?.city,
      region: current?.region, postal_code: current?.postal_code, country: current?.country,
      fiscal_year_start_month: current?.fiscal_year_start_month ?? 1,
      base_currency_code: current?.base_currency_code ?? "USD",
      time_zone: current?.time_zone ?? "America/New_York",
      accounting_basis: current?.accounting_basis ?? "accrual",
      default_payment_terms_days: current?.default_payment_terms_days ?? 30,
    });
    setEditing(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const r = await saveCompanySettingsAction(v);
    if (r.ok) { message.success("Settings saved (new version)"); setEditing(false); void loadVersions(); }
    else message.error(r.error ?? "Failed to save");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {!editing && (
        <Card
          title="Current settings"
          extra={canEdit ? <Button type="primary" onClick={startEdit}>Edit</Button> : null}
        >
          {current ? (
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Legal name">{current.legal_name}</Descriptions.Item>
              <Descriptions.Item label="Doing Business As">{current.dba_name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Employer Identification Number">{maskEin(current.ein_ref)}</Descriptions.Item>
              <Descriptions.Item label="Fiscal year start">{MONTHS[(current.fiscal_year_start_month ?? 1) - 1]}</Descriptions.Item>
              <Descriptions.Item label="Accounting basis">{current.accounting_basis}</Descriptions.Item>
              <Descriptions.Item label="Base currency">{current.base_currency_code}</Descriptions.Item>
              <Descriptions.Item label="Time zone">{current.time_zone}</Descriptions.Item>
              <Descriptions.Item label="Default terms (days)">{current.default_payment_terms_days}</Descriptions.Item>
            </Descriptions>
          ) : (
            <p>No company settings yet.{canEdit ? " Click Edit to create them." : ""}</p>
          )}
        </Card>
      )}
      {editing && (
        <Card title="Edit settings">
          <Form form={form} layout="vertical">
            <Form.Item name="legal_name" label="Legal name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="dba_name" label="Doing Business As"><Input /></Form.Item>
            <Form.Item name="ein_ref" label="Employer Identification Number reference"><Input /></Form.Item>
            <Form.Item name="address_line1" label="Address line 1"><Input /></Form.Item>
            <Form.Item name="address_line2" label="Address line 2"><Input /></Form.Item>
            <Space wrap>
              <Form.Item name="city" label="City"><Input /></Form.Item>
              <Form.Item name="region" label="State/Region"><Input /></Form.Item>
              <Form.Item name="postal_code" label="Postal code"><Input /></Form.Item>
              <Form.Item name="country" label="Country"><Input /></Form.Item>
            </Space>
            <Space wrap>
              <Form.Item name="fiscal_year_start_month" label="Fiscal year start" rules={[{ required: true }]}>
                <Select style={{ width: 160 }} options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
              <Form.Item name="accounting_basis" label="Accounting basis" rules={[{ required: true }]}>
                <Select style={{ width: 140 }} options={[{ value: "accrual", label: "Accrual" }, { value: "cash", label: "Cash" }]} />
              </Form.Item>
              <Form.Item name="base_currency_code" label="Base currency"><Input style={{ width: 100 }} /></Form.Item>
              <Form.Item name="time_zone" label="Time zone"><Input /></Form.Item>
              <Form.Item name="default_payment_terms_days" label="Default terms (days)"><InputNumber min={0} /></Form.Item>
            </Space>
            <Space>
              <Button type="primary" onClick={submit}>Save new version</Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </Space>
          </Form>
        </Card>
      )}
      <Card title="Version history">
        <Table rowKey="id" size="small" dataSource={versions} pagination={false}
          columns={[
            { title: "Version", dataIndex: "version" },
            { title: "Effective", dataIndex: "effective_from" },
            { title: "Legal name", dataIndex: "legal_name" },
            { title: "Basis", dataIndex: "accounting_basis" },
            { title: "Employer Identification Number", render: (_, r) => maskEin(r.ein_ref) },
          ]} />
      </Card>
    </Space>
  );
}
