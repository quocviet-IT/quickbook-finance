"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { App, Button, Descriptions, Modal, Space, Typography, type DescriptionsProps } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { PAID_LABELS } from "@/lib/domain/status-label";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { ActorRow, AuditEntryRow, CurrencyRow, InvoiceLineRow } from "@/lib/db/types";
import type { InvoiceEstimateLink, InvoiceWithCustomer } from "@/lib/services/invoicing";
import { formatDate, formatMoney } from "@/lib/format";
import { useCompanyClock } from "@/components/CompanyClock";
import { estimateMessages } from "@/lib/domain/estimates";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import SettlementHistory from "@/components/settlements/SettlementHistory";
import type { SettlementEvent } from "@/lib/domain/settlement";
import { getInvoiceDetailAction } from "./actions";
import { invoiceVoidOption } from "@/lib/domain/invoice-void";
import { invoiceAttention, invoiceAttentionLook } from "@/lib/domain/invoice-attention";

/** The dialog an invoice's lines open in, whose body is the lines table's box. */
export const VIEW_INVOICE_MODAL_WIDTH = 820;

/**
 * Quantity, Unit price, Subtotal, Tax. Description takes what is left. They
 * were 90, 110, 110 and 100, this dialog's own numbers; the amounts now take
 * the width every other money column has.
 */
export const INVOICE_LINES_FIXED_WIDTHS = [COLUMN.QTY, COLUMN.MONEY, COLUMN.MONEY, COLUMN.MONEY] as const;

interface Loaded {
  id: string;
  lines: InvoiceLineRow[];
  settlements: SettlementEvent[];
  audit: AuditEntryRow[];
  estimate: InvoiceEstimateLink | null;
}

interface Props {
  /** The invoice to show; null keeps the dialog closed. */
  invoice: InvoiceWithCustomer | null;
  currencies: CurrencyRow[];
  actors: ActorRow[];
  canReadAudit: boolean;
  onClose: () => void;
  onDownloadPdf: (inv: InvoiceWithCustomer) => void;
  pdfBusy: boolean;
  /** Omitted when the viewer may not issue. */
  onIssue?: (inv: InvoiceWithCustomer) => void;
  issueBusy?: boolean;
  /** Omitted when the viewer may not void. */
  onVoid?: (inv: InvoiceWithCustomer) => void;
  /** False on that customer's own page, where a link to it would go nowhere. */
  linkCustomer?: boolean;
}

/**
 * One invoice's dialog, shared by the Invoices list and a customer's page: who,
 * what state and which dates, the lines with their totals, what has been
 * applied to it, and last who changed what.
 */
