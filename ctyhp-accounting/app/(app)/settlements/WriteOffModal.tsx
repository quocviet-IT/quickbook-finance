"use client";
import { useEffect, useState } from "react";
import { App, Input, InputNumber, Modal, Select, Space, Typography } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { writeOffAction } from "./actions";
import type { AccountRow } from "@/lib/db/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  side: "ar" | "ap";
  targetId: string;
  currency: string;
  balanceMinor: number;
  baseDecimals: number;
  offsetAccounts: Pick<AccountRow, "id" | "account_code" | "name">[];
}

export default function WriteOffModal({
  open,
  onClose,
  onDone,
  side,
  targetId,
  currency,
  balanceMinor,
  baseDecimals,
  offsetAccounts,
}: Props) {
  const { message } = App.useApp();
  const [amount, setAmount] = useState<number | null>(null);
  const [offsetAccountId, setOffsetAccountId] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount(fromMinor(balanceMinor, baseDecimals));
      setOffsetAccountId(undefined);
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const maxAmount = fromMinor(balanceMinor, baseDecimals);
  const valid = (amount ?? 0) > 0 && (amount ?? 0) <= maxAmount && !!offsetAccountId && reason.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setSaving(true);
    const res = await writeOffAction({
      side,
      invoice_id: side === "ar" ? targetId : null,
      bill_id: side === "ap" ? targetId : null,
      offset_account_id: offsetAccountId,
      amount_minor: toMinor(amount ?? 0, baseDecimals),
      reason: reason.trim(),
    });
    setSaving(false);
    if (res.ok) {
      message.success("Write-off recorded");
      onClose();
      onDone();
    } else {
      message.error(res.error ?? "Failed to record write-off");
    }
  }

  return (
    <Modal
      title="Write off"
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={saving}
      okButtonProps={{ disabled: !valid }}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Typography.Text type="secondary">
          Balance: {maxAmount.toLocaleString(undefined, { minimumFractionDigits: baseDecimals })} {currency}
        </Typography.Text>
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
          <Typography.Text>Offset account</Typography.Text>
          <Select
            style={{ width: "100%" }}
            showSearch
            optionFilterProp="label"
            placeholder="Select an offset account"
            value={offsetAccountId}
            options={offsetAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
            onChange={setOffsetAccountId}
          />
        </div>
        <div>
          <Typography.Text>Reason</Typography.Text>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
        </div>
      </Space>
    </Modal>
  );
}
