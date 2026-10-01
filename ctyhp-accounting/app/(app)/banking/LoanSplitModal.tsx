"use client";
import { useState } from "react";
import { InputNumber, Modal, Space, Typography } from "antd";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";

/**
 * The split of one loan payment. The interest can be changed to the lender's
 * figure; the principal is what is left and is not typed. The two accounts are
 * the loan's own, from Cards and loans. Mounted only while open, so it starts
 * from the proposal every time.
 */
export default function LoanSplitModal({
  paymentMinor,
  initialInterestMinor,
  basis,
  loanAccountLabel,
  interestAccountLabel,
  okText,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: {
  /** The payment, as a positive number. */
  paymentMinor: number;
  initialInterestMinor: number | null;
  basis: string;
  loanAccountLabel: string;
  interestAccountLabel: string;
  okText: string;
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (interestMinor: number) => void;
}) {
  const [interest, setInterest] = useState<number | null>(initialInterestMinor === null ? null : initialInterestMinor / 100);
  const interestMinor = interest === null ? null : Math.round(interest * 100);
  const valid = interestMinor !== null && interestMinor >= 0 && interestMinor <= paymentMinor;
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

  return (
    <Modal
      open
      title="Split loan payment"
      okText={okText}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => {
        if (valid && interestMinor !== null) onConfirm(interestMinor);
      }}
      width={520}
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Typography.Text>
          Payment <Typography.Text strong>{money(paymentMinor)}</Typography.Text>
        </Typography.Text>
        <div>
          <Typography.Text strong style={{ display: "block" }}>
            Interest to {interestAccountLabel}
          </Typography.Text>
          <InputNumber
            aria-label="Interest"
            min={0}
            max={paymentMinor / 100}
            precision={2}
            prefix="$"
            value={interest}
            onChange={(value) => setInterest(value === null ? null : Number(value))}
            style={{ width: 180 }}
          />
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {basis}
          </Typography.Text>
        </div>
        <Typography.Text>
          Principal to {loanAccountLabel}:{" "}
          <Typography.Text strong>{valid && interestMinor !== null ? money(paymentMinor - interestMinor) : "—"}</Typography.Text>
        </Typography.Text>
      </Space>
    </Modal>
  );
}
