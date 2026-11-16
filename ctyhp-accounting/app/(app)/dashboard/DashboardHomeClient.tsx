"use client";

import { Suspense, use, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppstoreOutlined, ArrowsAltOutlined, HolderOutlined, ReloadOutlined, ShrinkOutlined } from "@ant-design/icons";
import { App, Button, Switch, Tabs, Tag } from "antd";
import PageHeader from "@/components/PageHeader";
import BooksNote from "@/components/dashboard-home/BooksNote";
import { ActivityWidget, BankAccountsWidget, InsightsWidget } from "@/components/dashboard-home/BooksWidgets";
import CashFlowWidget from "@/components/dashboard-home/CashFlowWidget";
import CustomizePanel from "@/components/dashboard-home/CustomizePanel";
import FigureBand from "@/components/dashboard-home/FigureBand";
import { AgingWidget, BillsWidget, InvoicesWidget, PaymentsWidget } from "@/components/dashboard-home/OpenItemWidgets";
import { ExpensesWidget, ProfitAndLossWidget, SalesWidget } from "@/components/dashboard-home/ProfitWidgets";
import WatchlistWidget from "@/components/dashboard-home/WatchlistWidget";
import { Empty } from "@/components/dashboard-home/Widget";
import styles from "@/components/dashboard-home/dashboard-home.module.css";
import { PrivacyProvider, usePrivacy } from "@/components/dashboard-home/privacy";
import { HOME_TABS, homeTabHref, homeTabOf } from "@/components/dashboard-home/view";
import {
  moveWidgetBefore,
  overviewSpan,
  standardLayout,
  toggleWide,
  widgetTitle,
  type HomeWidgetKey,
  type OverviewLayout,
} from "@/lib/domain/dashboard-home/layout";
import type { HomeTab } from "@/lib/domain/dashboard-home/types";
import { formatDate, formatTime, timeZoneLabel } from "@/lib/format";
import type { DashboardHome } from "@/lib/services/dashboard-home";
import type { DashboardPreference } from "@/lib/services/dashboard-preferences";
import { saveOverviewLayoutAction, setPrivacyAction } from "./actions";

