"use client";
import { useEffect, useState } from "react";
import { Alert, Descriptions, Drawer, Tag, Typography } from "antd";
import { PAID_LABELS, humanizeStatus, statusLabel } from "@/lib/domain/status-label";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import type { AuditEntryRow, PaymentAllocationView, PaymentDetail, PaymentJournalLine, PaymentRow } from "@/lib/db/types";
import { formatDate, formatMoney } from "@/lib/format";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { getPaymentDrawerAction } from "./actions";

/** The drawer's width; its body, where the tables sit, is 48px less. */
export const PAYMENT_DRAWER_WIDTH = 720;

/**
 * Invoices settled: Applied, Invoice balance now (a heading 19 letters long,
 * which is why it takes a picker's width) and Invoice status. The invoice
 * number takes what is left, at least COLUMN.TEXT_MIN.
 */
export const PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.PICKER, COLUMN.STATUS] as const;

/** The journal entry's lines: Debit and Credit. The account takes what is left, at least COLUMN.TEXT_MIN. */
export const PAYMENT_DRAWER_JOURNAL_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.MONEY] as const;

export interface PaymentDetailDrawerProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  directory: ReadonlyMap<string, string>;
  canReadAudit: boolean;
  decimalsOf: (currencyCode: string) => number;
  onClose: () => void;
}

/**
 * What a receipt did, in one place: the money, the invoices it settled, the
 * entry it posted, and every change since. An auditor should never have to
 * rebuild this from the journal by record id.
 */
export default function PaymentDetailDrawer({
  payment,
  directory,
  canReadAudit,
  decimalsOf,
  onClose,
}: PaymentDetailDrawerProps) {
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payment) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      // One request: Next runs Server Actions one at a time, so the detail and
      // the history sent as two actions were two trips in a row.
      const { detail: detailResult, audit: auditResult } = await getPaymentDrawerAction(
        { id: payment.id, journal_entry_id: payment.journal_entry_id },
        canReadAudit,
      );
      if (cancelled) return;
      setLoading(false);
      if (detailResult.ok && detailResult.data) {
        setDetail(detailResult.data);
        setError(null);
      } else {
        setDetail(null);
        setError(detailResult.error ?? "Failed to load this payment");
      }
      setAudit(auditResult?.ok && auditResult.data ? auditResult.data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [payment, canReadAudit]);

  const decimals = payment ? decimalsOf(payment.currency_code) : 2;

  return (
    <Drawer
      title={`Payment ${payment?.payment_number ?? "(unnumbered)"}`}
      open={!!payment}
      onClose={onClose}
      width={PAYMENT_DRAWER_WIDTH}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Customer">{payment.customer_name}</Descriptions.Item>
            <Descriptions.Item label="Date">{formatDate(payment.payment_date)}</Descriptions.Item>
            <Descriptions.Item label="Method">{humanizeStatus(payment.method)}</Descriptions.Item>
            <Descriptions.Item label="Reference">{payment.reference ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Amount">
              {formatMoney(payment.amount_minor, payment.currency_code, decimals)}
            </Descriptions.Item>
            <Descriptions.Item label="Unapplied">
              {formatMoney(payment.unapplied_minor, payment.currency_code, decimals)}
            </Descriptions.Item>
            <Descriptions.Item label="Memo" span={2}>
              {payment.memo ?? "—"}
            </Descriptions.Item>
          </Descriptions>

          {payment.status === "void" ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message="This payment is void"
              description={payment.void_reason ?? "No reason was recorded."}
            />
          ) : null}

          {error ? (
            <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />
          ) : null}

          <Typography.Text strong>Invoices settled</Typography.Text>
          <DataTable<PaymentAllocationView>
            rowKey="invoiceId"
            pagination={false}
            style={{ margin: "8px 0 16px" }}
            loading={loading}
            rows={detail?.allocations ?? []}
            locale={{ emptyText: "This receipt was not applied to any invoice." }}
            columns={[
              flexColumn<PaymentAllocationView>({
                title: "Invoice",
                dataIndex: "invoiceNumber",
                render: (n: string | null) => n ?? "—",
              }),
              {
                title: "Applied",
                dataIndex: "amountMinor",
                width: PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS[0],
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              {
                title: "Invoice balance now",
                dataIndex: "invoiceBalanceMinor",
                width: PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS[1],
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              {
                title: "Invoice status",
                dataIndex: "invoiceStatus",
                width: PAYMENT_DRAWER_ALLOCATIONS_FIXED_WIDTHS[2],
                render: (s: string) => statusLabel(s, { labels: PAID_LABELS }),
              },
            ]}
          />

          <Typography.Text strong>
            Journal entry{" "}
            {detail?.journal ? (
              <Tag color={detail.journal.status === "posted" ? "green" : "red"}>
                {detail.journal.entryNumber} · {statusLabel(detail.journal.status)}
              </Tag>
            ) : null}
          </Typography.Text>
          <DataTable<PaymentJournalLine>
            rowKey={(row) => `${row.accountCode}-${row.debitMinor}-${row.creditMinor}`}
            pagination={false}
            style={{ margin: "8px 0 16px" }}
            loading={loading}
            rows={detail?.journal?.lines ?? []}
            locale={{ emptyText: "This receipt did not post a journal entry." }}
            columns={[
              flexColumn<PaymentJournalLine>({
                title: "Account",
                key: "account",
                render: (_: unknown, r) => `${r.accountCode} — ${r.accountName}`,
              }),
              {
                title: "Debit",
                dataIndex: "debitMinor",
                width: PAYMENT_DRAWER_JOURNAL_FIXED_WIDTHS[0],
                align: "right",
                render: (v: number) => (v ? formatMoney(v, payment.currency_code, decimals) : "—"),
              },
              {
                title: "Credit",
                dataIndex: "creditMinor",
                width: PAYMENT_DRAWER_JOURNAL_FIXED_WIDTHS[1],
                align: "right",
                render: (v: number) => (v ? formatMoney(v, payment.currency_code, decimals) : "—"),
              },
            ]}
          />

          <DocumentAuditTrail
            record={payment}
            directory={directory}
            entries={audit}
            loading={loading}
            canReadAudit={canReadAudit}
          />
        </>
      ) : null}
    </Drawer>
  );
}
