import OverviewSkeleton from "@/components/dashboard-home/OverviewSkeleton";
import styles from "@/components/dashboard-home/dashboard-home.module.css";

/** A grey block of a given size, standing in for text or a chart. */
function Block({ width, height }: { width: string; height: number }) {
  return <div className={styles.skeleton} style={{ width, height }} />;
}

/**
 * The Dashboard's own shape in grey while it is read (3.0.38): the header, the
 * status note, the band of four figures, the tabs, and the Overview's cards,
 * so nothing moves when the page arrives. The cards follow the Overview the
 * person arranged, as this browser remembers it (3.0.40).
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading the dashboard">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <Block width="180px" height={30} />
        <Block width="320px" height={22} />
      </div>
      <div className={styles.root}>
        <Block width="100%" height={38} />
        <div className={styles.bandBox}>
          <div className={styles.band}>
            {Array.from({ length: 4 }, (_, index) => (
              <div className={styles.skeletonKpi} key={index}>
                <Block width="45%" height={12} />
                <Block width="70%" height={26} />
                <Block width="60%" height={12} />
              </div>
            ))}
          </div>
        </div>
        <div className={styles.skeletonTabs}>
          {[72, 72, 84, 136].map((width, index) => (
            <Block key={index} width={`${width}px`} height={18} />
          ))}
        </div>
        <div className={styles.panel}>
          <div className={styles.grid}>
            <OverviewSkeleton />
          </div>
        </div>
      </div>
      <span className="accounting-sr-only">Loading the dashboard</span>
    </div>
  );
}
