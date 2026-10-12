"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { formatMoney } from "@/lib/format";
import { payeeKeyOf, type CopyFormat } from "@/lib/domain/statement-alerts";
import { CHECKS_FAILED, withoutGroup } from "@/lib/domain/reconcile-alerts-screen";
import { statementAlertsAction, type StatementAlertsView } from "./actions";
import BalanceGroupCard from "./BalanceGroupCard";
import BelowZeroCard from "./BelowZeroCard";
import styles from "./statement-alerts.module.css";

interface Props {
  bankAccountId: string;
  /** The ledger account's name, as the Exceptions report and the Balance Sheet call it. */
  accountName: string;
  canWrite: boolean;
  baseCurrency: string;
  baseDecimals: number;
  /** A group was removed: the reconciliations list reads again. */
  onRemoved: () => void;
}

/** One answer, for the account it was asked about. */
type Read = { bankAccountId: string; view: StatementAlertsView | null };

/**
 * The two statement alerts for the account chosen on the Reconcile start
 * screen, above its reconciliations.
 *
 * Read after the page has drawn, so a long ledger never holds the page up.
 * While the read is out the panel shows nothing: a check still running has
 * found nothing, which is not the same as finding the account clear, and a
 * card that flashed up and vanished would read as an alarm. A read that fails
 * says so in one quiet line.
 *
 * An answer is kept only for the account it was asked about, and only when it
 * is the latest asked: switch accounts quickly and an earlier, slower answer
 * is dropped rather than drawn under the wrong account's name.
 */
export default function StatementAlertsPanel({
  bankAccountId,
  accountName,
  canWrite,
  baseCurrency,
  baseDecimals,
  onRemoved,
}: Props) {
  const [read, setRead] = useState<Read | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const latest = useRef(0);

  const ask = useCallback((id: string) => {
    const ticket = ++latest.current;
    void statementAlertsAction(id).then(
      (result) => {
        if (latest.current !== ticket) return;
        setRead({ bankAccountId: id, view: result.ok && result.data ? result.data : null });
      },
      () => {
        if (latest.current === ticket) setRead({ bankAccountId: id, view: null });
      },
    );
  }, []);

  useEffect(() => {
    ask(bankAccountId);
  }, [ask, bankAccountId]);

  const fmt = useMemo<CopyFormat>(
    () => ({ money: (minor) => formatMoney(minor, baseCurrency, baseDecimals) }),
    [baseCurrency, baseDecimals],
  );

  const current = read?.bankAccountId === bankAccountId ? read : null;
  if (!current) return null;

  if (!current.view) {
    return (
      <p className={styles.quiet}>
        {CHECKS_FAILED}.
        <button
          type="button"
          className={styles.retry}
          onClick={() => {
            setRead(null);
            ask(bankAccountId);
          }}
        >
          Try again
        </button>
      </p>
    );
  }

  const { ghosts, negative } = current.view;
  if (!negative && ghosts.length === 0) return null;

  const removed = (payee: string) => {
    // The card goes at once; the read that follows confirms it, and redraws
    // the below-zero card, whose figures the removal has changed.
    setRead((r) =>
      r?.bankAccountId === bankAccountId && r.view
        ? { ...r, view: { ...r.view, ghosts: withoutGroup(r.view.ghosts, payee) } }
        : r,
    );
    onRemoved();
    ask(bankAccountId);
  };

  return (
    <div className={styles.stack}>
      {negative ? (
        <BelowZeroCard accountName={accountName} watch={negative} fmt={fmt} onOpenEntry={setOpenEntry} />
      ) : null}
      {ghosts.map((group) => (
        <BalanceGroupCard
          key={`${bankAccountId}:${payeeKeyOf(group.payee)}`}
          group={group}
          bankAccountId={bankAccountId}
          canWrite={canWrite}
          fmt={fmt}
          onOpenEntry={setOpenEntry}
          onRemoved={removed}
          onGone={() => ask(bankAccountId)}
        />
      ))}
      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
