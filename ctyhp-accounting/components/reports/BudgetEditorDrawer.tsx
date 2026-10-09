"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Drawer, InputNumber, Select, Space, Typography } from "antd";
import {
  GRID_MONTHS,
  GRID_WIDTHS,
  dirtyMonths,
  monthLines,
  plannedSummary,
  runBudgetSave,
  saveOutcomeMessage,
  seedFromActuals,
  spreadYear,
  yearTotal,
  type BudgetGridValues,
  type GridAccount,
} from "@/lib/domain/budget-grid";
import type { FiscalMonth } from "@/lib/domain/fiscal";
import { formatMoney } from "@/lib/format";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { getBudgetGridAction, saveBudgetMonthAction } from "@/app/(app)/reports/actions";
import type { BudgetGridData } from "@/lib/services/budgets";
import styles from "./budget-grid.module.css";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  income: "Income",
  cost_of_goods_sold: "Cost of Goods Sold",
  expense: "Expense",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

const LOAD_PROBLEM = "The budget could not be read. Close this and try again.";

const zeros = (): number[] => new Array<number>(GRID_MONTHS).fill(0);
const byCode = (a: GridAccount, b: GridAccount) => a.accountCode.localeCompare(b.accountCode);

/**
 * The whole year's budget in one grid: a row per account, a cell per month and
 * a Year cell that spreads itself evenly over the months. Nothing is saved
 * until Save, which sends the months that changed, one at a time.
 */
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
  /** Called after every save that wrote at least one month; `complete` is false when a month failed. */
  onSaved: (outcome: { complete: boolean }) => void;
  fiscalYear: number;
  months: FiscalMonth[];
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message, modal } = App.useApp();
  const [data, setData] = useState<BudgetGridData | null>(null);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [values, setValues] = useState<BudgetGridValues>({});
  const [baseline, setBaseline] = useState<BudgetGridValues>({});
  const [uplift, setUplift] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // The cleanup below ends this open: an answer that arrives after the drawer
    // closed, reopened or changed year is ignored.
    let active = true;
    // Opening the grid intentionally resets it and synchronizes it with the database.
    /* eslint-disable react-hooks/set-state-in-effect */
    setData(null);
    setValues({});
    setBaseline({});
    setRowIds([]);
    setUplift(0);
    setProblem(null);
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      try {
        const result = await getBudgetGridAction(fiscalYear);
        if (!active) return;
        if (!result.ok || !result.data) {
          setProblem(LOAD_PROBLEM);
          return;
        }
        const loaded = result.data;
        setData(loaded);
        setBaseline(Object.fromEntries(Object.entries(loaded.budget).map(([id, row]) => [id, [...row]])));
        setValues(Object.fromEntries(Object.entries(loaded.budget).map(([id, row]) => [id, [...row]])));
        setRowIds(
          loaded.accounts
            .filter((account) => loaded.budget[account.accountId])
            .sort(byCode)
            .map((account) => account.accountId),
        );
      } catch {
        if (active) setProblem(LOAD_PROBLEM);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, fiscalYear]);

  const accountById = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.accountId, a])), [data]);
  const rows = useMemo(
    () => rowIds.map((id) => accountById.get(id)).filter((a): a is GridAccount => Boolean(a)),
    [rowIds, accountById],
  );
  const addable = useMemo(
    () => (data?.accounts ?? []).filter((a) => !rowIds.includes(a.accountId)).sort(byCode),
    [data, rowIds],
  );
  const summary = useMemo(() => plannedSummary(rows, values), [rows, values]);
  const dirty = useMemo(() => dirtyMonths(baseline, values), [baseline, values]);
  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  const setCell = (accountId: string, index: number, minor: number) =>
    setValues((current) => {
      const row = [...(current[accountId] ?? zeros())];
      row[index] = minor;
      return { ...current, [accountId]: row };
    });
  const setYear = (accountId: string, minor: number) =>
    setValues((current) => ({ ...current, [accountId]: spreadYear(minor) }));

  const startFrom = (source: "lastYear" | "thisYear") => {
    if (!data) return;
    const seeded = seedFromActuals(data[source], uplift);
    const ids = new Set([...rowIds, ...Object.keys(seeded)]);
    const nextRows = [...ids].map((id) => accountById.get(id)).filter((a): a is GridAccount => Boolean(a)).sort(byCode);
    setRowIds(nextRows.map((a) => a.accountId));
    setValues(Object.fromEntries(nextRows.map((a) => [a.accountId, seeded[a.accountId] ?? zeros()])));
    setProblem(null);
  };

  const confirmClear = () =>
    modal.confirm({
      title: `Clear FY ${fiscalYear}?`,
      content: "This empties every month in the grid. Nothing changes in the books until you press Save.",
      okText: "Clear this year",
      okButtonProps: { danger: true },
      cancelText: "Keep it",
      onOk: () => {
        setValues(Object.fromEntries(rowIds.map((id) => [id, zeros()])));
        setProblem(null);
      },
    });

  const addAccount = (accountId: string) => {
    setRowIds((current) => (current.includes(accountId) ? current : [...current, accountId]));
    setValues((current) => ({ ...current, [accountId]: current[accountId] ?? zeros() }));
  };

  const save = async () => {
    if (dirty.length === 0) {
      message.info("No changes to save.");
      return;
    }
    setSaving(true);
    setProblem(null);
    const outcome = await runBudgetSave(
      dirty.map((index) => ({ index, label: months[index].label })),
      (month) =>
        saveBudgetMonthAction({
          fiscal_year: fiscalYear,
          period_start: months[month.index].start,
          lines: monthLines(values, month.index),
        }),
    );
    setSaving(false);
    // What was written is now what the database holds: only the rest still counts as changed.
    const writtenLabels = new Set(outcome.saved);
    const written = dirty.filter((index) => writtenLabels.has(months[index].label));
    if (written.length > 0) {
      setBaseline((current) => {
        const next: BudgetGridValues = {};
        for (const id of new Set([...Object.keys(current), ...Object.keys(values)])) {
          const row = [...(current[id] ?? zeros())];
          for (const index of written) row[index] = values[id]?.[index] ?? 0;
          next[id] = row;
        }
        return next;
      });
    }
    if (outcome.failed) {
      setProblem(saveOutcomeMessage(outcome));
    } else {
      message.success(saveOutcomeMessage(outcome));
    }
    if (written.length > 0) onSaved({ complete: !outcome.failed });
  };

  /** Every way out of the drawer comes through here: unsaved typing is never thrown away unasked. */
  const requestClose = () => {
    if (saving) return;
    if (dirty.length === 0) {
      onClose();
      return;
    }
    modal.confirm({
      title: "Discard the changes you have not saved?",
      okText: "Discard",
      okButtonProps: { danger: true },
      cancelText: "Keep editing",
      onOk: onClose,
    });
  };

  const inputProps = {
    controls: false,
    min: 0,
    precision: baseDecimals,
    className: styles.amount,
  } as const;

  return (
    <Drawer
      title={`FY ${fiscalYear} budget`}
      open={open}
      onClose={requestClose}
      maskClosable={!saving}
      keyboard={!saving}
      closable={!saving}
      width="min(1500px, 96vw)"
      destroyOnHidden
      extra={
        <Space>
          <Button disabled={saving} onClick={requestClose}>
            Close
          </Button>
          <Button type="primary" loading={saving} disabled={loading || !data || dirty.length === 0} onClick={() => void save()}>
            {dirty.length === 0 ? "Save" : `Save ${dirty.length} ${dirty.length === 1 ? "month" : "months"}`}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" className="report-editor-help">
        Enter amounts in {baseCurrency}, positive for income and for spending alike. A Year figure is spread evenly over
        the twelve months, with any rounding remainder in the first. Saving replaces each changed month and records it
        in the audit log.
      </Typography.Paragraph>

      {problem ? <Alert className={styles.notice} type="error" showIcon title={problem} /> : null}

      <div className={styles.tools}>
        <Button disabled={loading || !data} onClick={() => startFrom("lastYear")}>
          Start from last year’s actuals
        </Button>
        <Button disabled={loading || !data} onClick={() => startFrom("thisYear")}>
          Start from this year’s actuals
        </Button>
        <label className={styles.uplift}>
          Uplift
          <InputNumber
            aria-label="Uplift percent"
            value={uplift}
            step={1}
            precision={1}
            style={{ width: 90 }}
            suffix="%"
            onChange={(value) => setUplift(Number(value ?? 0))}
          />
        </label>
        <Button danger disabled={loading || rows.length === 0} onClick={confirmClear}>
          Clear this year
        </Button>
        <Select
          showSearch
          aria-label="Add an account"
          placeholder="Add an account"
          value={null}
          style={{ width: 280, marginLeft: "auto" }}
          disabled={loading || addable.length === 0}
          optionFilterProp="label"
          options={addable.map((a) => ({
            value: a.accountId,
            label: `${a.accountCode} — ${a.name} (${ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType})`,
          }))}
          onChange={(id) => id && addAccount(id)}
        />
      </div>

      <div className={styles.scroll}>
        <table className={styles.grid} style={{ width: GRID_WIDTHS.total, minWidth: GRID_WIDTHS.total }}>
          <colgroup>
            <col style={{ width: GRID_WIDTHS.account }} />
            {months.map((month) => (
              <col key={month.start} style={{ width: GRID_WIDTHS.month }} />
            ))}
            <col style={{ width: GRID_WIDTHS.year }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.account}>Account</th>
              {months.map((month) => (
                <th key={month.start} title={month.label}>
                  {month.label.split(" ")[0]}
                </th>
              ))}
              <th className={styles.year}>Year</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className={styles.empty} colSpan={months.length + 2}>
                  Reading the budget…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={months.length + 2}>
                  Nothing is budgeted for FY {fiscalYear} yet. Add an account, or start from actuals.
                </td>
              </tr>
            ) : (
              rows.map((account) => {
                const row = values[account.accountId] ?? zeros();
                return (
                  <tr key={account.accountId}>
                    <td
                      className={styles.account}
                      title={`${account.accountCode} — ${account.name} (${ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType})`}
                    >
                      <strong>{account.accountCode}</strong> {account.name}
                    </td>
                    {months.map((month, index) => (
                      <td key={month.start}>
                        <InputNumber
                          {...inputProps}
                          aria-label={`${account.accountCode} ${account.name}, ${month.label}`}
                          value={fromMinor(row[index] ?? 0, baseDecimals)}
                          onChange={(value) => setCell(account.accountId, index, toMinor(Number(value ?? 0), baseDecimals))}
                        />
                      </td>
                    ))}
                    <td className={styles.year}>
                      <InputNumber
                        {...inputProps}
                        aria-label={`${account.accountCode} ${account.name}, year ${fiscalYear}`}
                        value={fromMinor(yearTotal(row), baseDecimals)}
                        onChange={(value) => setYear(account.accountId, toMinor(Number(value ?? 0), baseDecimals))}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.summary} aria-live="polite">
        <span>
          Planned income<strong>{money(summary.income)}</strong>
        </span>
        <span>
          Planned spending<strong>{money(summary.spending)}</strong>
        </span>
        <span>
          Planned result<strong>{money(summary.result)}</strong>
        </span>
      </div>
    </Drawer>
  );
}
