import styles from "./WorkAreaOverview.module.css";

export default function WorkAreaOverviewSkeleton() {
  return (
    <div
      className={`${styles.root} ${styles.skeletonRoot}`}
      aria-busy="true"
      aria-label="Loading work area overview"
    >
      <div className={styles.skeletonHeader}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.skeletonFilter} />
      <div className={styles.metricGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.skeletonMetric} key={index} />
        ))}
      </div>
      <div className={styles.mainGrid}>
        <div className={styles.skeletonPanel} />
        <div className={styles.skeletonPanel} />
      </div>
      <div className={styles.analysisGrid}>
        <div className={styles.skeletonPanel} />
        <div className={styles.skeletonPanel} />
      </div>
      <div className={styles.secondaryGrid}>
        <div className={styles.skeletonPanel} />
        <div className={styles.skeletonPanel} />
      </div>
    </div>
  );
}
