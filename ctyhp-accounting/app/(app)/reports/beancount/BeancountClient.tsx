"use client";
import { useState } from "react";
import { Alert, App, Button, Card, Space, Statistic, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { downloadTextFile } from "@/lib/client/download";
import type { BeancountSummary } from "@/lib/services/beancount";
import { beancountExportAction } from "./actions";

/**
 * One button and what to do with the file afterwards. The file itself is not
 * shown: a book of several thousand entries is too heavy to render.
 */
export default function BeancountClient({
  summary,
  summaryError,
  canExport,
}: {
  summary: BeancountSummary | null;
  summaryError: string | null;
  canExport: boolean;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    const result = await beancountExportAction();
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The file could not be produced.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, "text/plain;charset=utf-8");
    message.success(`${result.data.fileName} saved, ${result.data.entryCount} entries.`);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {summaryError ? <Alert type="error" showIcon message={summaryError} /> : null}

      {summary ? (
        <Space size="large" wrap>
          <Statistic title="Posted entries" value={summary.entryCount} />
          <Statistic title="Accounts" value={summary.accountCount} />
          <Statistic title="First entry" value={summary.firstDate ?? "—"} />
          <Statistic title="Last entry" value={summary.lastDate ?? "—"} />
          <Statistic title="Currencies" value={summary.currencies.join(", ") || "—"} />
        </Space>
      ) : null}

      {!canExport ? (
        <Alert
          type="info"
          showIcon
          message="Exporting the ledger needs the Export company data permission."
          description="This file is the whole book, so it is held to the same permission as exporting the company."
        />
      ) : null}

      <div>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => void download()}
          loading={busy}
          disabled={!canExport}
        >
          Download .beancount file
        </Button>
      </div>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <Card title="Running it">
        <Typography.Paragraph>
          Install once with <Typography.Text code>pip install beancount fava</Typography.Text>. Then{" "}
          <Typography.Text code>bean-check &lt;file&gt;</Typography.Text> proves the books balance, and{" "}
          <Typography.Text code>fava &lt;file&gt;</Typography.Text> opens them at{" "}
          <Typography.Text code>localhost:5000</Typography.Text>.
        </Typography.Paragraph>
        <Typography.Paragraph>
          <strong>Documents survive the export.</strong> Invoices and bills carry a tag and a link; the payment that
          settles one carries the same link, so Fava groups them. Due dates travel as{" "}
          <Typography.Text code>due:</Typography.Text> metadata, and every transaction carries its OneBook entry number
          as <Typography.Text code>entry:</Typography.Text>.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Amounts are in each entry&apos;s own currency, which is the currency OneBook requires it to balance in.
          Price directives let Fava convert them to the base currency.
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
