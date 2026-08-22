import styles from "./work-surface.module.css";

/**
 * The page's own shape in grey, so a reader can see where their work will land.
 *
 * Deliberately the shape of the *new* surface — a strip, then a wide queue and a
 * narrow rail. The skeleton it replaces drew four metric boxes and three panel
 * rows, which meant the loading state promised a layout the loaded page no
 * longer has.
 */
export default function SurfaceSkeleton() {
  return (
    <div className={styles.surfaceRoot} aria-busy="true" aria-label="Loading">
      <div className={`${styles.strip} ${styles.skeletonStrip}`} />
      <div className={styles.surfaceBody}>
        <div className={styles.surfaceQueue}>
          <div className={styles.skeletonPanel} />
        </div>
        <div className={styles.surfaceControls}>
          <div className={styles.skeletonRail} />
        </div>
      </div>
    </div>
  );
}
