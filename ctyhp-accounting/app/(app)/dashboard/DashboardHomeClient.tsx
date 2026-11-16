"use client";

import { Suspense, use, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReloadOutlined } from "@ant-design/icons";
import { App, Button, Switch, Tabs, Tag } from "antd";
import PageHeader from "@/components/PageHeader";
import BooksNote from "@/components/dashboard-home/BooksNote";
import { ActivityWidget, BankAccountsWidget, InsightsWidget } from "@/components/dashboard-home/BooksWidgets";
import CashFlowWidget from "@/components/dashboard-home/CashFlowWidget";
import FigureBand from "@/components/dashboard-home/FigureBand";
import { AgingWidget, BillsWidget, InvoicesWidget, PaymentsWidget } from "@/components/dashboard-home/OpenItemWidgets";
import { ExpensesWidget, ProfitAndLossWidget, SalesWidget } from "@/components/dashboard-home/ProfitWidgets";
import styles from "@/components/dashboard-home/dashboard-home.module.css";
import { PrivacyProvider, usePrivacy } from "@/components/dashboard-home/privacy";
import { HOME_TABS, homeTabHref, homeTabOf } from "@/components/dashboard-home/view";
import type { HomeTab } from "@/lib/domain/dashboard-home/types";
import { formatDate, formatTime, timeZoneLabel } from "@/lib/format";
import type { DashboardHome } from "@/lib/services/dashboard-home";
import type { DashboardPreference } from "@/lib/services/dashboard-preferences";
import { setPrivacyAction } from "./actions";

/** How wide a card is: its columns of twelve at desktop, and at tablet widths (it takes the row on a phone). */
function Cell({ span, mid, children }: { span: 4 | 6 | 8 | 12; mid: 6 | 12; children: ReactNode }) {
  return <div className={`${styles.cell} ${styles[`span${span}`]} ${styles[`mid${mid}`]}`}>{children}</div>;
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
  needs,
  close,
  privacy,
  onPrivacyChange,
}: DashboardProps & { privacy: boolean; onPrivacyChange: (on: boolean) => void }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [refreshing, startRefresh] = useTransition();
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  // The address is the one source of truth, so a link, the back button and the tabs all agree.
  const tab = homeTabOf(useSearchParams().get("tab"));

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

  // Every amount below is written by the Privacy context's formatters, in the company's base currency.
  const { money, compact } = usePrivacy();
  const status = home.status.data;

  const panels: Record<HomeTab, ReactNode> = {
    overview: (
      <>
        <Cell span={8} mid={12}>
          <CashFlowWidget cash={home.cash} status={status} money={money} compact={compact} />
        </Cell>
        <Cell span={4} mid={6}>
          {needs}
        </Cell>
        <Cell span={4} mid={6}>
          <ProfitAndLossWidget profit={home.profit} status={status} money={money} compact={compact} />
        </Cell>
        <Cell span={4} mid={6}>
          <ExpensesWidget profit={home.profit} status={status} money={money} compact={compact} />
        </Cell>
        <Cell span={4} mid={6}>
          <InsightsWidget insights={home.insights} />
        </Cell>
      </>
    ),
    "money-in": (
      <>
        <Cell span={8} mid={12}>
          <InvoicesWidget receivables={home.receivables} status={status} asOf={home.asOf} money={money} currencyCode={currency.code} />
        </Cell>
        <Cell span={4} mid={6}>
          <PaymentsWidget payments={home.payments} />
        </Cell>
        <Cell span={6} mid={6}>
          <SalesWidget profit={home.profit} status={status} money={money} compact={compact} />
        </Cell>
        <Cell span={6} mid={12}>
          <AgingWidget receivables={home.receivables} payables={home.payables} money={money} currencyCode={currency.code} />
        </Cell>
      </>
    ),
    "money-out": (
      <>
        <Cell span={8} mid={12}>
          <BillsWidget payables={home.payables} status={status} money={money} currencyCode={currency.code} />
        </Cell>
        <Cell span={4} mid={12}>
          <ExpensesWidget profit={home.profit} status={status} money={money} compact={compact} />
        </Cell>
      </>
    ),
    banking: (
      <>
        <Cell span={8} mid={12}>
          <BankAccountsWidget bank={home.bank} money={money} currencyCode={currency.code} />
        </Cell>
        <Cell span={4} mid={12}>
          {close}
        </Cell>
        <Cell span={12} mid={12}>
          <ActivityWidget activity={home.activity} timeZone={timeZone} />
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
                <div className={styles.grid}>{panels[key]}</div>
              </div>
            ),
          }))}
        />
      </div>
    </>
  );
}
