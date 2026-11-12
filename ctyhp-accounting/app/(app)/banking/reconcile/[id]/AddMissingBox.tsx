"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, Button, Select, Space, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  ADD_ANYWAY,
  HELD_BACK_HEADING,
  proposedAccount,
  type AddItem,
  type AddMissingPlan,
  type ChosenLine,
  type HeldLine,
} from "@/lib/domain/add-missing";
import { ADD_MISSING_WIDTH as AW } from "./statement-line-columns";
import styles from "./workspace.module.css";

import { formatDate, plural } from "@/lib/format";
/**
 * The statement lines the books do not have, and the account each one belongs
 * to, before anything is written (the prototype's "Add all N to the books",
 * p24b.html; 3.0.24 for the choosing).
 *
 * A line does not post itself (item E of the defect report of 11 Nov 2026):
 * each row has its account, proposed from a rule, past coding, a card or a
 * related company and open to change, or left empty when nothing places the
 * line. The button adds only the lines with an account, one entry each; a line
 * left empty stays as it is.
 *
 * Lines the plan holds back (2.03) — a line the statement balances without,
 * and a line the books seem to hold already — are listed apart, each with why,
 * its own account and its own Add anyway.
 *
 * On a phone the table keeps its measured widths and scrolls inside the box
 * (workspace.module.css, ADD_MISSING_MIN_WIDTH).
 */
interface Props {
  plan: AddMissingPlan;
  bankAccountId: string;
  /** The accounts a line may post to: income and expense, and whatever the plan proposes. */
  accounts: { id: string; label: string }[];
  money: (minor: number) => string;
  adding: boolean;
  /** Adds the lines with an account, each to its account. */
  onAdd: (chosen: ChosenLine[]) => void;
  /** Posts one held-back line alone, to the account chosen for it; without it, the held lines are listed with no button. */
  onAddAnyway?: (line: HeldLine, accountId: string) => void;
  /** The held-back line being added, while it is. */
  addingLine?: number | null;
}

const INTRO =
  "Choose the account each line belongs to: a line your rules or past coding place is filled in for you, and you can change it. Adding posts one entry per line, dated as the bank has it, and ticks it, because the bank has already cleared it. A line left without an account is not added.";

export default function AddMissingBox({ plan, bankAccountId, accounts, money, adding, onAdd, onAddAnyway, addingLine = null }: Props) {
  const { missing, items, held, cannot, blocked } = plan;
  const busy = adding || addingLine !== null;
  // What the person changed, by line; every other line keeps what the plan proposes.
  const [changed, setChanged] = useState<Record<number, string | null>>({});
  const accountOf = (line: AddItem) => (line.lineNo in changed ? changed[line.lineNo] : proposedAccount(line));
  const choose = (lineNo: number, accountId: string | null) => setChanged((was) => ({ ...was, [lineNo]: accountId }));

  // The accounts offered: the plan's own proposals first, so a rule's account is always there to keep.
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    for (const line of [...items, ...held]) if (line.source !== "uncategorized") seen.set(line.accountId, line.accountLabel);
    for (const account of accounts) if (!seen.has(account.id)) seen.set(account.id, account.label);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [items, held, accounts]);

  const chosen: ChosenLine[] = items.flatMap((item) => {
    const accountId = accountOf(item);
    return accountId ? [{ lineNo: item.lineNo, accountId }] : [];
  });
  const unchosen = items.length - chosen.length;

  const picker = (line: AddItem, width?: number) => (
    <Select
      aria-label={`Account for ${formatDate(line.txnDate)} ${line.description || "(no description)"}`}
      size="small"
      showSearch
      allowClear
      optionFilterProp="label"
      placeholder="Choose an account"
      style={{ width: width ?? "100%" }}
      value={accountOf(line) ?? undefined}
      onChange={(value: string | undefined) => choose(line.lineNo, value ?? null)}
      options={options}
      disabled={busy}
    />
  );

  return (
    <Alert
      type="warning"
      showIcon
      title={`The bank shows ${plural(missing, "thing")} your books do not.`}
      description={
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{INTRO}</Typography.Text>
          {blocked ? <Typography.Text strong>{blocked}</Typography.Text> : null}
          {items.length ? (
            <DataTable<AddItem>
              className={styles.addMissing}
              rowKey="lineNo"
              size="small"
              pagination={false}
              dataSource={items}
              columns={[
                { title: "Date", render: (_, item) => formatDate(item.txnDate), width: AW.date },
                { title: "Description", dataIndex: "description" },
                { title: "Amount", align: "right", render: (_, item) => money(item.amountMinor), width: AW.amount },
                {
                  title: "Posts to",
                  width: AW.postTo,
                  render: (_, item) => (
                    <Space direction="vertical" size={2} style={{ width: "100%" }}>
                      {picker(item)}
                      {item.source === "uncategorized" ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          Nothing places this line: choose its account.
                        </Typography.Text>
                      ) : accountOf(item) === item.accountId ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }} title={item.why}>
                          Proposed · {item.short}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          ) : null}
          {held.length ? (
            <div>
              <Typography.Text type="secondary">{HELD_BACK_HEADING}</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {held.map((line) => {
                  const accountId = accountOf(line);
                  return (
                    <li key={line.lineNo} style={{ marginBottom: 6 }}>
                      <Space size={[8, 4]} wrap align="center">
                        <span>
                          {formatDate(line.txnDate)} · {line.description || "(no description)"} · {money(line.amountMinor)} →
                        </span>
                        {picker(line, 220)}
                        {onAddAnyway ? (
                          <Button
                            size="small"
                            loading={addingLine === line.lineNo}
                            disabled={!accountId || (busy && addingLine !== line.lineNo)}
                            onClick={() => accountId && onAddAnyway(line, accountId)}
                          >
                            {ADD_ANYWAY}
                          </Button>
                        ) : null}
                      </Space>
                      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                        {line.note}
                      </Typography.Text>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {cannot.length ? (
            <div>
              <Typography.Text type="secondary">Not added from here:</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {cannot.map((line) => (
                  <li key={line.lineNo}>
                    {formatDate(line.txnDate)} · {line.description || "(no description)"} · {money(line.amountMinor)} — {line.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Space size="middle" wrap>
            {items.length && !blocked ? (
              <Button type="primary" loading={adding} disabled={addingLine !== null || chosen.length === 0} onClick={() => onAdd(chosen)}>
                Add {chosen.length} to the books
              </Button>
            ) : null}
            {items.length && !blocked && unchosen > 0 ? (
              <Tag color="gold">{plural(unchosen, "line")} without an account will be left as {unchosen === 1 ? "it is" : "they are"}</Tag>
            ) : null}
            <Link href={`/banking?account=${bankAccountId}&queue=unmatched`}>or code them one by one in Bank Transactions</Link>
          </Space>
        </Space>
      }
    />
  );
}
