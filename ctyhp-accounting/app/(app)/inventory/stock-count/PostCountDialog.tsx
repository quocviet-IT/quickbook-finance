"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Select } from "antd";
import { BOOKS_CHANGED_MESSAGE, differenceTone, entryPreview, signedAmountText } from "@/lib/domain/stock-count";
import type { PostingContext } from "@/lib/services/stock-count";
import { postStockCountAction, type PostStockCountOutcome } from "./actions";
import styles from "./stock-count.module.css";

/**
 * The last step: the figures, the two accounts, and the entry that will be
 * written. It ends in "Posted as JE-..." or "Sent for approval", each with a
 * link; a refusal from the database is shown here in plain words and the
 * dialog stays open so the accounts can be changed.
 */
export default function PostCountDialog({
  open,
  onClose,
  countId,
  asOf,
  countedMinor,
  bookMinor,
  differenceMinor,
  posting,
  money,
  onBooksChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Asked for when the books moved since the figures were read; the parent reads them again. */
  onBooksChanged: () => void;
  countId: string;
  asOf: string;
  countedMinor: number;
  bookMinor: number;
  differenceMinor: number;
  posting: PostingContext;
  money: (minor: number) => string;
}) {
  const router = useRouter();
  const [inventoryId, setInventoryId] = useState<string | null>(
    posting.defaultInventoryAccountId ?? posting.inventoryAccounts[0]?.id ?? null,
  );
  const [offsetId, setOffsetId] = useState<string | null>(
    posting.defaultOffsetAccountId ?? posting.offsetAccounts[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PostStockCountOutcome | null>(null);

  const inventory = posting.inventoryAccounts.find((a) => a.id === inventoryId) ?? null;
  const offset = posting.offsetAccounts.find((a) => a.id === offsetId) ?? null;
  const preview = useMemo(() => entryPreview(differenceMinor, inventory, offset), [differenceMinor, inventory, offset]);

  async function post() {
    if (!inventoryId || !offsetId) {
      setError("Choose both accounts first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postStockCountAction({
        id: countId,
        inventoryAccountId: inventoryId,
        offsetAccountId: offsetId,
        expectedDifferenceMinor: differenceMinor,
      });
      if (res.ok && res.data) {
        setOutcome(res.data);
      } else {
        // The books moved: show the message and have the page re-read them, so the figures above catch up.
        if (res.error === BOOKS_CHANGED_MESSAGE) onBooksChanged();
        setError(res.error ?? "The count could not be posted");
      }
    } catch {
      setError("The count could not be posted. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function closeOutcome() {
    // The page behind reads the count again and turns read-only.
    // That swaps this dialog out, so it waits until the dialog is closed.
    router.refresh();
    onClose();
  }

  const accountOptions = (list: { id: string; code: string; name: string }[]) =>
    list.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));

  if (outcome) {
    return (
      <Modal title="Stock count" open={open} onCancel={closeOutcome} footer={<Button type="primary" onClick={closeOutcome}>Close</Button>}>
        <div className={styles.outcome}>
          {outcome.kind === "posted" ? (
            <Alert
              type="success"
              showIcon
              title={`Posted as ${outcome.entryNumber ?? "a journal entry"}`}
              description={
                <Link href={`/journal?entry=${outcome.entryId}`}>
                  {outcome.entryNumber ? `Open ${outcome.entryNumber}` : "Open the entry"}
                </Link>
              }
            />
          ) : (
            <Alert
              type="info"
              showIcon
              title="Sent for approval"
              description={
                <>
                  The difference is above the approval limit, so a second person has to approve it. It posts when they
                  do, against the books as they stand then. <Link href={`/approvals?focus=${outcome.requestId}`}>Open Approvals</Link>
                </>
              }
            />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Adjust inventory at ${asOf}`}
      open={open}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      okText="Post the adjustment"
      cancelText="Cancel"
      confirmLoading={busy}
      okButtonProps={{ disabled: !preview }}
      onOk={() => void post()}
      destroyOnHidden
    >
      <div className={styles.figures}>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Counted at cost</span>
          <span className={styles.figureValue}>{money(countedMinor)}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>On the books</span>
          <span className={styles.figureValue}>{money(bookMinor)}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Difference</span>
          <span className={`${styles.figureValue}${differenceTone(differenceMinor) === "shortage" ? ` ${styles.shortage}` : ""}`}>
            {signedAmountText(differenceMinor, money)}
          </span>
        </div>
      </div>

      <div className={styles.selects}>
        <label className={styles.selectLabel}>
          Inventory account
          <Select
            showSearch
            optionFilterProp="label"
            value={inventoryId}
            onChange={setInventoryId}
            options={accountOptions(posting.inventoryAccounts)}
            placeholder="Choose the inventory account"
            disabled={busy}
          />
        </label>
        <label className={styles.selectLabel}>
          Offset account
          <Select
            showSearch
            optionFilterProp="label"
            value={offsetId}
            onChange={setOffsetId}
            options={accountOptions(posting.offsetAccounts)}
            placeholder="Choose the offset account"
            disabled={busy}
          />
        </label>
      </div>

      <table className={styles.preview} aria-label="The entry this will post">
        <thead>
          <tr>
            <th>Dr / Cr</th>
            <th>Account</th>
            <th className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {preview ? (
            preview.map((line) => (
              <tr key={line.side}>
                <td>{line.side}</td>
                <td>{line.accountLabel}</td>
                <td className={styles.num}>{money(line.amountMinor)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>Choose both accounts to see the entry.</td>
            </tr>
          )}
        </tbody>
      </table>

      {error ? <Alert className={styles.notice} style={{ marginTop: 16 }} type="error" showIcon title={error} /> : null}
    </Modal>
  );
}
