"use client";
import { useMemo, useState } from "react";
import { Alert, App, Button, Form, Input, Modal, type MenuProps, type TableColumnsType } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import RowActionsMenu from "@/components/ui/RowActionsMenu";
import { dateColumn, flexColumn, statusColumn } from "@/components/ui/columns";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import { downloadSalesReceiptPdf } from "@/lib/client/invoice-pdf";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE, USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { matchesDocumentKeyword } from "@/lib/domain/document-filter";
import { SALES_RECEIPT_METHOD_LABEL, type SalesReceiptRow } from "@/lib/domain/sales-receipts";
import { formatMoney } from "@/lib/format";
import { getSalesReceiptDetailAction, getSalesReceiptDocumentAction, voidSalesReceiptAction } from "./actions";
import SalesReceiptFormModal, { type SalesReceiptDetailView } from "./SalesReceiptFormModal";
import {
  SALES_RECEIPT_COLUMN_WIDTH,
  SALES_RECEIPT_CUSTOMER_FLOOR,
  SALES_RECEIPT_DEPOSIT_FLOOR,
  SALES_RECEIPT_STATUS_TONES,
} from "./sales-receipt-columns";
import styles from "./sales-receipts.module.css";

export default function SalesReceiptsClient({
  initialCreateOpen,
  receipts,
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
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  receipts: SalesReceiptRow[];
  /** The company's today, in its own time zone: the date a new receipt starts on. */
  today: string;
  customers: CustomerRow[];
  /** Banks, cash and Undeposited Funds, by code. */
  depositAccounts: AccountRow[];
  /** The first bank account; null when the company has none yet. */
  defaultDepositAccountId: string | null;
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  /** Sold, active catalog entries. */
  items: ItemRow[];
  canWrite: boolean;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
}) {
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useInitiallyOpen(initialCreateOpen);
  const [viewing, setViewing] = useState<SalesReceiptDetailView | null>(null);
  const [voiding, setVoiding] = useState<SalesReceiptRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const rows = useMemo(
    () =>
      receipts.filter((r) =>
        matchesDocumentKeyword([r.receipt_number, r.customer_name, r.reference ?? ""], keyword),
      ),
    [receipts, keyword],
  );
  const narrowed = keyword.trim() !== "";

  function openNew() {
    setViewing(null);
    setCreateOpen(true);
  }

  function closeForm() {
    setCreateOpen(false);
    setViewing(null);
  }

  /** A saved receipt is read-only: it is already in the books. Reads its lines first. */
  async function openReceipt(row: SalesReceiptRow) {
    setBusyId(row.id);
    const res = await getSalesReceiptDetailAction(row.id);
    setBusyId(null);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to open the sales receipt");
      return;
    }
    setCreateOpen(false);
    setViewing(res.data);
  }

  async function downloadPdf(row: SalesReceiptRow) {
    setPdfId(row.id);
    try {
      const res = await getSalesReceiptDocumentAction(row.id);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to build the sales receipt PDF");
        return;
      }
      await downloadSalesReceiptPdf(res.data);
    } finally {
      setPdfId(null);
    }
  }

  const W = SALES_RECEIPT_COLUMN_WIDTH;
  const columns: TableColumnsType<SalesReceiptRow> = [
    {
      title: "Number",
      dataIndex: "receipt_number",
      width: W.number,
      render: (n: string, row) => (
        <Button type="link" size="small" className={styles.number} onClick={() => openReceipt(row)}>
          {n}
        </Button>
      ),
    },
    dateColumn<SalesReceiptRow>({ title: "Date", dataIndex: "receipt_date", width: W.date }),
    flexColumn<SalesReceiptRow>({ title: "Customer", dataIndex: "customer_name", floor: SALES_RECEIPT_CUSTOMER_FLOOR }),
    flexColumn<SalesReceiptRow>({
      title: "Deposit to",
      dataIndex: "deposit_account_label",
      floor: SALES_RECEIPT_DEPOSIT_FLOOR,
    }),
    {
      title: "Method",
      dataIndex: "payment_method",
      width: W.method,
      render: (method: SalesReceiptRow["payment_method"]) => (method ? SALES_RECEIPT_METHOD_LABEL[method] : "—"),
    },
    {
      title: "Total",
      dataIndex: "total_minor",
      width: W.total,
      align: "right",
      render: (minor: number, row) => (
        <span className={row.status === "void" ? styles.moneyVoid : styles.money}>
          {formatMoney(minor, USD_CURRENCY_CODE, USD_DECIMAL_PLACES)}
        </span>
      ),
    },
    statusColumn<SalesReceiptRow>({
      title: "Status",
      dataIndex: "status",
      tones: SALES_RECEIPT_STATUS_TONES,
      width: W.status,
    }),
    {
      title: "",
      key: "actions",
      width: W.actions,
      align: "right",
      render: (_: unknown, row) => {
        const menu: MenuProps["items"] = [
          { key: "open", label: "View", onClick: () => void openReceipt(row) },
          {
            key: "pdf",
            label: pdfId === row.id ? "Preparing PDF…" : "Download PDF",
            disabled: pdfId === row.id,
            onClick: () => void downloadPdf(row),
          },
        ];
        if (canWrite && row.status === "posted") {
          menu.push({ type: "divider", key: "before-void" });
          menu.push({ key: "void", label: "Void", danger: true, onClick: () => setVoiding(row) });
        }
        return (
          <RowActionsMenu
            items={menu}
            minWidth={176}
            loading={busyId === row.id}
            label={`Actions for ${row.receipt_number}`}
          />
        );
      },
    },
  ];

  const newButton = canWrite ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
      New sales receipt
    </Button>
  ) : null;

  return (
    <div>
      <FilterBar resultCount={rows.length} actions={newButton}>
        <Input.Search
          allowClear
          aria-label="Search sales receipts by number, customer or reference"
          placeholder="Search number, customer or reference"
          style={{ width: 340 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </FilterBar>

      <DataTable<SalesReceiptRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        sticky
        emptyTitle={narrowed ? "No sales receipts match this search" : "No sales receipts yet"}
        emptyDescription={
          narrowed
            ? undefined
            : "Record a sale the customer paid for at the time, by cash, check, card or transfer. An invoice is for a sale paid later."
        }
        emptyAction={narrowed ? undefined : (newButton ?? undefined)}
      />

      <SalesReceiptFormModal
        key={viewing?.receipt.id ?? "new"}
        open={createOpen || viewing !== null}
        detail={viewing}
        today={today}
        customers={customers}
        depositAccounts={depositAccounts}
        defaultDepositAccountId={defaultDepositAccountId}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items}
        canWrite={canWrite}
        canManageItems={canManageItems}
        onClose={closeForm}
        onVoid={(receipt) => {
          closeForm();
          setVoiding(receipt);
        }}
      />

      {voiding ? <VoidReceiptDialog receipt={voiding} onClose={() => setVoiding(null)} /> : null}
    </div>
  );
}

