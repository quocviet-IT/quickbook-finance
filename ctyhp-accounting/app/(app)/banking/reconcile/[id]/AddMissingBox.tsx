"use client";
import Link from "next/link";
import { Alert, Button, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { ADD_ANYWAY, HELD_BACK_HEADING, type AddItem, type AddMissingPlan, type HeldLine } from "@/lib/domain/add-missing";
import { ADD_MISSING_WIDTH as AW } from "./statement-line-columns";
import styles from "./workspace.module.css";

import { formatDate, plural } from "@/lib/format";
/**
 * The statement lines the books do not have, and one click that adds them all
 * (the prototype's "Add all N to the books", p24b.html). The table shows what
 * each line will post to before anything is posted, so the click asks nothing
 * more.
 *
 * Lines the plan holds back (2.03) — a line the statement balances without,
 * and a line the books seem to hold already — are listed apart, each with why
 * and its own Add anyway. "Add all N" adds only the table's lines, so when
 * every line is held back there is no Add all.
 *
 * On a phone the table keeps its measured widths and scrolls inside the box
 * (workspace.module.css, ADD_MISSING_MIN_WIDTH).
 */
interface Props {
  plan: AddMissingPlan;
  bankAccountId: string;
  money: (minor: number) => string;
  adding: boolean;
  onAdd: () => void;
  /** Posts one held-back line alone; without it, the held lines are listed with no button. */
  onAddAnyway?: (line: HeldLine) => void;
  /** The held-back line being added, while it is. */
  addingLine?: number | null;
}

const INTRO =
  "Adding them posts real entries, dated as the bank has them and coded by your rules — anything a rule cannot place goes to Uncategorized, to recode later. They are ticked straight away, because the bank has already cleared them.";

export default function AddMissingBox({ plan, bankAccountId, money, adding, onAdd, onAddAnyway, addingLine = null }: Props) {
  const { missing, items, held, cannot, blocked } = plan;
  const busy = adding || addingLine !== null;
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
                  title: "Would post to",
                  width: AW.postTo,
                  render: (_, item) => (
                    <Space size={6} wrap>
                      <Tooltip title={item.why}>
                        <span>{item.accountLabel}</span>
                      </Tooltip>
                      {item.source === "uncategorized" ? (
                        <Tag color="gold">needs coding</Tag>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.short}
                        </Typography.Text>
                      )}
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
                {held.map((line) => (
                  <li key={line.lineNo} style={{ marginBottom: 6 }}>
                    <Space size={[8, 2]} wrap align="center">
                      <span>
                        {formatDate(line.txnDate)} · {line.description || "(no description)"} · {money(line.amountMinor)} →{" "}
                        <Tooltip title={line.why}>
                          <span>{line.accountLabel}</span>
                        </Tooltip>
                      </span>
                      {onAddAnyway ? (
                        <Button
                          size="small"
                          loading={addingLine === line.lineNo}
                          disabled={busy && addingLine !== line.lineNo}
                          onClick={() => onAddAnyway(line)}
                        >
                          {ADD_ANYWAY}
                        </Button>
                      ) : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                      {line.note}
                    </Typography.Text>
                  </li>
                ))}
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
              <Button type="primary" loading={adding} disabled={addingLine !== null} onClick={onAdd}>
                Add all {items.length} to the books
              </Button>
            ) : null}
            <Link href={`/banking?account=${bankAccountId}&queue=unmatched`}>or code them one by one in Bank Transactions</Link>
          </Space>
        </Space>
      }
    />
  );
}
