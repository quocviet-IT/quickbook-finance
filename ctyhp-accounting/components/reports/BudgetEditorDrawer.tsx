"use client";

import { useEffect, useState } from "react";
import { App, Button, Drawer, InputNumber, Select, Space, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import type { BudgetAccountAmount } from "@/lib/domain/reports";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import { fromMinor, toMinor } from "@/lib/domain/money";
import {
  getBudgetMonthAction,
  saveBudgetMonthAction,
} from "@/app/(app)/reports/actions";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  income: "Income",
  cost_of_goods_sold: "Cost of Goods Sold",
  expense: "Expense",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

export default function BudgetEditorDrawer({
  open,
  onClose,
  onSaved,
  fiscalYear,
  months,
  baseCurrency,
  baseDecimals,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  fiscalYear: number;
  months: FiscalMonth[];
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [periodStart, setPeriodStart] = useState(months[0]?.start ?? "");
  const [accounts, setAccounts] = useState<BudgetAccountAmount[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !periodStart) return;
    let active = true;
    // Opening or changing the month intentionally synchronizes the editor with the database.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void getBudgetMonthAction(fiscalYear, periodStart).then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Failed to load budget month");
        return;
      }
      setAccounts(result.data);
      setValues(
        Object.fromEntries(
          result.data.map((account) => [
            account.accountId,
            fromMinor(account.amountMinor, baseDecimals),
          ]),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [open, fiscalYear, periodStart, baseDecimals, message]);

  const save = async () => {
    setSaving(true);
    const result = await saveBudgetMonthAction({
      fiscal_year: fiscalYear,
      period_start: periodStart,
      lines: accounts.map((account) => ({
        account_id: account.accountId,
        amount_minor: toMinor(values[account.accountId] ?? 0, baseDecimals),
      })),
    });
    setSaving(false);
    if (!result.ok) {
      message.error(result.error ?? "Failed to save budget");
      return;
    }
    message.success(`Budget saved for ${months.find((month) => month.start === periodStart)?.label ?? periodStart}`);
    onSaved();
  };

  return (
    <Drawer
      title={`FY ${fiscalYear} monthly budget`}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} disabled={loading} onClick={() => void save()}>
            Save month
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Typography.Text strong>Budget month</Typography.Text>
          <Typography.Paragraph type="secondary" className="report-editor-help">
            Enter natural-balance amounts in {baseCurrency}. Saving replaces this month only and records the change in the audit log.
          </Typography.Paragraph>
          <Select
            aria-label="Budget month"
            value={periodStart}
            style={{ width: 220 }}
            options={months.map((month) => ({ value: month.start, label: month.label }))}
            onChange={setPeriodStart}
          />
        </div>
        <DataTable<BudgetAccountAmount>
          rowKey="accountId"
          dataSource={accounts}
          loading={loading}
          pagination={false}
          emptyTitle="No Profit and Loss accounts"
          emptyDescription="Create active posting accounts before entering a budget."
          columns={[
            {
              title: "Account",
              render: (_, row) => (
                <span>
                  <strong>{row.accountCode}</strong> — {row.name}
                </span>
              ),
            },
            {
              title: "Classification",
              width: 160,
              render: (_, row) => <Tag>{ACCOUNT_TYPE_LABELS[row.accountType] ?? row.accountType}</Tag>,
            },
            {
              title: `Budget (${baseCurrency})`,
              width: 190,
              align: "right",
              render: (_, row) => (
                <InputNumber
                  aria-label={`${row.accountCode} ${row.name} budget`}
                  value={values[row.accountId] ?? 0}
                  precision={baseDecimals}
                  step={1 / 10 ** baseDecimals}
                  style={{ width: 160 }}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [row.accountId]: Number(value ?? 0),
                    }))
                  }
                />
              ),
            },
          ]}
        />
      </Space>
    </Drawer>
  );
}