export default function InvoiceDetailDialog({
  invoice,
  currencies,
  actors,
  canReadAudit,
  onClose,
  onDownloadPdf,
  pdfBusy,
  onIssue,
  issueBusy,
  onVoid,
  linkCustomer = true,
}: Props) {
  const { message } = App.useApp();
  const { today } = useCompanyClock();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const invoiceId = invoice?.id ?? null;

  const directory = useMemo(
    () => new Map(actors.map((a) => [a.id, a.email || a.full_name])),
    [actors],
  );

  useEffect(() => {
    if (!invoiceId) return;
    let current = true;
    void (async () => {
      // One request: Next runs Server Actions one at a time, so these three
      // reads sent as separate actions were three trips in a row.
      const { lines, settlements, audit, estimate } = await getInvoiceDetailAction(invoiceId, canReadAudit);
      // The reader closed it or opened another invoice while this was on its way.
      if (!current) return;
      if (!lines.ok) message.error(lines.error ?? "Failed to load lines");
      if (!settlements.ok) message.error(settlements.error ?? "Failed to load the payment history");
      if (!estimate.ok) message.error(estimate.error ?? "Failed to load the estimate it was made from");
      if (audit && !audit.ok) message.error(audit.error ?? "Failed to load the change history");
      setLoaded({
        id: invoiceId,
        lines: lines.ok && lines.data ? lines.data : [],
        settlements: settlements.ok && settlements.data ? settlements.data : [],
        audit: audit && audit.ok && audit.data ? audit.data : [],
        estimate: estimate.ok ? (estimate.data ?? null) : null,
      });
    })();
    return () => {
      current = false;
    };
  }, [invoiceId, canReadAudit, message]);

  // Until this invoice's details arrive, show nothing of the previous one's.
  const ready = loaded !== null && loaded.id === invoiceId ? loaded : null;
  const loading = invoice !== null && ready === null;

  const decimalsOf = (code: string) => currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const money = (minor: number, code: string) => formatMoney(minor, code, decimalsOf(code));

  /** Void as the open invoice's dialog offers it: the menu's rule (invoiceVoidOption). */
  const voidOption = invoice ? invoiceVoidOption(invoice) : null;

  /**
   * The head of an invoice's dialog: who, what state, which dates, which entry
   * and what is still owed (3.0.11). The status reads as in the list, plus how
   * late or how soon when that is the point.
   */
  function headerItems(invoice: InvoiceWithCustomer): DescriptionsProps["items"] {
    const look = invoiceAttentionLook(invoiceAttention(invoice, today));
    const code = look?.tone === "danger" ? "overdue" : "due_soon";
    return [
      {
        key: "customer",
        label: "Customer",
        children: linkCustomer ? (
          <Link href={`/customers/${invoice.customer_id}`}>{invoice.customer_name}</Link>
        ) : (
          invoice.customer_name
        ),
      },
      {
        key: "status",
        label: "Status",
        children: (
          <Space size={4} wrap>
            <StatusTag status={invoice.status} labels={PAID_LABELS} />
            {look ? <StatusTag status={code} looks={{ [code]: look }} /> : null}
          </Space>
        ),
      },
      { key: "issued", label: "Issued", children: formatDate(invoice.issue_date) },
      { key: "due", label: "Due", children: invoice.due_date ? formatDate(invoice.due_date) : "—" },
      {
        key: "entry",
        label: "Journal entry",
        children:
          invoice.entry_number && invoice.journal_entry_id ? (
            <Link href={`/journal?entry=${invoice.journal_entry_id}`}>{invoice.entry_number}</Link>
          ) : (
            "Not posted yet"
          ),
      },
      { key: "balance", label: "Balance due", children: money(invoice.balance_due_minor, invoice.currency_code) },
    ];
  }

  const lineMoney = (v: number) => (invoice ? money(v, invoice.currency_code) : v);

  return (
    <Modal
      title={`Invoice ${invoice?.invoice_number ?? "(draft)"}`}
      open={invoice !== null}
      onCancel={onClose}
      // The invoice's own actions, where the reader is looking at it (3.0.11).
      // Void follows the menu's rule: refused once money is applied, and then
      // the reason stands in its place.
      footer={
        invoice ? (
          <Space wrap>
            {onVoid && voidOption?.offered ? (
              voidOption.blockedReason ? (
                <Typography.Text type="secondary">{voidOption.blockedReason}</Typography.Text>
              ) : (
                <Button danger onClick={() => onVoid(invoice)}>
                  Void invoice
                </Button>
              )
            ) : null}
            <Button loading={pdfBusy} onClick={() => onDownloadPdf(invoice)}>
              Download PDF
            </Button>
            <Button onClick={onClose}>Close</Button>
            {onIssue && invoice.status === "draft" ? (
              <Button type="primary" loading={issueBusy} onClick={() => onIssue(invoice)}>
                Issue
              </Button>
            ) : null}
          </Space>
        ) : null
      }
      width={VIEW_INVOICE_MODAL_WIDTH}
    >
      {/* Who, what state and which dates, before anything else. The journal
          entry and who raised it used to sit under the customer in the list. */}
      {invoice ? (
        <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }} items={headerItems(invoice)} />
      ) : null}

      {ready?.estimate ? (
        <Typography.Paragraph>
          <Link href="/estimates">{estimateMessages.fromEstimate(ready.estimate.estimate_number)}</Link>
        </Typography.Paragraph>
      ) : null}

      <DataTable<InvoiceLineRow>
        rowKey="id"
        pagination={false}
        rows={ready?.lines ?? []}
        columns={[
          flexColumn<InvoiceLineRow>({ title: "Description", dataIndex: "description" }),
          { title: "Quantity", dataIndex: "quantity", width: INVOICE_LINES_FIXED_WIDTHS[0], align: "right" },
          {
            title: "Unit price",
            dataIndex: "unit_price_minor",
            width: INVOICE_LINES_FIXED_WIDTHS[1],
            align: "right",
            render: lineMoney,
          },
          {
            title: "Subtotal",
            dataIndex: "line_subtotal_minor",
            width: INVOICE_LINES_FIXED_WIDTHS[2],
            align: "right",
            render: lineMoney,
          },
          {
            title: "Tax",
            dataIndex: "line_tax_minor",
            width: INVOICE_LINES_FIXED_WIDTHS[3],
            align: "right",
            render: lineMoney,
          },
        ]}
      />

      {/* The invoice's own totals, under its lines, as the New invoice form shows them. */}
      {invoice ? (
        <div style={{ textAlign: "right", marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
          <div>Subtotal: {money(invoice.subtotal_minor, invoice.currency_code)}</div>
          <div>Tax: {money(invoice.tax_total_minor, invoice.currency_code)}</div>
          <Typography.Text strong>Total: {money(invoice.total_minor, invoice.currency_code)}</Typography.Text>
        </div>
      ) : null}

      {invoice ? (
        <div style={{ margin: "16px 0" }}>
          <SettlementHistory
            totalMinor={invoice.total_minor}
            balanceDueMinor={invoice.balance_due_minor}
            currencyCode={invoice.currency_code}
            decimals={decimalsOf(invoice.currency_code)}
            events={ready?.settlements ?? []}
            loading={loading}
            emptyText="No payment, credit or write-off has been applied to this invoice yet."
          />
        </div>
      ) : null}

      {/* Last: who changed what, for the reader checking the record. */}
      {invoice ? (
        <DocumentAuditTrail
          record={invoice}
          directory={directory}
          entries={ready?.audit ?? []}
          loading={loading && canReadAudit}
          canReadAudit={canReadAudit}
        />
      ) : null}
    </Modal>
  );
}
