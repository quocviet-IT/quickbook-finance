"use client";
import { useEffect, useMemo, useState } from "react";
import { App, InputNumber, Modal, Select, Space, Typography } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { recordRefundAction } from "./actions";
import type { AccountRow } from "@/lib/db/types";

export interface RefundSource {
  kind: "payment" | "credit_memo";
  id: string;
  label: string;
  remainingMinor: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  customerId: string;
  currency: string;
  baseDecimals: number;
  bankAccounts: Pick<AccountRow, "id" | "account_code" | "name">[];
  sources: RefundSource[];
}

export default function RefundModal({
  open,
  onClose,
  onDone,
  customerId,
  currency,
  baseDecimals,
  bankAccounts,
  sources,
}: Props) {
  const { message } = App.useApp();
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState<number | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const first = sources[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSourceId(first?.id);
      setAmount(first ? fromMinor(first.remainingMinor, baseDecimals) : null);
      setBankAccountId(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const source = useMemo(() => sources.find((s) => s.id === sourceId), [sources, sourceId]);
  const maxAmount = source ? fromMinor(source.remainingMinor, baseDecimals) : 0;
  const valid = !!source && (amount ?? 0) > 0 && (amount ?? 0) <= maxAmount && !!bankAccountId;

  function onSourceChange(id: string) {
    setSourceId(id);
    const s = sources.find((x) => x.id === id);
    setAmount(s ? fromMinor(s.remainingMinor, baseDecimals) : null);
  }

  async function submit() {
    if (!valid || !source) return;
    setSaving(true);
    const res = await recordRefundAction({
      customer_id: customerId,
      currency_code: currency,
      amount_minor: toMinor(amount ?? 0, baseDecimals),
      source_type: source.kind,
      payment_id: source.kind === "payment" ? source.id : null,
      credit_memo_id: source.kind === "credit_memo" ? source.id : null,
      bank_account_id: bankAccountId,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Refund recorded");
      onClose();
      onDone();
    } else {
      message.error(res.error ?? "Failed to record refund");
    }
  }

  return (
    <Modal
      title="Refund customer"
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={saving}
      okButtonProps={{ disabled: !valid }}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Typography.Text>Source</Typography.Text>
          <Select
            style={{ width: "100%" }}
            placeholder="Select a source"
            value={sourceId}
            options={sources.map((s) => ({ value: s.id, label: s.label }))}
            onChange={onSourceChange}
          />
        </div>
        {source && (
          <Typography.Text type="secondary">
            Remaining: {maxAmount.toLocaleString(undefined, { minimumFractionDigits: baseDecimals })} {currency}
          </Typography.Text>
        )}
        <div>
          <Typography.Text>Amount</Typography.Text>
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            max={maxAmount}
            precision={baseDecimals}
            value={amount ?? undefined}
            onChange={(v) => setAmount(v as number | null)}
          />
        </div>
        <div>
          <Typography.Text>Bank account</Typography.Text>
          <Select
            style={{ width: "100%" }}
            showSearch
            optionFilterProp="label"
            placeholder="Select a bank account"
            value={bankAccountId}
            options={bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
            onChange={setBankAccountId}
          />
        </div>
      </Space>
    </Modal>
  );
}