/** What a card's cell does while the Overview is being customized. */
interface CellEdit {
  title: string;
  wide: boolean;
  dragging: boolean;
  over: boolean;
  onToggleWide: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

/**
 * How wide a card is: its columns of twelve at desktop, and at tablet widths
 * (it takes the row on a phone). While the Overview is customized the cell is
 * outlined, can be dragged, and carries a slim bar above its card with the
 * card's name and a button that makes it wider or narrower.
 */
function Cell({ span, mid, edit = null, children }: { span: 4 | 6 | 8 | 12; mid: 6 | 12; edit?: CellEdit | null; children: ReactNode }) {
  const classes = [styles.cell, styles[`span${span}`], styles[`mid${mid}`]];
  if (edit) classes.push(styles.editing);
  if (edit?.dragging) classes.push(styles.dragging);
  if (edit?.over) classes.push(styles.dropTarget);
  return (
    <div
      className={classes.join(" ")}
      draggable={edit ? true : undefined}
      onDragStart={edit?.onDragStart}
      onDragOver={edit?.onDragOver}
      onDrop={edit?.onDrop}
      onDragEnd={edit?.onDragEnd}
    >
      {edit ? (
        <div className={styles.editBar}>
          <HolderOutlined className={styles.grip} aria-hidden="true" />
          {/* The card's own head names it just below; the bar says what it is for. */}
          <span className={styles.editTitle}>
            Drag to move<span className="accounting-sr-only"> {edit.title}</span>
          </span>
          <span className={styles.spacer} />
          <Button
            size="small"
            icon={edit.wide ? <ShrinkOutlined aria-hidden="true" /> : <ArrowsAltOutlined aria-hidden="true" />}
            aria-label={`Make ${edit.title} ${edit.wide ? "narrower" : "wider"}`}
            onClick={edit.onToggleWide}
          >
            {edit.wide ? "Narrower" : "Wider"}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The count beside a tab: how many rows of Needs attention belong to it
 * (Overview counts them all). It arrives with Needs attention, after the rest
 * of the page; until then, when that read failed, and at zero, nothing shows.
 */
function TabCount({ counts, tab }: { counts: Promise<Record<HomeTab, number> | null>; tab: HomeTab }) {
  const count = use(counts)?.[tab] ?? 0;
  if (count <= 0) return null;
  return (
    <span className={styles.tabCount}>
      {count.toLocaleString("en-US")}
      <span className="accounting-sr-only">{count === 1 ? " item needs attention" : " items need attention"}</span>
    </span>
  );
}

interface DashboardProps {
  home: DashboardHome;
  currency: { code: string; decimals: number };
  accountingBasis: string;
  timeZone: string;
  /** Needs attention's rows by tab, from the same read as the card; null when that read failed. */
  counts: Promise<Record<HomeTab, number> | null>;
  /** The person's own choices; null when they could not be read (Standard, Privacy off). */
  preference: DashboardPreference | null;
  /** Needs attention, streamed in by the page. */
  needs: ReactNode;
  /** Month-end close, streamed in by the page. */
  close: ReactNode;
}

/**
 * The Dashboard (3.0.38): a note on how far the books reach, four figures,
 * then four tabs of cards. Every card draws from its own section and fails on
 * its own; the tab is kept in the address so a reload or a link opens it.
 *
 * Privacy (3.0.39) is held here and provided to everything below, the two
 * streamed cards included: with it on, every amount on the page is masked.
 */
export default function DashboardHomeClient(props: DashboardProps) {
  const [privacy, setPrivacy] = useState(props.preference?.privacy ?? false);
  return (
    <PrivacyProvider on={privacy} currency={props.currency}>
      <DashboardScreen {...props} privacy={privacy} onPrivacyChange={setPrivacy} />
    </PrivacyProvider>
  );
}

function DashboardScreen({
  home,
  currency,
  accountingBasis,
  timeZone,
  counts,
  preference,
  needs,
  close,
  privacy,
  onPrivacyChange,
}: DashboardProps & { privacy: boolean; onPrivacyChange: (on: boolean) => void }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [refreshing, startRefresh] = useTransition();
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingLayout, startSaveLayout] = useTransition();
  // The address is the one source of truth, so a link, the back button and the tabs all agree.
  const tab = homeTabOf(useSearchParams().get("tab"));

  /** The person's saved Overview. */
  const [layout, setLayout] = useState<OverviewLayout>(() => preference?.overview ?? standardLayout());
  /** The layout being customized; null when the Overview is not being customized. Cancel drops it. */
  const [draft, setDraft] = useState<OverviewLayout | null>(null);
  const [dragged, setDragged] = useState<HomeWidgetKey | null>(null);
  const [dropOn, setDropOn] = useState<HomeWidgetKey | null>(null);
  const editing = draft !== null;
  const overview = draft ?? layout;

  function changeTab(next: HomeTab) {
    // In the address, so a reload or a link opens the same tab. Written with
    // history.replaceState as Chart of Accounts does: every card is already
    // here, and router.replace would read the whole page again. null, so
    // Next.js updates useSearchParams, where the tab is read.
    window.history.replaceState(null, "", homeTabHref(next));
  }

  /** On or off at once; saved for the person in this company, and switched back if that fails. */
  async function changePrivacy(on: boolean) {
    onPrivacyChange(on);
    setSavingPrivacy(true);
    const result = await setPrivacyAction(on);
    setSavingPrivacy(false);
    if (!result.ok) {
      onPrivacyChange(!on);
      message.error("Privacy could not be saved.");
    }
  }

  /** Customize opens on the Overview with a copy of the saved layout to change; pressed again, it cancels. */
  function toggleCustomize() {
    if (editing) {
      setDraft(null);
      return;
    }
    setDraft(layout);
    if (tab !== "overview") changeTab("overview");
  }

  /** Saves the layout as it is drawn. The page is not read again: the screen already holds what was saved. */
  function saveLayout() {
    if (!draft) return;
    const next = draft;
    startSaveLayout(async () => {
      const result = await saveOverviewLayoutAction(next);
      if (result.ok) {
        setLayout(next);
        setDraft(null);
        message.success("Layout saved");
      } else {
        message.error(result.error);
      }
    });
  }

  function endDrag() {
    setDragged(null);
    setDropOn(null);
  }

  /** The cell's editing bar and drag and drop: a dragged card lands just before the card it is dropped on. */
  function editFor(key: HomeWidgetKey): CellEdit | null {
    if (!draft) return null;
    return {
      title: widgetTitle(key),
      wide: draft.wide.includes(key),
      dragging: dragged === key,
      over: dropOn === key && dragged !== null && dragged !== key,
      onToggleWide: () => setDraft((current) => (current ? toggleWide(current, key) : current)),
      onDragStart: (event) => {
        setDragged(key);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
      },
      onDragOver: (event) => {
        if (!dragged) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropOn !== key) setDropOn(key);
      },
      onDrop: (event) => {
        event.preventDefault();
        const moving = dragged;
        if (moving && moving !== key) setDraft((current) => (current ? moveWidgetBefore(current, moving, key) : current));
        endDrag();
      },
      onDragEnd: endDrag,
    };
  }

  // Every amount below is written by the Privacy context's formatters, in the company's base currency.
  const { money, compact } = usePrivacy();
  const status = home.status.data;

  /**
   * Every card the dashboard can show, by key, each with the props it already
   * takes; `span` is the card's width where that changes what it shows.
   * Needs attention and Month-end close are the cards the page streams in.
   */
  const cards: Record<HomeWidgetKey, (span: 4 | 6 | 8 | 12) => ReactNode> = {
    cash: () => <CashFlowWidget cash={home.cash} status={status} money={money} compact={compact} />,
    needs: () => needs,
    pnl: () => <ProfitAndLossWidget profit={home.profit} status={status} money={money} compact={compact} />,
    expenses: () => <ExpensesWidget profit={home.profit} status={status} money={money} compact={compact} />,
    insights: () => <InsightsWidget insights={home.insights} />,
    bank: () => <BankAccountsWidget bank={home.bank} money={money} currencyCode={currency.code} />,
    invoices: () => <InvoicesWidget receivables={home.receivables} status={status} asOf={home.asOf} money={money} currencyCode={currency.code} />,
    bills: () => <BillsWidget payables={home.payables} status={status} money={money} currencyCode={currency.code} />,
    close: () => close,
    watchlist: (span) => <WatchlistWidget watchlist={home.watchlist} width={span} currencyCode={currency.code} />,
    sales: () => <SalesWidget profit={home.profit} status={status} money={money} compact={compact} />,
    payments: () => <PaymentsWidget payments={home.payments} />,
    aging: () => <AgingWidget receivables={home.receivables} payables={home.payables} money={money} currencyCode={currency.code} />,
    activity: () => <ActivityWidget activity={home.activity} timeZone={timeZone} />,
  };

  // The Overview as the person arranged it: hidden cards are not drawn at all.
  const visible = overview.order.filter((key) => overview.shown.includes(key));
  const overviewCells =
    visible.length === 0 ? (
      <div className={`${styles.cell} ${styles.span12} ${styles.mid12}`}>
        <div className={styles.allHidden}>
          <Empty title="Every card is hidden">Tick at least one card above.</Empty>
        </div>
      </div>
    ) : (
      visible.map((key) => {
        const { span, mid } = overviewSpan(overview, key);
        return (
          <Cell key={key} span={span} mid={mid} edit={editFor(key)}>
            {cards[key](span)}
          </Cell>
        );
      })
    );

  const panels: Record<HomeTab, ReactNode> = {
    overview: (
      <>
        {overviewCells}
      </>
    ),
    "money-in": (
      <>
        <Cell span={8} mid={12}>
          {cards.invoices(8)}
        </Cell>
        <Cell span={4} mid={6}>
          {cards.payments(4)}
        </Cell>
        <Cell span={6} mid={6}>
          {cards.sales(6)}
        </Cell>
        <Cell span={6} mid={12}>
          {cards.aging(6)}
        </Cell>
      </>
    ),
    "money-out": (
      <>
        <Cell span={8} mid={12}>
          {cards.bills(8)}
        </Cell>
        <Cell span={4} mid={12}>
          {cards.expenses(4)}
        </Cell>
      </>
    ),
    banking: (
      <>
        <Cell span={8} mid={12}>
          {cards.bank(8)}
        </Cell>
        <Cell span={4} mid={12}>
          {cards.close(4)}
        </Cell>
        <Cell span={12} mid={12}>
          {cards.watchlist(12)}
        </Cell>
        <Cell span={12} mid={12}>
          {cards.activity(12)}
        </Cell>
      </>
    ),
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={
          <div className="dashboard-context">
            <Tag>As of {formatDate(home.asOf)}</Tag>
            <Tag>{accountingBasis === "cash" ? "Cash basis" : "Accrual basis"}</Tag>
            <Tag>{currency.code}</Tag>
            <Tag>{timeZoneLabel(timeZone)}</Tag>
          </div>
        }
        actions={
          <div className={styles.headTools}>
            <span>Updated {formatTime(home.generatedAt, timeZone)}</span>
            <Button icon={<ReloadOutlined aria-hidden="true" />} loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
              Refresh
            </Button>
            {/* A real label around the switch: its name is "Privacy", and the word turns it too. */}
            <label className={styles.privacy}>
              <Switch size="small" checked={privacy} loading={savingPrivacy} onChange={(on) => void changePrivacy(on)} />
              Privacy
            </label>
            <Button
              icon={<AppstoreOutlined aria-hidden="true" />}
              aria-pressed={editing}
              color={editing ? "primary" : "default"}
              variant="outlined"
              disabled={savingLayout}
              onClick={toggleCustomize}
            >
              Customize
            </Button>
          </div>
        }
      />
      <div className={styles.root}>
        <BooksNote status={home.status} />
        <FigureBand figures={home.figures} status={status} money={money} />
        <Tabs
          className={styles.tabs}
          activeKey={tab}
          onChange={(key) => changeTab(homeTabOf(key))}
          aria-label="Dashboard sections"
          items={HOME_TABS.map(({ key, label, short }) => ({
            key,
            label: (
              <span className={styles.tabLabel}>
                {short ? (
                  <>
                    <span className={styles.tabLong}>{label}</span>
                    <span className={styles.tabShort}>{short}</span>
                  </>
                ) : (
                  label
                )}
                <Suspense fallback={null}>
                  <TabCount counts={counts} tab={key} />
                </Suspense>
              </span>
            ),
            children: (
              <div className={styles.panel}>
                {/* Customize the Overview tab: on Overview only, between the tabs and its cards. */}
                {key === "overview" && draft ? (
                  <CustomizePanel layout={draft} saving={savingLayout} onChange={setDraft} onSave={saveLayout} onCancel={() => setDraft(null)} />
                ) : null}
                <div className={styles.grid}>{panels[key]}</div>
              </div>
            ),
          }))}
        />
      </div>
    </>
  );
}