/**
 * Voiding asks why, as the books keep the reason with the receipt. The sale
 * is then entered again as a new receipt if it was a mistake.
 */
function VoidReceiptDialog({ receipt, onClose }: { receipt: SalesReceiptRow; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ reason: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    let values: { reason: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    setError(null);
    const res = await voidSalesReceiptAction({ id: receipt.id, reason: values.reason.trim() });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Failed to void the sales receipt");
      return;
    }
    message.success(`${receipt.receipt_number} voided.`);
    onClose();
  }

  return (
    <Modal
      open
      title={`Void ${receipt.receipt_number}?`}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="void" type="primary" danger loading={saving} onClick={submit}>
          Void receipt
        </Button>,
      ]}
    >
      <p className={styles.voidLead}>
        Its journal entry is voided, so its {formatMoney(receipt.total_minor, USD_CURRENCY_CODE, USD_DECIMAL_PLACES)}{" "}
        stops counting as sales and as money in {receipt.deposit_account_label || "the deposit account"}. The number is
        kept and never reused. To correct a mistake, enter the sale again as a new receipt.
      </p>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="reason"
          label="Reason"
          rules={[
            { required: true, whitespace: true, message: "Give the reason for voiding" },
            { min: 3, message: "Give a reason of at least three characters" },
          ]}
        >
          <Input.TextArea rows={2} maxLength={500} placeholder="Entered twice, wrong customer, sale refunded…" />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  );
}
