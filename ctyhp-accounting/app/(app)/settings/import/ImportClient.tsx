"use client";
import { useCallback, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Segmented,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { parseCsv } from "@/lib/csv";
import { fromMinor } from "@/lib/domain/money";
import {
  fieldsFor,
  proposeMapping,
  TARGET_LABEL,
  type ImportTarget,
} from "@/lib/domain/import-mapping";
import ImportColumnsTable from "./ImportColumnsTable";
import type { ImportPreview } from "@/lib/services/data-import";
import { previewImportAction, runImportAction, suggestMappingAction } from "./actions";

const TARGETS: ImportTarget[] = ["chart_of_accounts", "customers", "vendors", "items", "invoices"];

/**
 * Bringing a company's lists across from QuickBooks or Wave.
 *
 * Three steps, in this order for a reason: read the file, agree what the
 * columns mean, then see exactly what will happen before anything happens. An
 * import that posts on the first click is one mis-mapped column away from a
 * ledger nobody can unpick — and a numbered document cannot be deleted once it
 * exists.
 */
export default function ImportClient({
  companyName,
  isSampleCompany,
  baseDecimals,
}: {
  companyName: string;
  isSampleCompany: boolean;
  baseDecimals: number;
}) {
  const { message, modal } = App.useApp();
  const [target, setTarget] = useState<ImportTarget>("chart_of_accounts");
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [withBalances, setWithBalances] = useState(false);
  const [asOf, setAsOf] = useState<Dayjs>(dayjs().startOf("year"));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<string[]>([]);

  const fields = fieldsFor(target);
  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals }),
    [baseDecimals],
  );

  function reset() {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setUnmapped([]);
    setPreview(null);
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const records = parseCsv(String(reader.result));
      if (records.length === 0) {
        message.warning("That file has no rows under its header.");
        return;
      }
      const columns = Object.keys(records[0]);
      // Match by name first and show that straight away: the screen is usable
      // before the model answers, and stays usable if it never does.
      const proposed = proposeMapping(columns, target);
      setHeaders(columns);
      setRows(records.map((record) => columns.map((column) => record[column] ?? "")));
      setMapping(proposed.columns);
      setUnmapped(proposed.unmapped);
      setAiNote(null);
      setAiFields([]);
      setPreview(null);
      setFileName(file.name);
      message.info(
        proposed.missingRequired.length === 0
          ? `Read ${records.length} row(s). Check the columns below.`
          : `Read ${records.length} row(s), but some required columns need choosing.`,
      );

      // Then ask the model to fill what the names could not, in the background.
      // Only the headers go out; the rows never leave this browser until import.
      setAiBusy(true);
      void suggestMappingAction(columns, target)
        .then((result) => {
          if (!result.ok || !result.data) return;
          if (result.data.aiFields.length === 0 && !result.data.note) return;
          setMapping(result.data.columns);
          setUnmapped(result.data.unmapped);
          setAiFields(result.data.aiFields);
          setAiNote(result.data.note);
        })
        .finally(() => setAiBusy(false));
    };
    reader.readAsText(file);
    return false;
  }

  const missingRequired = fields
    .filter((field) => field.required && (mapping[field.key] ?? null) === null)
    .map((field) => field.label);

  async function runPreview() {
    setBusy(true);
    const res = await previewImportAction(target, rows, mapping);
    setBusy(false);
    if (res.ok && res.data) setPreview(res.data);
    else message.error(res.error ?? "Could not read the file");
  }

  function confirmImport() {
    if (!preview) return;
    const balances = withBalances && preview.openingTotalMinor !== 0;
    modal.confirm({
      title: `Import into ${companyName}?`,
      width: 540,
      okText: "Import",
      okButtonProps: { danger: balances },
      content: (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <div>
            {preview.creates} to create, {preview.updates} to update.
          </div>
          {balances ? (
            <Alert
              type="warning"
              showIcon
              message="This also posts to the ledger"
              description={
                <>
                  Opening balances of <b>{money(preview.openingTotalMinor)}</b> will be brought
                  across as of {asOf.format("YYYY-MM-DD")}. Opening balances can only be brought
                  across once — a second attempt is refused rather than doubling the books.
                </>
              }
            />
          ) : (
            <Alert type="info" showIcon message="Lists only. Nothing is posted to the ledger." />
          )}
          {!isSampleCompany ? (
            <Alert
              type="error"
              showIcon
              message="These are live books"
              description="Not a sample company. Imported documents cannot be deleted afterwards."
            />
          ) : null}
        </Space>
      ),
      onOk: async () => {
        setBusy(true);
        const res = await runImportAction(
          target,
          rows,
          mapping,
          balances ? asOf.format("YYYY-MM-DD") : null,
        );
        setBusy(false);
        if (!res.ok || !res.data) {
          message.error(res.error ?? "Import failed");
          throw new Error(res.error);
        }
        const { created, updated, skipped, openingCreated } = res.data;
        message.success(
          `${created} created, ${updated} updated, ${skipped} skipped` +
            (openingCreated ? `, ${openingCreated} opening balance(s) brought across` : ""),
        );
        reset();
      },
    });
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type={isSampleCompany ? "info" : "warning"}
        showIcon
        message={
          <>
            Importing into <b>{companyName}</b>
            {isSampleCompany ? <Tag color="orange" style={{ marginLeft: 8 }}>sample</Tag> : null}
          </>
        }
        description={
          isSampleCompany
            ? "A sample company. Load anything here to try it out — it can be thrown away without touching real books."
            : "These are live books. Try the file on a sample company first: a numbered document cannot be deleted once it exists."
        }
      />

      <Steps
        size="small"
        current={preview ? 2 : headers.length > 0 ? 1 : 0}
        items={[
          { title: "Choose and upload" },
          { title: "Agree the columns" },
          { title: "See what will happen" },
        ]}
      />

      <Space wrap>
        <Segmented
          value={target}
          onChange={(value) => {
            setTarget(value as ImportTarget);
            reset();
          }}
          options={TARGETS.map((t) => ({ label: TARGET_LABEL[t], value: t }))}
        />
        <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={readFile}>
          <Button icon={<UploadOutlined />}>Choose a CSV file</Button>
        </Upload>
        {fileName ? <Typography.Text type="secondary">{fileName}</Typography.Text> : null}
      </Space>

      {headers.length > 0 ? (
        <>
          <ImportColumnsTable
            fields={fields}
            headers={headers}
            mapping={mapping}
            unmapped={unmapped}
            aiFields={aiFields}
            aiBusy={aiBusy}
            aiNote={aiNote}
            onChange={(fieldKey, columnIndex) =>
              setMapping((prev) => ({ ...prev, [fieldKey]: columnIndex }))
            }
          />

          <Space wrap>
            <Button type="primary" onClick={runPreview} loading={busy} disabled={missingRequired.length > 0}>
              See what will happen
            </Button>
            {missingRequired.length > 0 ? (
              <Typography.Text type="danger">
                Still to choose: {missingRequired.join(", ")}
              </Typography.Text>
            ) : null}
          </Space>
        </>
      ) : null}

      {preview ? (
        <>
          <Space size="large" wrap>
            <Statistic title="To create" value={preview.creates} />
            <Statistic title="To update" value={preview.updates} />
            <Statistic
              title="Rows with problems"
              value={preview.problems.length}
              valueStyle={preview.problems.length ? { color: "#cf1322" } : undefined}
            />
            {preview.openingTotalMinor !== 0 && target !== "invoices" ? (
              <Statistic title="Opening balances in the file" value={money(preview.openingTotalMinor)} />
            ) : null}
          </Space>

          {preview.problems.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`${preview.problems.length} row(s) will be left out`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.problems.slice(0, 8).map((problem, index) => (
                    <li key={index}>
                      Row {problem.row}: {problem.message}
                    </li>
                  ))}
                  {preview.problems.length > 8 ? <li>…and {preview.problems.length - 8} more</li> : null}
                </ul>
              }
            />
          ) : null}

          {preview.openingTotalMinor !== 0 ? (
            <Space direction="vertical" size={4}>
              <Checkbox checked={withBalances} onChange={(e) => setWithBalances(e.target.checked)}>
                Also bring the opening balances across
              </Checkbox>
              {withBalances ? (
                <Space>
                  <span>as of</span>
                  <DatePicker value={asOf} onChange={(d) => d && setAsOf(d)} allowClear={false} />
                  <Typography.Text type="secondary">
                    {target === "customers" || target === "vendors"
                      ? "Raised as one opening document each, so the ageing and the control account agree."
                      : "Posted against Opening Balance Equity."}
                  </Typography.Text>
                </Space>
              ) : null}
            </Space>
          ) : null}

          <Table
            size="small"
            rowKey={(row) => `${row.action}-${row.key}`}
            pagination={{ pageSize: 10 }}
            dataSource={preview.rows}
            columns={[
              {
                title: "",
                dataIndex: "action",
                width: 90,
                render: (action: string) => (
                  <Tag color={action === "create" ? "green" : "blue"}>{action}</Tag>
                ),
              },
              { title: "Name", dataIndex: "name" },
              { title: "Matched on", dataIndex: "key", width: 200 },
              {
                title: target === "invoices" ? "Invoice subtotal" : "Opening balance",
                dataIndex: "openingBalanceMinor",
                width: 150,
                align: "right",
                render: (value: number) => (value === 0 ? "—" : money(value)),
              },
            ]}
          />

          <Button type="primary" onClick={confirmImport} loading={busy} disabled={preview.rows.length === 0}>
            Import {preview.rows.length} row(s)
          </Button>
        </>
      ) : null}
    </Space>
  );
}
