"use client";
import { useEffect, useState } from "react";
import { Alert, Descriptions, Drawer, Table, Tag, Typography } from "antd";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import type { AuditEntryRow, PaymentDetail, PaymentRow } from "@/lib/db/types";
import { formatMoney } from "@/lib/format";
import { getPaymentAuditAction, getPaymentDetailAction } from "./actions";

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
      const [detailResult, auditResult] = await Promise.all([
        getPaymentDetailAction({ id: payment.id, journal_entry_id: payment.journal_entry_id }),
        canReadAudit ? getPaymentAuditAction(payment.id) : Promise.resolve(null),
      ]);
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
      width={720}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Customer">{payment.customer_name}</Descriptions.Item>
            <Descriptions.Item label="Date">{payment.payment_date}</Descriptions.Item>
            <Descriptions.Item label="Method">{payment.method ?? "—"}</Descriptions.Item>
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
          <Table
            rowKey="invoiceId"
            size="small"
            pagination={false}
            style={{ margin: "8px 0 16px" }}
            loading={loading}
            dataSource={detail?.allocations ?? []}
            locale={{ emptyText: "This receipt was not applied to any invoice." }}
            columns={[
              {
                title: "Invoice",
                dataIndex: "invoiceNumber",
                render: (n: string | null) => n ?? "—",
              },
              {
                title: "Applied",
                dataIndex: "amountMinor",
                width: 140,
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              {
                title: "Invoice balance now",
                dataIndex: "invoiceBalanceMinor",
                width: 170,
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              { title: "Invoice status", dataIndex: "invoiceStatus", width: 130 },
            ]}
          />

          <Typography.Text strong>
            Journal entry{" "}
            {detail?.journal ? (
              <Tag color={detail.journal.status === "posted" ? "green" : "red"}>
                {detail.journal.entryNumber} · {detail.journal.status}
              </Tag>
            ) : null}
          </Typography.Text>
          <Table
            rowKey={(row) => `${row.accountCode}-${row.debitMinor}-${row.creditMinor}`}
            size="small"
            pagination={false}
            style={{ margin: "8px 0 16px" }}
            loading={loading}
            dataSource={detail?.journal?.lines ?? []}
            locale={{ emptyText: "This receipt did not post a journal entry." }}
            columns={[
              {
                title: "Account",
                key: "account",
                render: (_: unknown, r) => `${r.accountCode} — ${r.accountName}`,
              },
              {
                title: "Debit",
                dataIndex: "debitMinor",
                width: 130,
                align: "right",
                render: (v: number) => (v ? formatMoney(v, payment.currency_code, decimals) : "—"),
              },
              {
                title: "Credit",
                dataIndex: "creditMinor",
                width: 130,
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
