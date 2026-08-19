"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  type MenuProps,
} from "antd";
import { DeleteOutlined, MoreOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { isOverdueDocument, matchesDocumentKeyword } from "@/lib/domain/document-filter";
import IconActionButton from "@/components/ui/IconActionButton";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import type { BillStatus, AccountRow, CurrencyRow, VendorRow, ItemRow } from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import { itemToBillLineDefaults } from "@/lib/domain/items";
import { withVendor } from "@/lib/domain/vendors";
import type { BillablePurchaseOrder } from "@/lib/domain/purchasing";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import NewVendorButton from "@/components/NewVendorButton";
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
  billableOrders,
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
  /** Purchase orders with goods received and not yet billed, any vendor. */
  billableOrders: BillablePurchaseOrder[];
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

  // A vendor created from inside the bill dialog has to appear in the picker
  // now; the page's own list will not refresh until the bill is saved.
  const [localVendors, setLocalVendors] = useState<VendorRow[]>(vendors);
  function addVendor(vendor: VendorRow) {
    setLocalVendors((prev) => withVendor(prev, vendor));
    form.setFieldValue("vendor_id", vendor.id);
  }

  // Which purchase orders this vendor still owes a bill for. A bill raised
  // against one has to be matched against what actually arrived, and this form
  // does not do that -- so it hands over to the purchase order, where the
  // three-way match lives, rather than copying lines across unchecked.
  const selectedVendorId: string | undefined = Form.useWatch("vendor_id", form);
  const vendorOrders = useMemo(
    () => billableOrders.filter((order) => order.vendorId === selectedVendorId),
    [billableOrders, selectedVendorId],
  );

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | BillStatus>("all");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

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

  // On top of the queue narrowing, never instead of it. The keyword covers
  // the vendor reference too — that is the string in a bookkeeper's hand
  // when the vendor calls about it.
  const filteredBills = visibleBills.filter((bill) => {
    if (!matchesDocumentKeyword([bill.bill_number, bill.vendor_name, bill.vendor_ref], keyword)) {
      return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "overdue") {
      return isOverdueDocument(
        { status: bill.status, dueDate: bill.due_date, balanceDueMinor: bill.balance_due_minor },
        today,
      );
    }
    return bill.status === statusFilter;
  });

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
        resultCount={filteredBills.length}
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
        <Input.Search
          allowClear
          aria-label="Search bills by number, vendor, or vendor reference"
          placeholder="Search number, vendor, or reference"
          style={{ width: 280 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          aria-label="Filter bills by status"
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ minWidth: 150 }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "overdue", label: "Overdue" },
            { value: "draft", label: "Draft" },
            { value: "open", label: "Open" },
            { value: "partial", label: "Partially paid" },
            { value: "paid", label: "Paid" },
            { value: "void", label: "Void" },
          ]}
        />
      </FilterBar>
      <DataTable<BillWithVendor>
        rowKey="id"
        dataSource={filteredBills}
        rowClassName={(bill) =>
          bill.id === initialQueue?.focusId ? "accounting-data-row--focused" : ""
        }
        emptyTitle={
          keyword || statusFilter !== "all"
            ? "No bills match these filters"
            : initialQueue
              ? "No bills due"
              : "No bills yet"
        }
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
            width: 140,
            // The same shape Payments settled on: the paperclip, the one
            // state-advancing action a draft has, and everything else behind
            // one ⋯ menu. This column used to spread up to five coloured
            // text links across the row — a different set per status, so no
            // two rows lined up and Void sat mid-sentence in red.
            render: (_, r) => {
              const menu: MenuProps["items"] = [
                ...(r.status !== "draft"
                  ? [{ key: "payments", label: "Payments", onClick: () => openHistory(r) }]
                  : []),
                ...(canWrite && (r.status === "open" || r.status === "partial")
                  ? [{ key: "writeoff", label: "Write off", onClick: () => setWriteOffFor(r) }]
                  : []),
                ...(canRegisterAsset &&
                r.status !== "draft" &&
                r.status !== "void" &&
                r.journal_entry_id
                  ? [
                      {
                        key: "asset",
                        label: "Register asset",
                        onClick: () => router.push(`/fixed-assets?bill=${r.id}`),
                      },
                    ]
                  : []),
              ];
              // Last, and separated — but only separated when there is
              // something to separate from: a draft's menu holds Void alone,
              // and a divider above a menu's only item is an orphaned line.
              if (canWrite && r.status !== "void" && r.status !== "paid") {
                if (menu.length) menu.push({ type: "divider" as const, key: "before-void" });
                menu.push({ key: "void", label: "Void bill", danger: true, onClick: () => confirmVoid(r.id) });
              }
              return canReadDocuments || canWrite || canRegisterAsset ? (
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
                    <Button size="small" onClick={() => post(r.id)}>
                      Post
                    </Button>
                  )}
                  {menu.length ? (
                    <Dropdown menu={{ items: menu, style: { minWidth: 148 } }} trigger={["click"]}>
                      <Button
                        size="small"
                        icon={<MoreOutlined />}
                        aria-label={`Actions for ${r.bill_number ?? "draft bill"}`}
                      />
                    </Dropdown>
                  ) : null}
                </Space>
              ) : null;
            },
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
          <Space align="end" wrap style={{ display: "flex" }}>
            <Form.Item
              name="vendor_id"
              label="Vendor"
              rules={[{ required: true, message: "Select a vendor" }]}
              style={{ minWidth: 320 }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={localVendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item label=" ">
              <NewVendorButton onCreated={addVendor} />
            </Form.Item>
          </Space>
          {vendorOrders.length > 0 ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${vendorOrders.length} purchase order${vendorOrders.length > 1 ? "s" : ""} from this vendor received and not yet billed`}
              description={
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <span>
                    Billing an order there checks what you are billed against what actually arrived, and
                    against the price you ordered at. Typing the lines here instead skips that check and
                    leaves the order still showing as unbilled.
                  </span>
                  <Select
                    placeholder="Bill a purchase order"
                    style={{ minWidth: 340 }}
                    value={null}
                    onChange={(id: string) => router.push(`/purchase-orders/${id}?bill=1`)}
                    options={vendorOrders.map((order) => ({
                      value: order.purchaseOrderId,
                      label: `${order.poNumber ?? "Draft order"} · ${order.lineCount} line${order.lineCount > 1 ? "s" : ""} · ${fmt(order.valueMinor, order.currencyCode)}`,
                    }))}
                  />
                </Space>
              }
            />
          ) : null}
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
