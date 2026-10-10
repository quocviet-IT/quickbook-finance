"use client";

import Link from "next/link";
import DataTable from "@/components/ui/DataTable";
import type { ColumnType } from "antd/es/table";
import { dateColumn, flexColumn, statusColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { differenceTone, stockCountStatusLabel } from "@/lib/domain/stock-count";
import type { StockCountSummary } from "@/lib/services/stock-count";
import NewCountButton from "./NewCountButton";

export interface CountListRow extends StockCountSummary {
  /** Name of whoever posted it, or null. */
  postedByName: string | null;
}

/**
 * The fixed widths of the list, in column order, and the floor of its one
 * elastic column (Posted by). tests/unit/stock-count-screens.test.ts adds them
 * up against the 984px box at a 1280px window.
 */
export const LIST_FIXED_WIDTHS = [100, 96, 168, 116, 116, 116, 72] as const;
export const LIST_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

const TONES = {
  draft: { tone: "neutral", label: stockCountStatusLabel("draft") },
  pending_approval: { tone: "warning", label: stockCountStatusLabel("pending_approval") },
  posted: { tone: "positive", label: stockCountStatusLabel("posted") },
} as const;

export default function StockCountListClient({
  rows,
  currencyCode,
  decimals,
  today,
  canWrite,
}: {
  rows: CountListRow[];
  currencyCode: string;
  decimals: number;
  today: string;
  canWrite: boolean;
}) {
  // Plain text colour for every figure; only a shortage in Adjusted by is red.
  const money = (title: string, dataIndex: "counted_minor" | "book_minor" | "difference_minor", width: number): ColumnType<CountListRow> => ({
    title,
    dataIndex,
    width,
    align: "right",
    render: (minor: number | null) =>
      minor === null ? (
        "—"
      ) : (
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            color: dataIndex === "difference_minor" && differenceTone(minor) === "shortage" ? "var(--ob-money-negative)" : undefined,
          }}
        >
          {formatMoney(minor, currencyCode, decimals)}
        </span>
      ),
  });

  return (
    <DataTable<CountListRow>
      rowKey="id"
      dataSource={rows}
      emptyTitle="No stock counts yet"
      emptyDescription="A count compares the stock you have counted, at cost, with what the inventory accounts say, and posts the difference as one entry."
      emptyAction={canWrite ? <NewCountButton today={today} /> : undefined}
      columns={[
        {
          title: "Count #",
          dataIndex: "count_number",
          width: LIST_FIXED_WIDTHS[0],
          render: (n: string, row) => <Link href={`/inventory/stock-count/${row.id}`}>{n}</Link>,
        },
        dateColumn<CountListRow>({ title: "As of", dataIndex: "as_of", width: LIST_FIXED_WIDTHS[1] }),
        statusColumn<CountListRow>({ title: "Status", dataIndex: "status", tones: TONES, width: LIST_FIXED_WIDTHS[2] }),
        money("Counted", "counted_minor", LIST_FIXED_WIDTHS[3]),
        money("Was on the books", "book_minor", LIST_FIXED_WIDTHS[4]),
        money("Adjusted by", "difference_minor", LIST_FIXED_WIDTHS[5]),
        {
          title: "Lines",
          dataIndex: "lineCount",
          width: LIST_FIXED_WIDTHS[6],
          align: "right",
          render: (n: number) => n.toLocaleString("en-US"),
        },
        flexColumn<CountListRow>({
          title: "Posted by",
          dataIndex: "postedByName",
          floor: LIST_ELASTIC_FLOOR,
        }),
      ]}
    />
  );
}
