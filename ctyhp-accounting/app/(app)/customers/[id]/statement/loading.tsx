import { Skeleton } from "antd";
import styles from "@/components/statements/open-item-statement.module.css";

/**
 * The statement while it is read: grey lines on a sheet of the statement's own
 * width. A server component, so it uses Skeleton alone and no sub-component of
 * an Ant Design compound (see tests/unit/rsc-antd.test.ts).
 */
export default function Loading() {
  return (
    <div className={styles.scroller} role="status" aria-live="polite" aria-label="Loading statement">
      <div className={styles.sheet}>
        <Skeleton active paragraph={{ rows: 12 }} />
      </div>
    </div>
  );
}
