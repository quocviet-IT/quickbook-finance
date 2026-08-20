"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import { matchesDocumentKeyword } from "@/lib/domain/document-filter";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { withVendor } from "@/lib/domain/vendors";
import NewVendorButton from "@/components/NewVendorButton";
import {
  createVendorCreditAction,
  listVendorCreditsAction,
  voidVendorCreditAction,
  applyVendorCreditAction,
  listOpenBillsAction,
} from "./actions";
import type { CreditStatus, VendorCreditRow, VendorRow, AccountRow } from "@/lib/db/types";

interface Props {
  canWrite: boolean;
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  baseCurrency: string;
  baseDecimals: number;
}
interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number;
}

// Typed against the union on purpose: this map used to carry a key `voided`
// for a status the type spells `void`, so a voided credit's tag silently fell
// back to grey. A misspelt key is now a compile error instead.
const STATUS_COLOR: Record<CreditStatus, string> = {
  draft: "default",
  issued: "blue",
  partial: "gold",
  applied: "green",
  void: "red",
};

export default function VendorCreditsClient({
  canWrite,
  vendors,
  expenseAccounts,
  baseCurrency,
  baseDecimals,
}: Props) {
  const { message } = App.useApp();
  const [credits, setCredits] = useState<VendorCreditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}]);
  const [applyFor, setApplyFor] = useState<VendorCreditRow | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [openBills, setOpenBills] = useState<{ id: string; bill_number: string; balance_due_minor: number }[]>([]);
  const [allocs, setAllocs] = useState<Record<string, number>>({});
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CreditStatus>("all");

  // A vendor created from inside this dialog has to appear in the picker now;
  // the page's own list will not refresh until the credit is saved.
  const [localVendors, setLocalVendors] = useState<VendorRow[]>(vendors);
  function addVendor(vendor: VendorRow) {
    setLocalVendors((prev) => withVendor(prev, vendor));
    form.setFieldValue("vendor_id", vendor.id);
  }

  const load = async () => {
    setLoading(true);
    const r = await listVendorCreditsAction();
    setLoading(false);
    if (r.ok && r.data) setCredits(r.data);
    else message.error(r.error ?? "Failed to load vendor credits");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (m: number) =>
    fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  // The row carries only the vendor's id; the picker's list is the same
  // vendors, so the name comes from there for the column and the search.
  const vendorNameById = useMemo(() => new Map(localVendors.map((v) => [v.id, v.name])), [localVendors]);

  const filteredCredits = credits.filter((c) => {
    if (
      !matchesDocumentKeyword(
        [c.vendor_credit_number, vendorNameById.get(c.vendor_id), c.vendor_ref, c.reason, c.memo],
        keyword,
      )
    ) {
      return false;
    }
    return statusFilter === "all" || c.status === statusFilter;
  });

  const total = useMemo(
    () => lines.reduce((s, l) => s + toMinor(l.amount ?? 0, baseDecimals), 0),
    [lines, baseDecimals],
  );

  const resetForm = () => {
    setLines([{}]);
    form.resetFields();
  };

  const submit = async () => {
    const h = await form.validateFields();
    const payload = {
      vendor_id: h.vendor_id,
      currency_code: baseCurrency,
      credit_date: h.credit_date ? h.credit_date.format("YYYY-MM-DD") : undefined,
      vendor_ref: h.vendor_ref ?? null,
      reason: h.reason ?? null,
      memo: h.memo ?? null,
      lines: lines
        .filter((l) => l.expense_account_id && (l.amount ?? 0) > 0)
        .map((l) => ({
          description: l.description ?? "",
          expense_account_id: l.expense_account_id!,
          amount_minor: toMinor(l.amount ?? 0, baseDecimals),
        })),
    };
    setSaving(true);
    const r = await createVendorCreditAction(payload);
    setSaving(false);
    if (r.ok) {
      message.success("Vendor credit issued");
      setOpen(false);
      resetForm();
      void load();
    } else {
      message.error(r.error ?? "Failed to create vendor credit");
    }
  };

  const voidCredit = async (c: VendorCreditRow) => {
    const r = await voidVendorCreditAction(c.id);
    if (r.ok) {
      message.success("Vendor credit voided");
      void load();
    } else {
      message.error(r.error ?? "Failed to void vendor credit");
    }
  };

  const openApply = async (c: VendorCreditRow) => {
    setApplyFor(c);
    setAllocs({});
    setOpenBills([]);
    const r = await listOpenBillsAction(c.vendor_id, c.currency_code);
    if (r.ok && r.data) setOpenBills(r.data);
    else message.error(r.error ?? "Failed to load open bills");
  };

  const submitApply = async () => {
    if (!applyFor) return;
    const arr = Object.entries(allocs)
      .filter(([, v]) => v > 0)
      .map(([target_id, v]) => ({ target_id, amount_minor: toMinor(v, baseDecimals) }));
    if (arr.length === 0) {
      message.error("Enter at least one allocation amount");
      return;
    }
    setApplyBusy(true);
    const r = await applyVendorCreditAction(applyFor.id, arr);
    setApplyBusy(false);
    if (r.ok) {
      message.success("Vendor credit applied");
      setApplyFor(null);
      void load();
    } else {
      message.error(r.error ?? "Failed to apply vendor credit");
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={filteredCredits.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              New vendor credit
            </Button>
          ) : null
        }
      >
        <Input.Search
          allowClear
          aria-label="Search vendor credits by number, vendor, or reference"
          placeholder="Search number, vendor, or reference"
          style={{ width: 280 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          aria-label="Filter vendor credits by status"
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ minWidth: 160 }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "issued", label: "Issued" },
            { value: "partial", label: "Partially applied" },
            { value: "applied", label: "Applied" },
            { value: "void", label: "Void" },
          ]}
        />
      </FilterBar>
      <DataTable<VendorCreditRow>
        rowKey="id"
        loading={loading}
        dataSource={filteredCredits}
        emptyTitle={keyword || statusFilter !== "all" ? "No vendor credits match these filters" : "No vendor credits yet"}
        emptyDescription="Record a vendor credit to reduce what you owe a vendor."
        columns={[
          { title: "Number", dataIndex: "vendor_credit_number", render: (n) => n ?? <Tag>draft</Tag> },
          { title: "Vendor", key: "vendor", render: (_, c) => vendorNameById.get(c.vendor_id) ?? "—" },
          { title: "Date", dataIndex: "credit_date" },
          { title: "Total", align: "right", render: (_, c) => fmt(c.total_minor) },
          { title: "Remaining", align: "right", render: (_, c) => fmt(c.balance_remaining_minor) },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: CreditStatus) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "",
            key: "actions",
            render: (_, c) =>
              canWrite && (c.status === "issued" || c.status === "partial") ? (
                <Space>
                  <Button size="small" onClick={() => openApply(c)}>
                    Apply
                  </Button>
                  <Button size="small" danger onClick={() => voidCredit(c)}>
                    Void
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />

      <Modal
        open={open}
        title="New Vendor Credit"
        width={780}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okButtonProps={{ disabled: total <= 0 }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
              <Select
                style={{ width: 280 }}
                showSearch
                optionFilterProp="label"
                options={localVendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item label=" ">
              <NewVendorButton onCreated={addVendor} />
            </Form.Item>
            <Form.Item name="credit_date" label="Date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="vendor_ref" label="Vendor Reference">
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="reason" label="Reason">
            <Input />
          </Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }} wrap>
              <Input
                placeholder="Description"
                style={{ width: 200 }}
                value={l.description}
                onChange={(e) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                }
              />
              <Select
                placeholder="Expense account"
                style={{ width: 260 }}
                showSearch
                optionFilterProp="label"
                value={l.expense_account_id}
                options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, expense_account_id: v } : x)))}
              />
              <InputNumber
                placeholder="Amount"
                min={0}
                precision={baseDecimals}
                value={l.amount}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, amount: v ?? undefined } : x)))}
              />
              <IconActionButton
                label="Remove vendor credit line"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                disabled={lines.length <= 1}
              />
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setLines((p) => [...p, {}])}>
            Add line
          </Button>
          <div style={{ marginTop: 12 }}>
            Total: {fmt(total)} {baseCurrency}
          </div>
        </Card>
      </Modal>

      <Modal
        open={!!applyFor}
        title={`Apply ${applyFor?.vendor_credit_number ?? ""}`}
        onCancel={() => setApplyFor(null)}
        onOk={submitApply}
        confirmLoading={applyBusy}
        destroyOnHidden
      >
        <p>
          Remaining: {applyFor ? fmt(applyFor.balance_remaining_minor) : ""} {baseCurrency}
        </p>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={openBills}
          columns={[
            { title: "Bill", dataIndex: "bill_number" },
            { title: "Balance", align: "right", render: (_, r) => fmt(r.balance_due_minor) },
            {
              title: "Apply",
              render: (_, r) => (
                <InputNumber
                  min={0}
                  precision={baseDecimals}
                  max={fromMinor(
                    Math.min(r.balance_due_minor, applyFor?.balance_remaining_minor ?? r.balance_due_minor),
                    baseDecimals,
                  )}
                  onChange={(v) => setAllocs((p) => ({ ...p, [r.id]: (v as number) ?? 0 }))}
                />
              ),
            },
          ]}
        />
      </Modal>
    </Space>
  );
}
