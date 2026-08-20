import styles from "@/components/accounting-dashboard/accounting-dashboard.module.css";

/**
 * The shell arrives first, in the shape the page will take.
 *
 * Not one spinner over everything: the design document is explicit that the
 * queue must not appear to be waiting on the twelve-month trend, and a
 * skeleton matching the final layout is how a reader can tell where their work
 * will be before it lands. Plain elements rather than a skeleton component —
 * this is a handful of grey rectangles, and it should not cost the route a
 * library it does not otherwise load.
 */
export default function AccountingLoading() {
  return (
    <div className={styles.root} aria-busy="true" aria-label="Loading accounting operations">
      <div className={styles.skeletonStrip} />
      <div className={styles.body}>
        <div className={styles.queueColumn}>
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonHeading} />
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} className={styles.skeletonRow} />
            ))}
          </div>
        </div>
        <div className={styles.controlColumn}>
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonHeading} />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className={styles.skeletonControl} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
