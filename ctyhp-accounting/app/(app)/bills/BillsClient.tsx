"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
} from "antd";
import { DeleteOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import type { AccountRow, CurrencyRow, VendorRow, ItemRow } from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import { itemToBillLineDefaults } from "@/lib/domain/items";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import {
  createBillAction,
  getBillSettlementsAction,
  postBillAction,
  voidBillAction,
} from "./actions";
import WriteOffModal from "../settlements/WriteOffModal";
import SettlementHistory from "@/components/settlements/SettlementHistory";
import type { SettlementEvent } from "@/lib/domain/settlement";

const STATUS_COLOR: Record<string, string> = {
  draft: "default",
  open: "blue",
  partial: "gold",
  paid: "green",
  void: "red",
};

interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number; // decimal, converted to minor on submit
  item_id?: string | null;
}

export default function BillsClient({
  initialCreateOpen,
  initialQueue,
  bills,
  vendors,
  expenseAccounts,
  incomeAccounts,
  currencies,
  items,
  canManageItems,
  canWrite,
  canRegisterAsset,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  scannerConfigured,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  initialQueue: { dueThrough: string; focusId: string | null } | null;
  bills: BillWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  incomeAccounts: AccountRow[];
  currencies: CurrencyRow[];
  items: ItemRow[];
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
  canWrite: boolean;
  canRegisterAsset: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  scannerConfigured: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(initialCreateOpen);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const currency = currencies.find((c) => c.is_base)?.code ?? "USD";
  const [writeOffFor, setWriteOffFor] = useState<BillWithVendor | null>(null);
  const [historyFor, setHistoryFor] = useState<BillWithVendor | null>(null);
  const [historyEvents, setHistoryEvents] = useState<SettlementEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  const visibleBills = useMemo(() => {
    if (!initialQueue) return bills;
    const filtered = bills.filter(
      (bill) =>
        (bill.status === "open" || bill.status === "partial") &&
        bill.balance_due_minor > 0 &&
        Boolean(bill.due_date) &&
        bill.due_date! <= initialQueue.dueThrough,
    );
    return [...filtered].sort((left, right) => {
      if (left.id === initialQueue.focusId) return -1;
      if (right.id === initialQueue.focusId) return 1;
      return (left.due_date ?? "").localeCompare(right.due_date ?? "");
    });
  }, [bills, initialQueue]);

  function decimalsOf(code: string): number {
    return currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  }

  function fmt(minor: number, code: string): string {
    const d = decimalsOf(code);
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function submit() {
    const values = await form.validateFields();
    const lines = (values.lines as LineForm[]).map((l) => ({
      description: l.description ?? "",
      expense_account_id: l.expense_account_id,
      amount_minor: Math.round((l.amount ?? 0) * 10 ** decimals),
      item_id: l.item_id ?? null,
    }));
    setSaving(true);
    const res = await createBillAction({
      vendor_id: values.vendor_id,
      vendor_ref: values.vendor_ref ?? null,
      currency_code: currency,
      bill_date: values.bill_date ? values.bill_date.format("YYYY-MM-DD") : undefined,
      due_date: values.due_date ? values.due_date.format("YYYY-MM-DD") : null,
      memo: values.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Draft bill created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create bill");
    }
  }

  async function post(id: string) {
    const res = await postBillAction(id);
    if (res.ok) message.success("Bill posted");
    else message.error(res.error ?? "Failed to post bill");
  }

  /** What has settled this bill: payments made, vendor credits, write-offs. */
  async function openHistory(bill: BillWithVendor) {
    setHistoryFor(bill);
    setHistoryEvents([]);
    setHistoryLoading(true);
    const res = await getBillSettlementsAction(bill.id);
    setHistoryLoading(false);
    if (res.ok && res.data) setHistoryEvents(res.data);
    else message.error(res.error ?? "Failed to load the payment history");
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill?",
      content: "This reverses its journal entry. Bills with payments applied cannot be voided.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillAction(id);
        if (res.ok) message.success("Bill voided");
        else message.error(res.error ?? "Failed to void bill");
      },
    });
  }

  return (
    <>
      <FilterBar
        resultCount={visibleBills.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              New bill
            </Button>
          ) : null
        }
      >
        {initialQueue ? (
          <div className="accounting-queue-filter">
            <Tag color="orange">Work queue · bills due</Tag>
            <span>Through {initialQueue.dueThrough}</span>
            <Button onClick={() => router.push("/bills")}>Show all</Button>
          </div>
        ) : null}
      </FilterBar>
      <DataTable<BillWithVendor>
        rowKey="id"
        dataSource={visibleBills}
        rowClassName={(bill) =>
          bill.id === initialQueue?.focusId ? "accounting-data-row--focused" : ""
        }
        emptyTitle={initialQueue ? "No bills due" : "No bills yet"}
        emptyDescription={
          initialQueue
            ? "No open vendor bills are due within the selected work queue window."
            : "Enter a vendor bill to track Accounts Payable and due dates."
        }
        columns={[
          { title: "Bill Number", dataIndex: "bill_number", render: (v) => v ?? <Tag>draft</Tag> },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Vendor Reference", dataIndex: "vendor_ref", render: (v) => v ?? "—" },
          { title: "Date", dataIndex: "bill_date" },
          { title: "Due", dataIndex: "due_date", render: (v) => v ?? "—" },
          {
            title: "Total",
            dataIndex: "total_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Balance",
            dataIndex: "balance_due_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "Journal entry",
            key: "entry",
            width: 140,
            render: (_, r) =>
              r.entry_number ? (
                <Link href={`/journal?entry=${r.journal_entry_id}`}>{r.entry_number}</Link>
              ) : (
                "—"
              ),
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canReadDocuments || canWrite || canRegisterAsset ? (
                <Space>
                  {canReadDocuments ? (
                    <IconActionButton
                      label="Manage bill attachments"
                      icon={<PaperClipOutlined />}
                      onClick={() =>
                        setAttachmentTarget({
                          entityType: "bill",
                          entityId: r.id,
                          label: `${r.bill_number ?? "Draft bill"} · ${r.vendor_name}`,
                        })
                      }
                    />
                  ) : null}
                  {canWrite && r.status === "draft" && (
                    <Button size="small" type="link" onClick={() => post(r.id)}>
                      Post
                    </Button>
                  )}
                  {r.status !== "draft" ? (
                    <Button size="small" type="link" onClick={() => openHistory(r)}>
                      Payments
                    </Button>
                  ) : null}
                  {canWrite && r.status !== "void" && r.status !== "paid" && (
                    <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                      Void
                    </Button>
                  )}
                  {canWrite && (r.status === "open" || r.status === "partial") && (
                    <Button size="small" type="link" onClick={() => setWriteOffFor(r)}>
                      Write off
                    </Button>
                  )}
                  {canRegisterAsset &&
                  r.status !== "draft" &&
                  r.status !== "void" &&
                  r.journal_entry_id ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => router.push(`/fixed-assets?bill=${r.id}`)}
                    >
                      Register asset
                    </Button>
                  ) : null}
                </Space>
              ) : null,
          },
        ]}
      />
      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />
      <Modal
        title="New bill"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Create draft"
        width={720}
      >
        <Form form={form} layout="vertical" initialValues={{ lines: [{}] }}>
          <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_ref" label="Vendor Reference Number">
              <Input placeholder="Vendor invoice number" />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                disabled
                value={currency}
                style={{ width: 120 }}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="bill_date" label="Bill date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="due_date" label="Due date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        style={{ width: 180 }}
                        optionFilterProp="label"
                        notFoundContent={items.length === 0 ? "No purchasable products yet" : undefined}
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToBillLineDefaults(it);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "expense_account_id"], value: d.expense_account_id ?? undefined },
                            { name: ["lines", field.name, "amount"], value: d.amount_minor / 10 ** decimals },
                          ]);
                        }}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Description" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "expense_account_id"]}
                      rules={[{ required: true, message: "Account" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Expense or asset account"
                        style={{ width: 220 }}
                        showSearch
                        optionFilterProp="label"
                        options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      rules={[{ required: true, message: "Amount" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={0} precision={decimals} placeholder="Amount" style={{ width: 140 }} />
                    </Form.Item>
                    {fields.length > 1 && (
                      <IconActionButton
                        label="Remove bill line"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    )}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  Add line
                </Button>
              </>
            )}
          </Form.List>
          {items.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <EmptyCatalogHint canManage={canManageItems}>
                No purchasable products yet, so every line must be typed in full. Save the cost once in
              </EmptyCatalogHint>
            </div>
          ) : null}
          <Form.Item name="memo" label="Memo" style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Bill ${historyFor?.bill_number ?? ""}`}
        open={historyFor !== null}
        onCancel={() => setHistoryFor(null)}
        footer={null}
        width={860}
        destroyOnHidden
      >
        {historyFor ? (
          <SettlementHistory
            totalMinor={historyFor.total_minor}
            balanceDueMinor={historyFor.balance_due_minor}
            currencyCode={historyFor.currency_code}
            decimals={2}
            events={historyEvents}
            loading={historyLoading}
            emptyText="No payment, vendor credit or write-off has been applied to this bill yet."
          />
        ) : null}
      </Modal>

      {writeOffFor && (
        <WriteOffModal
          open={!!writeOffFor}
          onClose={() => setWriteOffFor(null)}
          onDone={() => router.refresh()}
          side="ap"
          targetId={writeOffFor.id}
          currency={writeOffFor.currency_code}
          balanceMinor={writeOffFor.balance_due_minor}
          baseDecimals={decimalsOf(writeOffFor.currency_code)}
          offsetAccounts={incomeAccounts}
        />
      )}
    </>
  );
}
