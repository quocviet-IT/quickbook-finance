"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  allocationFits,
  rankSettlementCandidates,
  settlementDirection,
  type RankedCandidate,
} from "@/lib/domain/bank-settlement";
import { formatMoney } from "@/lib/format";
import type { SettlementCandidateRow } from "@/lib/services/banking";
import {
  getSettlementCandidatesAction,
  settleFromBankTransactionAction,
  type SettlementCandidatesView,
} from "@/app/(app)/banking/actions";

/** Ranked, but still carrying the customer or vendor name the service fetched. */
type RankedRow = RankedCandidate<SettlementCandidateRow>;

export interface SettleTarget {
  id: string;
  txnDate: string;
  description: string;
  amountMinor: number;
  currencyCode: string | null;
  decimals: number;
}

/**
 * Turn a bank line into the receipt or bill payment it represents.
 *
 * The direction is not asked: money in can only settle invoices, money out only
 * bills, and the account the money moved through is the one the line arrived
 * on. What is left for a person to decide is which documents, and how much of
 * each — and that is the part no ranking should decide for them, because a
 * wrong guess here is a wrong payment against a real customer.
 *
 * Mounted per bank line by the caller (`key={target.id}`), so its state starts
 * clean for each one. That is also why the fetch below needs no reset: there is
 * nothing left over to reset.
 */
export default function SettleFromBankModal({
  target,
  onClose,
  onDone,
}: {
  target: SettleTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<SettlementCandidatesView | null>(null);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<string | null>(null);
  const [memo, setMemo] = useState("");

  const targetId = target.id;

  useEffect(() => {
    let cancelled = false;
    getSettlementCandidatesAction(targetId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok && result.data) setView(result.data);
      else message.error(result.error ?? "Failed to load open documents");
    });
    return () => {
      cancelled = true;
    };
  }, [targetId, message]);

  const direction = settlementDirection(target.amountMinor);
  const size = Math.abs(target.amountMinor);

  const ranked: RankedRow[] = useMemo(() => {
    if (!view) return [];
    return rankSettlementCandidates(
      target.amountMinor,
      target.txnDate,
      view.currencyCode,
      view.candidates,
    );
  }, [target, view]);

  const allocations = Object.entries(alloc)
    .map(([documentId, major]) => ({
      document_id: documentId,
      amount_minor: Math.round((major ?? 0) * 10 ** target.decimals),
    }))
    .filter((entry) => entry.amount_minor !== 0);

  const allocatedMinor = allocations.reduce(
    (sum, entry) => sum + entry.amount_minor,
    0,
  );
  const fits = allocationFits(
    size,
    allocations.map((entry) => entry.amount_minor),
  );
  const remainderMinor = size - allocatedMinor;

  const fmt = (minor: number) =>
    formatMoney(
      minor,
      view?.currencyCode ?? target.currencyCode ?? "USD",
      target.decimals,
    );

  async function submit() {
    if (!fits) return;
    setSaving(true);
    const result = await settleFromBankTransactionAction({
      bankTransactionId: target.id,
      allocations,
      method,
      memo: memo || null,
    });
    setSaving(false);
    if (result.ok) {
      message.success(
        direction === "receivable"
          ? "Receipt recorded and posted"
          : "Bill payment recorded and posted",
      );
      onDone();
    } else {
      message.error(result.error ?? "Failed to settle this transaction");
    }
  }

  return (
    <Modal
      title="Settle from bank transaction"
      open
      onOk={submit}
      onCancel={onClose}
      okText={direction === "receivable" ? "Record receipt" : "Record payment"}
      okButtonProps={{ disabled: !fits || loading }}
      confirmLoading={saving}
      width={860}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message={`${target.txnDate} · ${target.description} · ${fmt(target.amountMinor)}`}
          description={
            direction === "receivable"
              ? "Money in, so this can only settle open invoices. The receipt posts to the account this line arrived on."
              : "Money out, so this can only settle open bills. The payment posts from the account this line left."
          }
        />

        <Table<RankedRow>
          rowKey={(row) => row.candidate.documentId}
          size="small"
          loading={loading}
          pagination={{ pageSize: 8 }}
          dataSource={ranked}
          locale={{
            emptyText:
              direction === "receivable"
                ? "No open invoices in this account's currency"
                : "No open bills in this account's currency",
          }}
          columns={[
            {
              title: direction === "receivable" ? "Invoice" : "Bill",
              key: "document",
              render: (_v: unknown, row: RankedRow) => (
                <Space size={6}>
                  <span>{row.candidate.documentNumber ?? "—"}</span>
                  {row.exactAmount ? (
                    <Tag color="green">exact amount</Tag>
                  ) : null}
                </Space>
              ),
            },
            {
              title: direction === "receivable" ? "Customer" : "Vendor",
              key: "party",
              render: (_v: unknown, row: RankedRow) => row.candidate.partyName,
            },
            {
              title: "Date",
              key: "date",
              width: 110,
              render: (_v: unknown, row: RankedRow) =>
                row.candidate.documentDate,
            },
            {
              title: "Balance",
              key: "balance",
              align: "right",
              width: 140,
              render: (_v: unknown, row: RankedRow) =>
                fmt(row.candidate.balanceDueMinor),
            },
            {
              title: "Apply",
              key: "apply",
              width: 160,
              render: (_v: unknown, row: RankedRow) => (
                <InputNumber
                  min={0}
                  max={row.candidate.balanceDueMinor / 10 ** target.decimals}
                  precision={target.decimals}
                  style={{ width: 140 }}
                  value={alloc[row.candidate.documentId]}
                  onChange={(value) =>
                    setAlloc((prev) => ({
                      ...prev,
                      [row.candidate.documentId]: Number(value ?? 0),
                    }))
                  }
                />
              ),
            },
          ]}
        />

        <Space wrap size="middle">
          <Select
            allowClear
            placeholder="Method"
            style={{ width: 180 }}
            value={method ?? undefined}
            onChange={(value) => setMethod(value ?? null)}
            options={["cash", "bank_transfer", "card", "check"].map((m) => ({
              value: m,
              label: m,
            }))}
          />
          <Input
            placeholder="Memo"
            style={{ width: 380 }}
            maxLength={500}
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        </Space>

        <div style={{ textAlign: "right" }}>
          <Typography.Text
            type={allocatedMinor > size ? "danger" : "secondary"}
          >
            Allocated {fmt(allocatedMinor)} of {fmt(size)}
          </Typography.Text>
          {remainderMinor > 0 && allocatedMinor > 0 ? (
            <div>
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {fmt(remainderMinor)} stays unapplied on the{" "}
                {direction === "receivable" ? "customer's" : "vendor's"}{" "}
                account.
              </Typography.Text>
            </div>
          ) : null}
        </div>
      </Space>
    </Modal>
  );
}
