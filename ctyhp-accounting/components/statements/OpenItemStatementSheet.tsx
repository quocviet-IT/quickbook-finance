import type { OpenItemStatement } from "@/lib/domain/open-item-statement";
import styles from "./open-item-statement.module.css";

/**
 * The open-item statement on a sheet of A4 (3.0.13), as the prototype's
 * statementHTML lays it out: the company and "Statement" with its date, who it
 * is for, each open item aged, the totals by age, how to pay, and what the
 * figures are.
 *
 * Plain HTML with no Ant Design, so it renders on the server and prints as it
 * shows. Every word on it comes from the statement model, which the PDF and the
 * email read too, so the three cannot disagree.
 */
export default function OpenItemStatementSheet({ statement }: { statement: OpenItemStatement }) {
  const { seller, party, lines } = statement;

  return (
    <article className={styles.sheet} aria-label={`Statement for ${statement.customerName}`}>
      <header className={styles.top}>
        <div className={styles.seller}>
          <p className={styles.company}>{seller.displayName}</p>
          {seller.legalLine ? <p className={styles.sub}>{seller.legalLine}</p> : null}
          {seller.lines.map((line, index) => (
            <p key={`${index}:${line}`} className={styles.sub}>
              {line}
            </p>
          ))}
        </div>
        <div className={styles.meta}>
          <h2 className={styles.kind}>Statement</h2>
          <table className={styles.facts}>
            <tbody>
              <tr>
                <th scope="row">As of</th>
                <td>{statement.asOfText}</td>
              </tr>
              <tr>
                <th scope="row">Open items</th>
                <td>{lines.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      <div className={styles.party}>
        <p className={styles.label}>Statement for</p>
        <p className={styles.partyName}>{party.name}</p>
        {party.lines.map((line, index) => (
          <p key={`${index}:${line}`} className={styles.sub}>
            {line}
          </p>
        ))}
      </div>

      {lines.length > 0 ? (
        <>
          <table className={styles.lines} aria-label="Open items">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className={styles.r}>Due</th>
                <th scope="col" className={styles.r}>Age</th>
                <th scope="col" className={styles.r}>Amount</th>
                <th scope="col" className={styles.r}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                // A payment not yet applied, or a credit not yet used, comes off the total.
                const figure = line.outstandingMinor < 0 ? `${styles.r} ${styles.credit}` : styles.r;
                return (
                  <tr key={line.key}>
                    <td>
                      {line.date}
                      <span className={styles.docNumber}>{line.docNumber}</span>
                    </td>
                    <td>{line.description}</td>
                    <td className={styles.r}>{line.due}</td>
                    <td className={line.overdue ? `${styles.r} ${styles.overdue}` : styles.r}>{line.age}</td>
                    <td className={figure}>{line.amount}</td>
                    <td className={figure}>{line.outstanding}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className={styles.totals} aria-label="Totals by age">
            <tbody>
              {statement.buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <th scope="row">{bucket.label}</th>
                  <td>{bucket.amount}</td>
                </tr>
              ))}
              <tr className={styles.due}>
                <th scope="row">{statement.totalLabel}</th>
                <td>{statement.totalAmount}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <p className={styles.empty}>{statement.emptyText}</p>
      )}

      <footer className={styles.foot}>
        {statement.payNote ? (
          <p className={styles.payNote}>
            <strong>How to pay.</strong> {statement.payNote}
          </p>
        ) : null}
        <p className={styles.footnote}>{statement.footnote}</p>
      </footer>
    </article>
  );
}
