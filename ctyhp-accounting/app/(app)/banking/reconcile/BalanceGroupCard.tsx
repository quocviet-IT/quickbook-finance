"use client";
import { useId, useRef, useState } from "react";
import { Alert, App, Button, Input, type InputRef } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { shortDate } from "@/lib/domain/report-presets";
import { ghostCard, type CopyFormat, type GhostRow } from "@/lib/domain/statement-alerts";
import {
  BLOCKERS_HEADING,
  REASON_MAX,
  REMOVAL_IDLE,
  canOfferRemoval,
  codedToText,
  removalLabel,
  removalStep,
  type RemovalEvent,
  type RemovalState,
} from "@/lib/domain/reconcile-alerts-screen";
import { removeBalanceGroupAction, type GhostGroupView } from "./actions";
import { WORKINGS_ELASTIC_FLOOR, WORKINGS_WIDTH } from "./alert-columns";
import { AlertIcon, EntryLink, Segments } from "./alert-parts";
import styles from "./statement-alerts.module.css";

interface Props {
  group: GhostGroupView;
  bankAccountId: string;
  canWrite: boolean;
  fmt: CopyFormat;
  onOpenEntry: (entryId: string) => void;
  /** The group is gone from the books: the toast has been shown, the screen reads again. */
  onRemoved: (payee: string) => void;
  /** The server no longer finds the group; the screen reads again to catch up. */
  onGone: () => void;
}

const UNEXPECTED = "The entries could not be removed. Try again.";

/**
 * "N entries here look like the statement's balance, not payments" (the
 * prototype's ghost panel, p45): what the run is, the workings that prove it,
 * and the removal.
 *
 * The removal sends the account and the payee, never a list of entries: the
 * server finds the group again from the books as they are now, and either
 * removes every entry in it or none.
 */
export default function BalanceGroupCard({ group, bankAccountId, canWrite, fmt, onOpenEntry, onRemoved, onGone }: Props) {
  const { message } = App.useApp();
  const card = ghostCard(group, fmt);
  const titleId = useId();
  const workingsId = useId();
  const [open, setOpen] = useState(false);
  const [removal, setRemoval] = useState<RemovalState>(REMOVAL_IDLE);
  // Set the moment a request leaves and cleared when it answers: two clicks
  // inside one render would otherwise both see the confirm state.
  const sending = useRef(false);
  const reasonRef = useRef<InputRef>(null);

  const dispatch = (event: RemovalEvent) => setRemoval((s) => removalStep(s, event));
  const offer = canOfferRemoval(canWrite, group.blockers);

  async function confirm() {
    if (sending.current) return;
    const next = removalStep(removal, { type: "confirm" });
    setRemoval(next);
    if (next.step !== "removing") {
      reasonRef.current?.focus();
      return;
    }
    sending.current = true;
    try {
      const result = await removeBalanceGroupAction({ bankAccountId, payee: group.payee, reason: next.reason });
      if (result.ok && result.data) {
        setRemoval((s) => removalStep(s, { type: "done" }));
        message.success(card.removedMessage(result.data.removed));
        onRemoved(group.payee);
      } else {
        const error = result.error ?? UNEXPECTED;
        setRemoval((s) => removalStep(s, { type: "failed", error }));
        if (error === card.goneMessage) onGone();
      }
    } catch {
      setRemoval((s) => removalStep(s, { type: "failed", error: UNEXPECTED }));
    } finally {
      sending.current = false;
    }
  }

  const [dateTitle, postedTitle, balanceTitle, differenceTitle, codedTitle] = card.workingsColumns;
  const columns: ColumnsType<GhostRow> = [
    {
      title: dateTitle,
      key: "date",
      width: WORKINGS_WIDTH.date,
      render: (_, row) => (
        <EntryLink entryNumber={row.entryNumber} onOpen={() => onOpenEntry(row.entryId)}>
          {shortDate(row.date)}
        </EntryLink>
      ),
    },
    {
      title: postedTitle,
      key: "posted",
      width: WORKINGS_WIDTH.postedAs,
      align: "right",
      render: (_, row) => (
        <span className={row.amountMinor < 0 ? styles.negative : styles.money}>{fmt.money(row.amountMinor)}</span>
      ),
    },
    {
      title: balanceTitle,
      key: "balance",
      width: WORKINGS_WIDTH.balance,
      align: "right",
      render: (_, row) => <span className={styles.money}>{fmt.money(row.balanceMinor)}</span>,
    },
    {
      title: differenceTitle,
      key: "difference",
      width: WORKINGS_WIDTH.difference,
      align: "right",
      render: (_, row) => <span className={styles.money}>{card.difference(row.differenceMinor)}</span>,
    },
    flexColumn<GhostRow>({
      title: codedTitle,
      key: "coded",
      floor: WORKINGS_ELASTIC_FLOOR,
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

  const asking = removal.step !== "idle";
  const problem = removal.step === "confirm" ? removal.problem : null;
  const refusal = removal.step === "confirm" ? removal.error : null;

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

        {canWrite && group.blockers.length > 0 ? (
          <div className={styles.blockers}>
            <p className={styles.blockersHeading}>{BLOCKERS_HEADING}</p>
            <ul>
              {group.blockers.map((b) => (
                <li key={b.entryId}>
                  <EntryLink entryNumber={b.entryNumber} onOpen={() => onOpenEntry(b.entryId)}>
                    {b.entryNumber || "Entry"}
                  </EntryLink>
                  {/* The reason is a predicate: "JE-0042 is dated Sep 30, 2026, in a closed period; …". */}
                  <span className={styles.blockerReason}> {b.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button
            icon={open ? <UpOutlined /> : <DownOutlined />}
            aria-expanded={open}
            aria-controls={workingsId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? card.hideWorkings : card.showWorkings}
          </Button>
          {offer ? (
            <div className={styles.removal}>
              {asking ? (
                <Input
                  ref={reasonRef}
                  className={styles.reason}
                  autoFocus
                  placeholder="Reason (required)"
                  aria-label="Reason for removing these entries"
                  aria-invalid={problem ? true : undefined}
                  maxLength={REASON_MAX}
                  value={removal.reason}
                  status={problem ? "error" : undefined}
                  disabled={removal.step === "removing"}
                  onChange={(e) => dispatch({ type: "type", reason: e.target.value })}
                  onPressEnter={() => void confirm()}
                />
              ) : null}
              <Button
                danger
                type={asking ? "primary" : "default"}
                icon={<DeleteOutlined />}
                loading={removal.step === "removing"}
                onClick={asking ? () => void confirm() : () => dispatch({ type: "ask" })}
              >
                {removalLabel(removal, card)}
              </Button>
              {asking ? (
                <Button onClick={() => dispatch({ type: "cancel" })} disabled={removal.step === "removing"}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}
        {refusal ? <Alert className={styles.refusal} type="error" showIcon title={refusal} /> : null}

        {open ? (
          <div id={workingsId} className={styles.workings}>
            <DataTable<GhostRow>
              rowKey="lineId"
              rows={group.rows}
              pagination={{ hideOnSinglePage: true }}
              columns={columns}
            />
            <p className={styles.footnote}>{card.workingsFootnote}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
