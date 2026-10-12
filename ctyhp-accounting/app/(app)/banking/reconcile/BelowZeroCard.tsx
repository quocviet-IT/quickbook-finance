"use client";
import { useId } from "react";
import type { ColumnsType } from "antd/es/table";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { shortDate } from "@/lib/domain/report-presets";
import { negativeCard, type CopyFormat, type NegativeWatch, type OutstandingPayment } from "@/lib/domain/statement-alerts";
import { codedToText } from "@/lib/domain/reconcile-alerts-screen";
import { OUTSTANDING_WIDTH } from "./alert-columns";
import { AlertIcon, EntryLink, Segments } from "./alert-parts";
import styles from "./statement-alerts.module.css";

interface Props {
  accountName: string;
  watch: NegativeWatch;
  fmt: CopyFormat;
  onOpenEntry: (entryId: string) => void;
}

/**
 * "{Account} reads below zero" (the prototype's negative panel, p45): the last
 * figure somebody agreed, how far under it has gone since, and the largest
 * payments no statement has shown yet, which is where an entry that is not a
 * payment usually hides.
 */
export default function BelowZeroCard({ accountName, watch, fmt, onOpenEntry }: Props) {
  const card = negativeCard(accountName, watch, fmt);
  const titleId = useId();
  const [dateTitle, nameTitle, amountTitle, codedTitle] = card.listColumns;

  const columns: ColumnsType<OutstandingPayment> = [
    {
      title: dateTitle,
      key: "date",
      width: OUTSTANDING_WIDTH.date,
      render: (_, row) => (
        <EntryLink entryNumber={row.entryNumber} onOpen={() => onOpenEntry(row.entryId)}>
          {shortDate(row.date)}
        </EntryLink>
      ),
    },
    flexColumn<OutstandingPayment>({
      title: nameTitle,
      key: "name",
      render: (_, row) => <span title={row.name}>{row.name}</span>,
    }),
    {
      title: amountTitle,
      key: "amount",
      width: OUTSTANDING_WIDTH.amount,
      align: "right",
      render: (_, row) => <span className={styles.negative}>{fmt.money(row.amountMinor)}</span>,
    },
    flexColumn<OutstandingPayment>({
      title: codedTitle,
      key: "coded",
      render: (_, row) => {
        const text = codedToText(row.codedTo);
        return (
          <span className={styles.coded} title={text}>
            {text}
          </span>
        );
      },
    }),
  ];

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <AlertIcon />
      <div className={styles.main}>
        <h3 id={titleId} className={styles.title}>
          {card.title}
        </h3>
        <p className={styles.body}>
          <Segments segments={card.body} />
        </p>
        {card.listHeading ? (
          <>
            <p className={styles.listHeading}>{card.listHeading}</p>
            <div className={styles.outstanding}>
              <DataTable<OutstandingPayment>
                rowKey="lineId"
                rows={watch.outstanding}
                pagination={false}
                columns={columns}
              />
            </div>
          </>
        ) : null}
        <p className={styles.footnote}>{card.footer}</p>
      </div>
    </section>
  );
}
