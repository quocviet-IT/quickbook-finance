"use client";
import { useSyncExternalStore } from "react";
import { useActiveCompanySlug } from "@/components/ActiveCompanyContext";
import { recallOverviewLayout, subscribeOverviewLayout } from "@/lib/client/dashboard-layout-memory";
import { overviewSpan, standardLayout, type HomeWidgetKey, type OverviewLayout } from "@/lib/domain/dashboard-home/layout";
import styles from "./dashboard-home.module.css";

/** One object for every render: `useSyncExternalStore` compares snapshots by identity. */
const STANDARD = standardLayout();

/** What the server draws: it cannot know the layout this browser remembers. */
function standardSnapshot(): OverviewLayout {
  return STANDARD;
}

/** The height of a card's chart or rows while it loads: about what each card draws. */
function chartHeight(layout: OverviewLayout, key: HomeWidgetKey): number {
  if (key === "cash" && layout.wide.includes("cash")) return 276;
  if (key === "needs") return 200;
  return 190;
}

/** One outline per shown card, in the layout's order, as wide as the card will be. None when every card is hidden. */
export function skeletonCells(layout: OverviewLayout): { key: HomeWidgetKey; span: 4 | 8; mid: 6 | 12; chart: number }[] {
  return layout.order
    .filter((key) => layout.shown.includes(key))
    .map((key) => ({ key, ...overviewSpan(layout, key), chart: chartHeight(layout, key) }));
}

/** A grey block of a given size, standing in for text or a chart. */
function Block({ width, height }: { width: string; height: number }) {
  return <div className={styles.skeleton} style={{ width, height }} />;
}

/** A card's outline while it loads: a title, a figure, a line and its chart or rows. */
function CardShape({ chart }: { chart: number }) {
  return (
    <div className={styles.skeletonCard}>
      <Block width="34%" height={16} />
      <Block width="48%" height={28} />
      <Block width="38%" height={12} />
      <Block width="100%" height={chart} />
    </div>
  );
}

/**
 * The Overview's cards in grey while the dashboard is read (3.0.40), in the
 * layout the person last saved in this company, as this browser remembers it:
 * one outline per shown card, in order, each as wide as the card will be.
 *
 * The server draws the Standard layout, and so does hydration; the remembered
 * layout follows straight after. On a move from another page, the outline is
 * drawn in the browser and starts in the remembered layout. With every card
 * hidden, nothing is drawn.
 */
export default function OverviewSkeleton() {
  const slug = useActiveCompanySlug();
  const layout = useSyncExternalStore(
    subscribeOverviewLayout,
    () => (slug === null ? null : recallOverviewLayout(slug)) ?? STANDARD,
    standardSnapshot,
  );
  return (
    <>
      {skeletonCells(layout).map(({ key, span, mid, chart }) => (
        <div key={key} className={`${styles.cell} ${styles[`span${span}`]} ${styles[`mid${mid}`]}`}>
          <CardShape chart={chart} />
        </div>
      ))}
    </>
  );
}
