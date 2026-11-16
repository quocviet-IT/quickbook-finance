"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Modal, Select } from "antd";
import { saveWatchlistAction } from "@/app/(app)/dashboard/actions";
import { WATCHLIST_MAX, type HomeWatchChoice, type HomeWatchRow } from "@/lib/domain/dashboard-home/watchlist";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import type { HomeWatchlist } from "@/lib/services/dashboard-home";
import styles from "./dashboard-home.module.css";
import { usePrivacy } from "./privacy";
import { Empty, Spacer, TextLink, Unavailable, Widget } from "./Widget";

const TITLE = "Account watchlist";

/** An account as the picker lists it: its code and name, searchable by either. */
function optionOf(account: Pick<HomeWatchChoice, "id" | "code" | "name">) {
  return { value: account.id, label: `${account.code} ${account.name}` };
}

/**
 * Choose accounts to watch: the chart's active accounts, searchable by code
 * and name, at most ten, in the order they are picked. The selection is plain
 * state, not an antd Form: a Form inside a Modal mounts late in this app.
 */
function ChooseAccounts({
  open,
  rows,
  choices,
  onClose,
}: {
  open: boolean;
  rows: readonly HomeWatchRow[];
  choices: readonly HomeWatchChoice[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>(() => rows.map((row) => row.accountId));
  const [saving, startSaving] = useTransition();
  // A watched account made inactive since is still offered, so keeping the list as it is never drops it.
  const offered = new Set(choices.map((choice) => choice.id));
  const options = [
    ...choices.map(optionOf),
    ...rows.filter((row) => !offered.has(row.accountId)).map((row) => optionOf({ id: row.accountId, code: row.code, name: row.name })),
  ];

  function save() {
    startSaving(async () => {
      const result = await saveWatchlistAction(selected);
      if (!result.ok) {
        message.error(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal
      title="Choose accounts to watch"
      open={open}
      okText="Save"
      onOk={save}
      confirmLoading={saving}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className={styles.watchPicker}>
        <Select
          mode="multiple"
          maxCount={WATCHLIST_MAX}
          value={selected}
          onChange={setSelected}
          options={options}
          showSearch={{ optionFilterProp: "label" }}
          placeholder="Search by code or name"
          aria-label="Accounts to watch"
          style={{ width: "100%" }}
        />
        <p className={styles.caption}>Up to 10 accounts. They are yours alone.</p>
      </div>
    </Modal>
  );
}

/**
 * The account watchlist (3.0.39): up to ten accounts the person picks, each
 * with this month's activity, last month's and the balance the Chart of
 * Accounts shows. At 8 or 12 columns it shows every column; at 4, the account,
 * this month and the balance.
 */
export default function WatchlistWidget({
  watchlist,
  width,
  currencyCode,
}: {
  watchlist: SectionEnvelope<HomeWatchlist>;
  /** How many of the twelve columns the card takes at desktop. */
  width: 4 | 6 | 8 | 12;
  currencyCode: string;
}) {
  const { money } = usePrivacy();
  const [choosing, setChoosing] = useState(false);
  // A new picker each time it opens, so it starts from the list as it is now.
  const [opened, setOpened] = useState(0);
  const data = watchlist.data;
  const wide = width >= 8;
  const choose = (
    <Button
      size="small"
      onClick={() => {
        setOpened((count) => count + 1);
        setChoosing(true);
      }}
    >
      Choose accounts
    </Button>
  );
  const link = <TextLink href="/accounts">Chart of accounts</TextLink>;

  // Unavailable: nothing to choose from, and the list kept so far is unknown, so only the link.
  if (!data) {
    return (
      <Widget title={TITLE} footer={link}>
        <Unavailable reason={watchlist.unavailableReason ?? "The account watchlist could not be read."} />
      </Widget>
    );
  }
  const picker = <ChooseAccounts key={opened} open={choosing} rows={data.rows} choices={data.choices} onClose={() => setChoosing(false)} />;
  if (data.rows.length === 0) {
    return (
      <Widget title={TITLE} footer={link}>
        <Empty title="No accounts on your watchlist yet." action={choose} />
        {picker}
      </Widget>
    );
  }
  const footer = (
    <>
      {link}
      <Spacer />
      {choose}
    </>
  );
  return (
    <Widget title={TITLE} footer={footer}>
      <div className={`${styles.tableWrap} ${styles.tableFlush}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Account</th>
              {wide ? <th scope="col">Type</th> : null}
              <th scope="col" className={styles.num}>
                This month ({currencyCode})
              </th>
              {wide ? (
                <th scope="col" className={styles.num}>
                  Last month ({currencyCode})
                </th>
              ) : null}
              <th scope="col" className={styles.num}>
                Balance ({currencyCode})
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.accountId}>
                <th scope="row" className={styles.name}>
                  <span className={styles.code}>{row.code}</span> {row.name}
                </th>
                {wide ? <td className={styles.muted}>{row.typeLabel}</td> : null}
                <td className={styles.num}>{money(row.thisMonthMinor)}</td>
                {wide ? <td className={styles.num}>{money(row.lastMonthMinor)}</td> : null}
                <td className={styles.num}>{money(row.balanceMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.caption}>
        This month and last month are each account&apos;s activity. Balance is what the Chart of Accounts shows: this fiscal year for
        income and expense accounts, every other account since the books began.
      </p>
      {picker}
    </Widget>
  );
}
