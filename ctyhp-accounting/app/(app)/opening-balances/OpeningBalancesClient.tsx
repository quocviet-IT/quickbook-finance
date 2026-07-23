"use client";
import { useMemo, useState } from "react";
import { App, Alert, Button, DatePicker, InputNumber, Select, Space, Table } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { buildOpeningBalancePosting } from "@/lib/domain/posting";
import { postOpeningBalancesAction } from "./actions";

const EQUITY_SENTINEL = "__opening_balance_equity";

interface Account {
  id: string;
  account_code: string;
  name: string;
}
interface Props {
  canWrite: boolean;
  accounts: Account[];
  baseCurrency: string;
  baseDecimals: number;
}
interface Row {
  key: number;
  account_id?: string;
  debit?: number;
  credit?: number;
}

export default function OpeningBalancesClient({ canWrite, accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([{ key: 0 }, { key: 1 }]);
  const [asOf, setAsOf] = useState<import("dayjs").Dayjs | null>(null);
  const [posting, setPosting] = useState(false);

  const totals = useMemo(() => {
    const d = rows.reduce((s, r) => s + toMinor(r.debit ?? 0, baseDecimals), 0);
    const c = rows.reduce((s, r) => s + toMinor(r.credit ?? 0, baseDecimals), 0);
    const lines = rows
      .map((r) => ({
        accountId: r.account_id ?? `__row${r.key}`,
        debitMinor: toMinor(r.debit ?? 0, baseDecimals),
        creditMinor: toMinor(r.credit ?? 0, baseDecimals),
      }))
      .filter((l) => l.debitMinor !== 0 || l.creditMinor !== 0);
    let equity = 0;
    try {
      const posting = buildOpeningBalancePosting(lines, EQUITY_SENTINEL);
      const equityLine = posting.find((l) => l.accountId === EQUITY_SENTINEL);
      if (equityLine) {
        equity = equityLine.creditMinor > 0 ? equityLine.creditMinor : -equityLine.debitMinor;
      }
    } catch {
      // Posting builder rejected the draft lines (e.g. still unbalanced/invalid);
      // treat as indeterminate here rather than re-deriving the equity amount —
      // the posting rule lives only in lib/domain (buildOpeningBalancePosting).
      equity = 0;
    }
    return { d, c, equity };
  }, [rows, baseDecimals]);

  const fmt = (m: number) => fromMinor(Math.abs(m), baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const post = async () => {
    setPosting(true);
    const r = await postOpeningBalancesAction({
      as_of: asOf?.format("YYYY-MM-DD"),
      currency_code: baseCurrency,
      lines: rows
        .filter((x) => x.account_id)
        .map((x) => ({
          account_id: x.account_id!,
          debit_minor: toMinor(x.debit ?? 0, baseDecimals),
          credit_minor: toMinor(x.credit ?? 0, baseDecimals),
        })),
    });
    setPosting(false);
    if (r.ok) {
      message.success("Opening balances posted");
      setRows([{ key: 0 }, { key: 1 }]);
    } else {
      message.error(r.error ?? "Failed to post");
    }
  };

  const update = (key: number, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <DatePicker placeholder="As-of date" value={asOf} onChange={setAsOf} />
      <Table
        rowKey="key"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: "Account",
            render: (_, r) => (
              <Select
                showSearch
                style={{ width: 320 }}
                placeholder="Account"
                optionFilterProp="label"
                value={r.account_id}
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => update(r.key, { account_id: v })}
              />
            ),
          },
          {
            title: "Debit",
            align: "right",
            render: (_, r) => (
              <InputNumber
                min={0}
                precision={baseDecimals}
                value={r.debit}
                onChange={(v) => update(r.key, { debit: v ?? undefined, credit: undefined })}
              />
            ),
          },
          {
            title: "Credit",
            align: "right",
            render: (_, r) => (
              <InputNumber
                min={0}
                precision={baseDecimals}
                value={r.credit}
                onChange={(v) => update(r.key, { credit: v ?? undefined, debit: undefined })}
              />
            ),
          },
        ]}
        footer={() => <Button onClick={() => setRows((p) => [...p, { key: (p.at(-1)?.key ?? 0) + 1 }])}>Add row</Button>}
      />
      <Alert
        type={totals.equity === 0 ? "success" : "info"}
        message={
          totals.equity === 0
            ? `Balanced. Debit = Credit = ${fmt(totals.d)} ${baseCurrency}.`
            : `Opening Balance Equity will absorb ${fmt(totals.equity)} ${baseCurrency} on the ${totals.equity > 0 ? "credit" : "debit"} side to balance.`
        }
      />
      {canWrite && (
        <Button type="primary" loading={posting} disabled={!asOf || totals.d + totals.c === 0} onClick={post}>
          Post opening balances
        </Button>
      )}
    </Space>
  );
}
