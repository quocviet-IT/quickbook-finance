"use client";

import Link from "next/link";
import { ArrowRightOutlined, CheckCircleFilled } from "@ant-design/icons";
import { Card, Skeleton, Typography } from "antd";
import type { DashboardNeed } from "@/lib/domain/dashboard-needs";
import styles from "./needs-attention.module.css";

/**
 * What needs someone today (2.88): each kind of thing waiting, how many, what
 * it is, and a link to where it is dealt with. Loaded after the rest of the
 * Dashboard, so the figures above never wait for it.
 */
export default function NeedsAttention({
  needs = [],
  clear = null,
  note = null,
  failure = null,
  loading = false,
}: {
  needs?: readonly DashboardNeed[];
  /** Said when every check ran and found nothing. */
  clear?: string | null;
  /** Said when some checks could not run. */
  note?: string | null;
  /** Said when nothing could be checked at all. */
  failure?: string | null;
  loading?: boolean;
}) {
  return (
    <Card
      title="Needs attention"
      extra={
        <Link href="/reports/exceptions">
          Exception report <ArrowRightOutlined />
        </Link>
      }
    >
      {loading ? (
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      ) : failure ? (
        <Typography.Text type="secondary">{failure}</Typography.Text>
      ) : needs.length === 0 ? (
        <Typography.Text className={styles.clear}>
          <CheckCircleFilled /> {clear}
        </Typography.Text>
      ) : (
        <ul className={styles.list} aria-label="Needs attention">
          {needs.map((need) => (
            <li key={need.key}>
              <Link href={need.href} className={styles.item}>
                <span className={need.tone === "danger" ? `${styles.count} ${styles.danger}` : styles.count}>
                  {need.count.toLocaleString("en-US")}
                </span>
                <span className={styles.text}>
                  <strong>{need.title}</strong>
                  <span>{need.detail}</span>
                </span>
                <ArrowRightOutlined className={styles.go} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && !loading && !failure ? (
        <Typography.Text type="secondary" className={styles.note}>
          {note}
        </Typography.Text>
      ) : null}
    </Card>
  );
}
