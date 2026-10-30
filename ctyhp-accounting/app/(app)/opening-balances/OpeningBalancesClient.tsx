"use client";
import { useMemo, useState, type ReactNode } from "react";
import { App, Button, DatePicker, InputNumber, Select, Space, Tooltip, Typography } from "antd";
import { CheckCircleFilled, ClockCircleOutlined, InfoCircleFilled, InfoCircleOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { toMinor } from "@/lib/domain/money";
import { formatMoney } from "@/lib/format";
import { reviewOpeningDraft, type OpeningDraftReview } from "@/lib/domain/opening-balances";
import DataTable from "@/components/ui/DataTable";
import FormActions from "@/components/ui/FormActions";
import { COLUMN } from "@/lib/design/table-metrics";
import { postOpeningBalancesAction } from "./actions";

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

/**
 * Line, Debit and Credit (a number input each). Account is a select, so it
 * takes what is left, at least COLUMN.RICH_MIN.
 */
export const OPENING_BALANCES_FIXED_WIDTHS = [COLUMN.QTY, COLUMN.PICKER, COLUMN.PICKER] as const;

const CONDITIONS_ID = "opening-balances-conditions";

export default function OpeningBalancesClient({ canWrite, accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([{ key: 0 }, { key: 1 }]);
  const [asOf, setAsOf] = useState<Dayjs | null>(null);
  const [posting, setPosting] = useState(false);

  const review = useMemo(
    () =>
      reviewOpeningDraft(
        rows.map((r, index) => ({
          line: index + 1,
          accountId: r.account_id ?? null,
          debitMinor: toMinor(r.debit ?? 0, baseDecimals),
          creditMinor: toMinor(r.credit ?? 0, baseDecimals),
        })),
        asOf ? asOf.format("YYYY-MM-DD") : null,
      ),
    [rows, asOf, baseDecimals],
  );

  const fmt = (m: number) => formatMoney(Math.abs(m), baseCurrency, baseDecimals);

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
  const unmet = review.conditions.filter((c) => !c.met);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <DatePicker
        aria-label="As of"
        prefix={<Typography.Text type="secondary">As of</Typography.Text>}
        placeholder="MM/DD/YYYY"
        value={asOf}
        onChange={setAsOf}
        style={{ width: 220 }}
      />
      <DataTable<Row>
        rowKey="key"
        pagination={false}
        rows={rows}
        columns={[
          {
            title: "Line",
            width: OPENING_BALANCES_FIXED_WIDTHS[0],
            render: (_, _r, index) => <Typography.Text type="secondary">{index + 1}</Typography.Text>,
          },
          {
            title: "Account",
            // Elastic, and not cut: it holds a select.
            minWidth: COLUMN.RICH_MIN,
            render: (_, r) => (
              <Select
                showSearch
                style={{ width: 320, maxWidth: "100%" }}
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
            width: OPENING_BALANCES_FIXED_WIDTHS[1],
            align: "right",
            render: (_, r) => (
              <InputNumber
                min={0}
                precision={baseDecimals}
                value={r.debit}
                aria-label="Debit"
                onChange={(v) => update(r.key, { debit: v ?? undefined, credit: undefined })}
              />
            ),
          },
          {
            title: "Credit",
            width: OPENING_BALANCES_FIXED_WIDTHS[2],
            align: "right",
            render: (_, r) => (
              <InputNumber
                min={0}
                precision={baseDecimals}
                value={r.credit}
                aria-label="Credit"
                onChange={(v) => update(r.key, { credit: v ?? undefined, debit: undefined })}
              />
            ),
          },
        ]}
        footer={() => <Button onClick={() => setRows((p) => [...p, { key: (p.at(-1)?.key ?? 0) + 1 }])}>Add row</Button>}
      />
      <DraftStatus review={review} fmt={fmt} />
      {canWrite ? (
        <FormActions>
          {/* A disabled button takes no pointer events, so the tooltip hangs on a wrapper. */}
          <Tooltip title={unmet.length ? `To post: ${unmet.map((c) => c.label.toLowerCase()).join("; ")}.` : undefined}>
            <span>
              <Button
                type="primary"
                loading={posting}
                disabled={!review.canPost}
                aria-describedby={CONDITIONS_ID}
                onClick={post}
              >
                Post opening balances
              </Button>
            </span>
          </Tooltip>
          <ul id={CONDITIONS_ID} className="opening-balances__conditions" aria-label="What posting needs">
            {review.conditions.map((condition) => (
              <li key={condition.key} className={condition.met ? "is-met" : undefined}>
                {condition.met ? <CheckCircleFilled aria-hidden="true" /> : <ClockCircleOutlined aria-hidden="true" />}
                <span>
                  {condition.label}
                  <span className="accounting-sr-only">{condition.met ? " (done)" : " (still needed)"}</span>
                </span>
              </li>
            ))}
          </ul>
        </FormActions>
      ) : (
        <FormActions note="Your role can enter these figures to check them, but not post them." />
      )}
    </Space>
  );
}

/** The words and icon for each state of the draft. */
function statusView(review: OpeningDraftReview, fmt: (minor: number) => string): { icon: ReactNode; title: string; detail: string } {
  const side = review.equityMinor > 0 ? "credit" : "debit";
  switch (review.status) {
    case "empty":
      return {
        icon: <InfoCircleOutlined aria-hidden="true" />,
        title: "Nothing entered yet",
        detail:
          "Choose the as-of date, then give each account the balance it had on that day, as a debit or a credit. Any difference between debits and credits goes to Opening Balance Equity.",
      };
    case "incomplete":
      return {
        icon: <ClockCircleOutlined aria-hidden="true" />,
        title: review.conditions.find((c) => c.key === "accounts")?.label ?? "Choose an account for every balance",
        detail: `Debits come to ${fmt(review.debitMinor)} and credits to ${fmt(review.creditMinor)}. A balance without an account cannot post, so these figures are not ready yet.`,
      };
    case "balanced":
      return {
        icon: <CheckCircleFilled aria-hidden="true" />,
        title: "Balanced",
        detail: `Debits and credits are both ${fmt(review.debitMinor)}, so nothing goes to Opening Balance Equity.`,
      };
    case "equity":
      return {
        icon: <InfoCircleFilled aria-hidden="true" />,
        title: `Opening Balance Equity takes ${fmt(review.equityMinor)} on the ${side} side`,
        detail: `Debits come to ${fmt(review.debitMinor)} and credits to ${fmt(review.creditMinor)}. The difference posts to Opening Balance Equity, so the entry balances.`,
      };
  }
}

/**
 * Where the draft stands. Empty, and a balance still without an account, are
 * neutral — never the green "Balanced" the empty form used to show beside a
 * Post button that could not be pressed.
 */
function DraftStatus({ review, fmt }: { review: OpeningDraftReview; fmt: (minor: number) => string }) {
  const side = review.equityMinor > 0 ? "credit" : "debit";
  const view = statusView(review, fmt);
  return (
    <section
      className={`opening-balances__status opening-balances__status--${review.status}`}
      aria-live="polite"
      aria-label="Where the opening balances stand"
    >
      <div className="opening-balances__status-title">
        {view.icon}
        <span>{view.title}</span>
      </div>
      <div className="opening-balances__status-detail">{view.detail}</div>
      {review.status === "empty" ? null : (
        <dl className="opening-balances__totals">
          <div>
            <dt>Debits</dt>
            <dd>{fmt(review.debitMinor)}</dd>
          </div>
          <div>
            <dt>Credits</dt>
            <dd>{fmt(review.creditMinor)}</dd>
          </div>
          <div>
            <dt>Opening Balance Equity</dt>
            <dd>{review.equityMinor === 0 ? "—" : `${fmt(review.equityMinor)} ${side}`}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
