"use client";
import { CheckCircleFilled } from "@ant-design/icons";
import { Skeleton } from "antd";
import type { HomeNeed } from "@/lib/domain/dashboard-home/types";
import { plural } from "@/lib/format";
import styles from "./dashboard-home.module.css";
import { usePrivacy } from "./privacy";
import { LinkButton, Spacer, TextLink, Widget } from "./Widget";

const COUNT_TONE: Record<HomeNeed["tone"], string | undefined> = {
  danger: styles.danger,
  warning: styles.warning,
  info: undefined,
};

/**
 * Needs attention: each kind of thing waiting, how many, what it is, and the
 * button that deals with it. Read on the server after the rest of the page has
 * been sent (the page wraps it in Suspense), so it never holds up the figures.
 *
 * A check that could not run is named under the list and never counted as
 * clear; when no check could run, it says that instead of "nothing is waiting".
 *
 * Its rows are written on the server with their amounts in them, so it masks
 * them itself from the Privacy context (3.0.39), not from anything it is handed.
 */
export default function NeedsAttention({
  needs = [],
  clear = null,
  note = null,
  failure = null,
  loading = false,
}: {
  needs?: readonly HomeNeed[];
  /** Said when every check ran and found nothing. */
  clear?: string | null;
  /** Said when some checks could not run. */
  note?: string | null;
  /** Said when nothing could be checked at all. */
  failure?: string | null;
  loading?: boolean;
}) {
  const { text } = usePrivacy();
  const footer = (
    <>
      <TextLink href="/reports/exceptions">Exception report</TextLink>
      <Spacer />
      {!loading && !failure && needs.length > 0 ? <span className={styles.caption}>{plural(needs.length, "item")}</span> : null}
    </>
  );
  return (
    <Widget title="Needs attention" footer={footer}>
      {loading ? (
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      ) : failure ? (
        <div className={styles.state} role="status">
          <span>{failure}</span>
        </div>
      ) : needs.length === 0 ? (
        <div className={styles.state} role="status">
          <span className={styles.clear}>
            <CheckCircleFilled className={styles.stateIcon} aria-hidden="true" />
            {clear}
          </span>
        </div>
      ) : (
        <ul className={styles.rows} aria-label="Needs attention">
          {needs.map((need) => (
            <li key={need.key} className={styles.needRow}>
              <span className={`${styles.needCount} ${COUNT_TONE[need.tone] ?? ""}`}>{need.count.toLocaleString("en-US")}</span>
              <span className={styles.needTitle}>{text(need.title)}</span>
              <span className={styles.needDetail}>{text(need.detail)}</span>
              <span className={styles.needAction}>
                <LinkButton href={need.href} label={`${need.action}: ${need.title}`}>
                  {need.action}
                </LinkButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && !loading && !failure ? <p className={styles.caption}>{text(note)}</p> : null}
    </Widget>
  );
}
