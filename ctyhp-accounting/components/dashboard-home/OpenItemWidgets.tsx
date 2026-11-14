"use client";
import StatusTag from "@/components/ui/StatusTag";
import { tokenVar } from "@/lib/design/tokens";
import type { HomeOpenSide, HomePayables, HomePayment, HomeReceivables, HomeStatus } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { stackShares } from "./charts/geometry";
import styles from "./dashboard-home.module.css";
import { billDueLook, daysLate, otherCurrencies } from "./view";
import { Empty, LinkButton, Spacer, TextLink, Unavailable, Widget } from "./Widget";

type Money = (minor: number) => string;

const OVERDUE = tokenVar("intent.danger");
const DUE_SOON = tokenVar("intent.warning");

/**
 * The open invoices or bills split by due date: what is overdue, what falls
 * due in the next 7 days, and what is due later, as one bar and three figures.
 * The headline is the aging report's total, so it agrees with the figure above
 * the tabs; credits and unapplied payments are what make the two differ from
 * the three parts, and the line under the headline says by how much.
 */
function OpenSideSummary({
  side,
  noun,
  laterLabel,
  laterColor,
  money,
}: {
  side: HomeOpenSide;
  /** "invoice" or "bill" */
  noun: string;
  laterLabel: string;
  laterColor: string;
  money: Money;
}) {
  const [overdueShare, soonShare, laterShare] = stackShares([side.overdueMinor, side.dueSoonMinor, side.laterMinor]);
  const parts = [
    { key: "overdue", label: "Overdue", color: OVERDUE, minor: side.overdueMinor, count: side.overdueDocuments, share: overdueShare },
    { key: "soon", label: "Due in 7 days", color: DUE_SOON, minor: side.dueSoonMinor, count: side.dueSoonDocuments, share: soonShare },
    { key: "later", label: laterLabel, color: laterColor, minor: side.laterMinor, count: side.laterDocuments, share: laterShare },
  ];
  return (
    <>
      <div className={styles.hero}>
        <span className={styles.heroValue}>{money(side.totalMinor)}</span>
        <span className={styles.heroSub}>Unpaid · {plural(side.documents, `open ${noun}`)}</span>
        {side.creditsMinor < 0 ? (
          <span className={styles.heroSub}>After {money(-side.creditsMinor)} in credits and unapplied payments</span>
        ) : null}
      </div>
      <div
        className={styles.stack}
        role="img"
        aria-label={parts.map((part) => `${part.label} ${money(part.minor)}`).join(", ")}
      >
        {parts.map((part) =>
          part.share > 0 ? <i key={part.key} style={{ width: `${part.share}%`, background: part.color }} /> : null,
        )}
      </div>
      <div className={styles.figs}>
        {parts.map((part) => (
          <div key={part.key} className={styles.fig}>
            <span className={styles.figLabel}>
              <i className={styles.figKey} style={{ background: part.color }} aria-hidden="true" />
              {part.label}
            </span>
            <b className={styles.figValue}>{money(part.minor)}</b>
            <span className={styles.figCount}>{plural(part.count, noun)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- invoices */

/**
 * Invoices, the wide card of Money in: what customers owe split by due date,
 * what came in over the last 30 days, and the customers who have owed longest.
 */
export function InvoicesWidget({
  receivables,
  status,
  asOf,
  money,
  currencyCode,
}: {
  receivables: SectionEnvelope<HomeReceivables>;
  status: HomeStatus | null;
  asOf: string;
  money: Money;
  currencyCode: string;
}) {
  const footer = (
    <>
      <TextLink href="/reports/ar-aging">A/R Aging</TextLink>
      <Spacer />
      <LinkButton href={`/invoices?queue=overdue&asOf=${asOf}`}>Review overdue</LinkButton>
      <LinkButton href="/invoices?new=1" primary>
        Create invoice
      </LinkButton>
    </>
  );
  const data = receivables.data;
  if (!data) {
    return (
      <Widget title="Invoices" footer={footer}>
        <Unavailable reason={receivables.unavailableReason ?? "Invoices could not be read."} />
      </Widget>
    );
  }
  if (status?.firstUse && data.documents === 0 && data.totalMinor === 0) {
    return (
      <Widget title="Invoices">
        <Empty title="No invoices yet" action={<LinkButton href="/invoices?new=1" primary>Create invoice</LinkButton>}>
          What customers owe and what they paid shows here.
        </Empty>
      </Widget>
    );
  }
  const received = data.receivedLast30;
  return (
    <Widget title="Invoices" footer={footer}>
      <div className={styles.split}>
        <div className={styles.splitMain}>
          <OpenSideSummary side={data} noun="invoice" laterLabel="Not due yet" laterColor={tokenVar("series.income")} money={money} />
          <p className={styles.caption}>
            <b>{money(received.baseMinor)}</b> received in the last 30 days
            {otherCurrencies(received.otherCurrencyCount)}
            {data.undepositedMinor !== null && data.undepositedMinor !== 0 ? ` · ${money(data.undepositedMinor)} not deposited yet` : ""}
          </p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Owes longest</th>
                <th scope="col">Oldest invoice</th>
                <th scope="col" className={styles.num}>
                  Overdue ({currencyCode})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.owesLongest.length === 0 ? (
                <tr>
                  <td colSpan={3} className={styles.muted}>
                    No customer is overdue.
                  </td>
                </tr>
              ) : (
                data.owesLongest.map((row) => (
                  <tr key={row.customerId}>
                    <td className={styles.name}>
                      <TextLink href={`/customers/${row.customerId}`}>{row.name}</TextLink>
                    </td>
                    <td className={styles.muted}>{daysLate(row.daysLate)}</td>
                    <td className={styles.num}>{money(row.overdueMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Widget>
  );
}

/* ---------------------------------------------------------------------- bills */

/** Bills, the wide card of Money out: what is owed to vendors split by due date, and the next bills to pay. */
export function BillsWidget({
  payables,
  status,
  money,
  currencyCode,
}: {
  payables: SectionEnvelope<HomePayables>;
  status: HomeStatus | null;
  money: Money;
  currencyCode: string;
}) {
  const footer = (
    <>
      <TextLink href="/reports/ap-aging">A/P Aging</TextLink>
      <Spacer />
      <LinkButton href="/bills?new=1">Enter bill</LinkButton>
      <LinkButton href="/pay-bills" primary>
        Pay bills
      </LinkButton>
    </>
  );
  const data = payables.data;
  if (!data) {
    return (
      <Widget title="Bills" footer={footer}>
        <Unavailable reason={payables.unavailableReason ?? "Bills could not be read."} />
      </Widget>
    );
  }
  if (status?.firstUse && data.documents === 0 && data.totalMinor === 0) {
    return (
      <Widget title="Bills">
        <Empty title="No bills yet" action={<LinkButton href="/bills?new=1">Enter bill</LinkButton>}>
          What you owe suppliers and when it falls due shows here.
        </Empty>
      </Widget>
    );
  }
  const paid = data.paidLast30;
  return (
    <Widget title="Bills" footer={footer}>
      <div className={styles.split}>
        <div className={styles.splitMain}>
          <OpenSideSummary side={data} noun="bill" laterLabel="Due later" laterColor={tokenVar("series.secondary")} money={money} />
          <p className={styles.caption}>
            <b>{money(paid.baseMinor)}</b> paid in the last 30 days
            {otherCurrencies(paid.otherCurrencyCount)}
          </p>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Due</th>
                <th scope="col">Vendor</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>
                  Amount ({currencyCode})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.nextBills.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.muted}>
                    No open bills.
                  </td>
                </tr>
              ) : (
                data.nextBills.map((bill, i) => {
                  const look = billDueLook(bill.daysUntilDue);
                  return (
                    <tr key={`${bill.vendorName}-${bill.billNumber ?? ""}-${i}`}>
                      <td>{formatDate(bill.dueDate)}</td>
                      <td className={styles.name}>
                        {bill.vendorName}
                        {bill.billNumber ? <span className={styles.aside}>{bill.billNumber}</span> : null}
                      </td>
                      <td>
                        <StatusTag status="due" looks={{ due: look }} />
                      </td>
                      <td className={styles.num}>{money(bill.balanceMinor)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Widget>
  );
}

/* ------------------------------------------------------------ recent payments */

/** The latest customer payments, each in its own currency: a payment is never written as if it were in the base currency. */
export function PaymentsWidget({ payments }: { payments: SectionEnvelope<HomePayment[]> }) {
  const footer = <TextLink href="/payments">Payments</TextLink>;
  const data = payments.data;
  if (!data) {
    return (
      <Widget title="Recent payments" footer={footer}>
        <Unavailable reason={payments.unavailableReason ?? "Recent payments could not be read."} />
      </Widget>
    );
  }
  if (data.length === 0) {
    return (
      <Widget title="Recent payments" footer={footer}>
        <Empty title="No customer payments yet" action={<LinkButton href="/payments?new=1">Receive payment</LinkButton>}>
          Payments from customers are listed here as they are recorded.
        </Empty>
      </Widget>
    );
  }
  return (
    <Widget title="Recent payments" footer={footer}>
      <div className={`${styles.tableWrap} ${styles.tableFlush}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Received</th>
              <th scope="col">Customer</th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((payment) => (
              <tr key={payment.id}>
                <td className={styles.muted}>{formatDate(payment.date)}</td>
                <td className={styles.name}>{payment.customerName}</td>
                <td className={styles.num}>{formatMoney(payment.amountMinor, payment.currencyCode, payment.decimals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Widget>
  );
}

/* ---------------------------------------------------------------------- aging */

const BUCKETS: readonly { key: keyof HomeOpenSide["buckets"]; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90_plus", label: "Over 90 days" },
];

/**
 * Receivables and payables side by side by how long past due, totalled as the
 * two aging reports total them. Either side can fail alone: its column then
 * says so, and the other stays.
 */
export function AgingWidget({
  receivables,
  payables,
  money,
  currencyCode,
}: {
  receivables: SectionEnvelope<HomeReceivables>;
  payables: SectionEnvelope<HomePayables>;
  money: Money;
  currencyCode: string;
}) {
  const footer = (
    <>
      <TextLink href="/reports/ar-aging">A/R Aging</TextLink>
      <Spacer />
      <TextLink href="/reports/ap-aging">A/P Aging</TextLink>
    </>
  );
  const ar = receivables.data;
  const ap = payables.data;
  if (!ar && !ap) {
    return (
      <Widget title="Receivables and payables aging" footer={footer}>
        <Unavailable reason="Receivables and payables could not be read." />
      </Widget>
    );
  }
  const cell = (side: HomeOpenSide | null, minor: (side: HomeOpenSide) => number) => (side ? money(minor(side)) : "—");
  const missing = !ar ? receivables.unavailableReason ?? "Invoices could not be read." : !ap ? payables.unavailableReason ?? "Bills could not be read." : null;
  return (
    <Widget title="Receivables and payables aging" footer={footer}>
      <div className={`${styles.tableWrap} ${styles.tableFlush}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Past due</th>
              <th scope="col" className={styles.num}>
                Receivables ({currencyCode})
              </th>
              <th scope="col" className={styles.num}>
                Payables ({currencyCode})
              </th>
            </tr>
          </thead>
          <tbody>
            {BUCKETS.map((bucket) => (
              <tr key={bucket.key}>
                <th scope="row">{bucket.label}</th>
                <td className={styles.num}>{cell(ar, (side) => side.buckets[bucket.key])}</td>
                <td className={styles.num}>{cell(ap, (side) => side.buckets[bucket.key])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total open</th>
              <td className={styles.num}>{cell(ar, (side) => side.totalMinor)}</td>
              <td className={styles.num}>{cell(ap, (side) => side.totalMinor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {missing ? (
        <p className={styles.caption} role="alert">
          {missing} The other figures on this page are still current.
        </p>
      ) : null}
    </Widget>
  );
}
