"use client";
import Link from "next/link";
import { Alert, Button, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import type { AddItem, AddMissingPlan } from "@/lib/domain/add-missing";
import { shortDate } from "@/lib/domain/pdf-statement-view";

/**
 * The statement lines the books do not have, and one click that adds them all
 * (the prototype's "Add all N to the books", p24b.html). The table shows what
 * each line will post to before anything is posted, so the click asks nothing
 * more.
 */
interface Props {
  plan: AddMissingPlan;
  bankAccountId: string;
  money: (minor: number) => string;
  adding: boolean;
  onAdd: () => void;
}

const INTRO =
  "Adding them posts real entries, dated as the bank has them and coded by your rules — anything a rule cannot place goes to Uncategorized, to recode later. They are ticked straight away, because the bank has already cleared them.";

export default function AddMissingBox({ plan, bankAccountId, money, adding, onAdd }: Props) {
  const { missing, items, cannot, blocked } = plan;
  return (
    <Alert
      type="warning"
      showIcon
      title={`The bank shows ${missing} ${missing === 1 ? "thing" : "things"} your books do not.`}
      description={
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{INTRO}</Typography.Text>
          {blocked ? <Typography.Text strong>{blocked}</Typography.Text> : null}
          {items.length ? (
            <DataTable<AddItem>
              rowKey="lineNo"
              size="small"
              pagination={false}
              dataSource={items}
              columns={[
                { title: "Date", render: (_, item) => shortDate(item.txnDate, true), width: 120 },
                { title: "Description", dataIndex: "description" },
                { title: "Amount", align: "right", render: (_, item) => money(item.amountMinor), width: 130 },
                {
                  title: "Would post to",
                  width: 300,
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
          {cannot.length ? (
            <div>
              <Typography.Text type="secondary">Not added from here:</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {cannot.map((line) => (
                  <li key={line.lineNo}>
                    {shortDate(line.txnDate, true)} · {line.description || "(no description)"} · {money(line.amountMinor)} — {line.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Space size="middle" wrap>
            {items.length && !blocked ? (
              <Button type="primary" loading={adding} onClick={onAdd}>
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
