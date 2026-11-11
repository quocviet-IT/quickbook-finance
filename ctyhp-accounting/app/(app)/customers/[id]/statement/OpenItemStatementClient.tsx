"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, DatePicker, Tooltip } from "antd";
import { DownloadOutlined, MailOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import OpenItemStatementSheet from "@/components/statements/OpenItemStatementSheet";
import styles from "@/components/statements/open-item-statement.module.css";
import { downloadOpenItemStatementPdf } from "@/lib/client/invoice-pdf";
import { printReport, watchReportPrinting } from "@/lib/client/print-report";
import {
  openItemStatementDocument,
  openItemStatementEmail,
  openItemStatementFileName,
  type OpenItemStatement,
} from "@/lib/domain/open-item-statement";

/** Said on the Email button's tooltip when the customer has no address on file. */
const NO_EMAIL = "No email saved for this customer: your mail program opens without a recipient.";
/** The app sends no mail: the user's own mail program does, and the PDF goes with it by hand. */
const ATTACH_HINT = "Attach the PDF before sending.";

/**
 * The open-item statement's toolbar and its sheet (3.0.13): the As of day,
 * a way to the activity statement, then Print, Download PDF and Email.
 *
 * Another day is another page (`?asOf=`), read on the server; the page keys
 * this component by the day, so nothing from the last one carries over.
 */
export default function OpenItemStatementClient({
  statement,
  customerId,
}: {
  statement: OpenItemStatement;
  customerId: string;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);

  // Ctrl+P prints the sheet alone too, not only the Print button.
  useEffect(() => watchReportPrinting(), []);

  const email = useMemo(() => openItemStatementEmail(statement), [statement]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      await downloadOpenItemStatementPdf(openItemStatementDocument(statement), openItemStatementFileName(statement));
    } catch {
      message.error("The PDF could not be made. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  const emailButton = (
    <Button icon={<MailOutlined />} href={email.href} title={ATTACH_HINT}>
      Email
    </Button>
  );

  return (
    <>
      <FilterBar
        ariaLabel="Statement options"
        actions={
          <>
            <Button icon={<PrinterOutlined />} onClick={() => printReport()}>
              Print
            </Button>
            <Button icon={<DownloadOutlined />} loading={downloading} onClick={downloadPdf}>
              Download PDF
            </Button>
            {statement.customerEmail ? emailButton : <Tooltip title={NO_EMAIL}>{emailButton}</Tooltip>}
          </>
        }
      >
        <DatePicker
          aria-label="As of"
          prefix={<span className={styles.fieldLabel}>As of</span>}
          format="MM/DD/YYYY"
          allowClear={false}
          value={dayjs(statement.asOf)}
          onChange={(day) => {
            if (day) router.push(`/customers/${customerId}/statement?asOf=${day.format("YYYY-MM-DD")}`);
          }}
        />
        <Link href={`/reports/customer-statement?customer=${customerId}`}>Activity statement</Link>
      </FilterBar>
      <div className={styles.scroller}>
        <div className="report-print-area">
          <OpenItemStatementSheet statement={statement} />
        </div>
      </div>
    </>
  );
}
