"use client";
import StatusTag from "@/components/ui/StatusTag";
import type { HomeBank, HomeBankAccount, HomeInsight } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import type { DashboardActivity } from "@/lib/services/dashboard";
import styles from "./dashboard-home.module.css";
import { bankTable, bankTone, cardBalance } from "./view";
import { Empty, LinkButton, Spacer, TextLink, Unavailable, Widget } from "./Widget";

type Money = (minor: number) => string;

/* -------------------------------------------------------------- bank accounts */

function AccountRow({ account, money }: { account: HomeBankAccount; money: Money }) {
  const amount = (minor: number) => (account.isCard ? cardBalance(minor, money) : money(minor));
  return (
    <tr>
      <td className={styles.name}>
        <TextLink href={account.href}>{account.name}</TextLink>
        {account.masked ? <span className={styles.aside}>{account.masked}</span> : null}
      </td>
      <td>
        <StatusTag status={account.tone} looks={{ [account.tone]: { tone: bankTone(account.tone), label: account.statusText } }} />
      </td>
      <td className={account.reconciledThrough ? undefined : styles.muted}>
        {account.reconciledThrough ? formatDate(account.reconciledThrough) : "Never"}
      </td>
      <td className={styles.num}>{account.statementMinor === null ? "—" : amount(account.statementMinor)}</td>
      <td className={styles.num}>{amount(account.bookMinor)}</td>
    </tr>
  );
}

/**
 * Bank accounts, the wide card of Banking and close. There is no live bank
 * balance: the table says what the last reconciled statement closed at, how far
 * each account is reconciled, and what the books hold.
 *
 * The rows above "Cash on hand" add up to it: the bank accounts, and the cash
 * held in ledger accounts with no bank account behind them. Cards come after,
 * under their own heading, as what is owed on each; they are never added in.
 */
export function BankAccountsWidget({
  bank,
  money,
  currencyCode,
}: {
  bank: SectionEnvelope<HomeBank>;
  money: Money;
  currencyCode: string;
}) {
  const data = bank.data;
  const linesToCode = data ? data.accounts.reduce((sum, account) => sum + account.linesToCode, 0) : 0;
  const footer = (
    <>
      <TextLink href="/banking">Bank transactions</TextLink>
      <Spacer />
      <LinkButton href="/banking?import=1">Import statement</LinkButton>
      {linesToCode > 0 ? (
        <LinkButton href="/banking?queue=unmatched" primary>
          {`Code ${plural(linesToCode, "line")}`}
        </LinkButton>
      ) : null}
    </>
  );
  if (!data) {
    return (
      <Widget title="Bank accounts" footer={footer}>
        <Unavailable reason={bank.unavailableReason ?? "Bank accounts could not be read."} />
      </Widget>
    );
  }
  if (data.accounts.length === 0 && data.otherCash === null) {
    return (
      <Widget title="Bank accounts">
        <Empty title="No bank account yet" action={<LinkButton href="/banking" primary>Connect a bank</LinkButton>}>
          Connect a bank feed or import a statement to see balances here.
        </Empty>
      </Widget>
    );
  }
  const { banks, cards, otherCash, cashMinor } = bankTable(data);
  return (
    <Widget title="Bank accounts" footer={footer}>
      <div className={styles.hero}>
        <span className={styles.heroValue}>{money(cashMinor)}</span>
        <span className={styles.heroSub}>
          Cash on hand in the books · {plural(banks.length, "bank account")}
          {otherCash ? " and cash held outside them" : ""}
        </span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Status</th>
              <th scope="col">Reconciled through</th>
              <th scope="col" className={styles.num}>
                Last statement balance ({currencyCode})
              </th>
              <th scope="col" className={styles.num}>
                In the books ({currencyCode})
              </th>
            </tr>
          </thead>
          <tbody>
            {banks.map((account) => (
              <AccountRow key={account.id} account={account} money={money} />
            ))}
            {otherCash ? (
              <tr>
                {/* No status, statement or reconciliation to show: the name takes their room instead of wrapping. */}
                <td className={styles.name} colSpan={4}>
                  Cash not in a bank account
                  <span className={styles.aside}>{plural(otherCash.accounts, "ledger account")}</span>
                </td>
                <td className={styles.num}>{money(otherCash.bookMinor)}</td>
              </tr>
            ) : null}
            <tr className={styles.totalRow}>
              <th scope="row">Cash on hand</th>
              <td />
              <td />
              <td />
              <td className={styles.num}>{money(cashMinor)}</td>
            </tr>
            {cards.length > 0 ? (
              <tr className={styles.subhead}>
                <th scope="colgroup" colSpan={5}>
                  Credit cards
                </th>
              </tr>
            ) : null}
            {cards.map((account) => (
              <AccountRow key={account.id} account={account} money={money} />
            ))}
          </tbody>
        </table>
      </div>
    </Widget>
  );
}

/* ------------------------------------------------------------------ insights */

/** Insights: at most three things the books show, each with its figures and where to look. */
export function InsightsWidget({ insights }: { insights: SectionEnvelope<HomeInsight[]> }) {
  const footer = <span className={styles.caption}>Worked out from the books by fixed rules</span>;
  const data = insights.data;
  if (!data) {
    return (
      <Widget title="Insights" footer={footer}>
        <Unavailable reason={insights.unavailableReason ?? "Insights could not be read."} />
      </Widget>
    );
  }
  if (data.length === 0) {
    return (
      <Widget title="Insights" footer={footer}>
        <Empty title="Nothing stands out right now." />
      </Widget>
    );
  }
  return (
    <Widget title="Insights" footer={footer}>
      <ul className={styles.rows}>
        {data.map((insight) => (
          <li key={insight.key} className={styles.insightRow}>
            <span className={styles.insightKind}>{insight.kind}</span>
            <span className={styles.insightHead}>{insight.headline}</span>
            <p className={styles.insightDetail}>{insight.detail}</p>
            <TextLink href={insight.link.href}>{insight.link.label}</TextLink>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

/* ---------------------------------------------------------- recent activity */

/**
 * Recent accounting activity: the latest changes from the audit log, without
 * system activity such as nightly backups. Empty both when nothing has
 * happened and for someone who may not read the audit log.
 */
export function ActivityWidget({ activity, timeZone }: { activity: SectionEnvelope<DashboardActivity[]>; timeZone: string }) {
  const footer = <TextLink href="/settings/audit">Audit history</TextLink>;
  const data = activity.data;
  if (!data) {
    return (
      <Widget title="Recent accounting activity" footer={footer}>
        <Unavailable reason={activity.unavailableReason ?? "Recent accounting activity could not be read."} />
      </Widget>
    );
  }
  if (data.length === 0) {
    return (
      <Widget title="Recent accounting activity" footer={footer}>
        <Empty title="No recent activity to show." />
      </Widget>
    );
  }
  return (
    <Widget title="Recent accounting activity" footer={footer}>
      <div className={`${styles.tableWrap} ${styles.tableFlush}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td className={styles.muted}>{formatDateTime(row.occurredAt, timeZone)}</td>
                <td className={styles.name}>{row.actor}</td>
                <td className={styles.wrap}>
                  <TextLink href={row.href}>
                    {row.verb} {row.entity.toLowerCase()}
                    {row.reference ? ` ${row.reference}` : ""}
                  </TextLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Widget>
  );
}
