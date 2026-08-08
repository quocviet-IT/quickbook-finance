"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Radio,
  Space,
  Statistic,
  Table,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { parseCsvGrid } from "@/lib/csv";
import { calculateFileSha256 } from "@/lib/client/documents";
import { fromMinor } from "@/lib/domain/money";
import {
  isWaveLedgerGrid,
  parseWaveLedger,
  waveLedgerPayload,
  type WaveLedgerParse,
  type WaveLedgerSection,
} from "@/lib/domain/wave-ledger";
import type { ImportBatchRow } from "@/lib/services/ledger-import";
import LedgerBatchList from "./LedgerBatchList";
import UnresolvedAccountsTable from "./UnresolvedAccountsTable";
import CreateAccountFromImport from "./CreateAccountFromImport";
import type { AccountRow } from "@/lib/db/types";
import type { UnresolvedRef } from "@/lib/services/import-preflight";
import { saveLedgerCopy } from "./saveLedgerCopy";
import {
  importLedgerAction,
  linkImportBatchReportAction,
  listImportBatchesAction,
  ledgerPreflightAction,
} from "./actions";

export interface LedgerImportPanelProps {
  companyName: string;
  isSampleCompany: boolean;
  baseDecimals: number;
  canManage: boolean;
  /** The whole chart, for pointing a name in the file at an account. */
  accounts: AccountRow[];
}

function sectionColumns(money: (minor: number) => string) {
  return [
    { title: "Account", dataIndex: "account" },
    { title: "Rows", dataIndex: "rows", width: 80, align: "right" as const },
    {
      title: "Debit",
      dataIndex: "debitMinor",
      width: 150,
      align: "right" as const,
      render: (value: number) => money(value),
    },
    {
      title: "Credit",
      dataIndex: "creditMinor",
      width: 150,
      align: "right" as const,
      render: (value: number) => money(value),
    },
  ];
}

/**
 * The tab for a general ledger export.
 *
 * There is no column mapping here, and that is the point: a row's meaning comes
 * from the section it sits in, not from a header. The file is read in the
 * browser, checked, and only then sent — once, whole, in one transaction.
 */
export default function LedgerImportPanel({
  companyName,
  isSampleCompany,
  baseDecimals,
  canManage,
  accounts,
}: LedgerImportPanelProps) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState<WaveLedgerParse | null>(null);
  const [mode, setMode] = useState<"history" | "balances">("history");
  const [asOf, setAsOf] = useState(dayjs());
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  // Null while the question has not been asked or answered yet, so the button
  // stays shut rather than opening on an unchecked file.
  const [missingAccounts, setMissingAccounts] = useState<UnresolvedRef[] | null>(null);
  /** What the reader decided a name in the file means, as an account code. */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [created, setCreated] = useState<AccountRow[]>([]);

  const refresh = useCallback(() => {
    void listImportBatchesAction().then((result) => {
      if (result.ok && result.data) setBatches(result.data);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const money = (minor: number) =>
    fromMinor(minor, baseDecimals).toLocaleString(undefined, {
      minimumFractionDigits: baseDecimals,
    });

  function readFile(candidate: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsvGrid(String(reader.result));
      if (!isWaveLedgerGrid(grid)) {
        message.error(
          "That does not look like an Account Transactions report. It needs account, date, debit, credit and balance columns.",
        );
        return;
      }
      const result = parseWaveLedger(grid);
      setParse(result);
      setFile(candidate);
      setMissingAccounts(null);
      setOverrides({});
      if (result.toDate) setAsOf(dayjs(result.toDate));
      message.info(
        `${result.sections.length} accounts, ${result.entries.length} dates, ${result.lineCount} lines.`,
      );
      // Ask the database which names it cannot find, using the same resolver
      // the import uses, so the screen and the server cannot disagree.
      void checkAccounts(result.sections.map((s) => ({ ref: s.account, rows: s.rows })), {});
    };
    reader.readAsText(candidate);
    return false;
  }

  /**
   * Ask the database which names it cannot find, using the same resolver the
   * import uses, so the screen and the server cannot disagree.
   */
  function checkAccounts(
    refs: { ref: string; rows: number }[],
    answers: Record<string, string>,
  ) {
    void ledgerPreflightAction(refs, answers).then((answer) => {
      if (answer.ok && answer.data) setMissingAccounts(answer.data);
      else message.error(answer.error ?? "Could not check the accounts in this file");
    });
  }

  function answer(next: Record<string, string>) {
    setOverrides(next);
    if (parse) checkAccounts(parse.sections.map((s) => ({ ref: s.account, rows: s.rows })), next);
  }

  const blocked =
    !parse ||
    parse.unbalancedDates.length > 0 ||
    parse.sectionMismatches.length > 0 ||
    parse.entries.length === 0 ||
    missingAccounts === null ||
    missingAccounts.length > 0;

  async function runImport() {
    if (!parse || !file) return;
    setBusy(true);
    try {
      // The reader's answers travel as account codes, so the server resolves
      // them the one way it resolves everything.
      const entries = waveLedgerPayload(parse, mode, asOf.format("YYYY-MM-DD")).map((entry) => ({
        ...entry,
        lines: entry.lines.map((line) => ({
          ...line,
          account: overrides[line.account] ?? line.account,
        })),
      }));
      const sha256 = await calculateFileSha256(file);
      const imported = await importLedgerAction(mode, file.name, sha256, entries);
      if (!imported.ok || !imported.data) {
        throw new Error(imported.error ?? "The import was refused");
      }
      message.success(
        `${imported.data.entries} entries and ${imported.data.lines} lines posted into ${companyName}.`,
      );

      // The ledger is the important half. A failed copy is worth a warning, not
      // an undo of an import that worked.
      const copy = await saveLedgerCopy(file, parse);
      if (copy.ok && copy.reportId) {
        await linkImportBatchReportAction(imported.data.batchId, copy.reportId);
      } else {
        message.warning(`The ledger posted, but the original file was not kept: ${copy.error}`);
      }
      setFile(null);
      setParse(null);
      refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "The import was refused");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="One file, every account"
        description={
          "A general ledger export holds every account already — there is nothing to import " +
          "separately. Each row is one side of a double entry, so One Book groups the rows by " +
          "date and posts one balanced journal entry per date."
        }
      />

      <Upload.Dragger accept=".csv" maxCount={1} beforeUpload={readFile} showUploadList={false}>
        <p>
          <UploadOutlined /> {file ? file.name : "Drop the Account Transactions export here"}
        </p>
      </Upload.Dragger>

      {parse ? (
        <Card size="small">
          <Space size="large" wrap>
            <Statistic title="Accounts" value={parse.sections.length} />
            <Statistic title="Entries" value={parse.entries.length} />
            <Statistic title="Lines" value={parse.lineCount} />
            <Statistic title="Total debits" value={money(parse.totalDebitMinor)} />
            <Statistic
              title="Covers"
              value={parse.fromDate ? `${parse.fromDate} → ${parse.toDate}` : "—"}
            />
          </Space>

          {parse.skippedZeroRows > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message={`${parse.skippedZeroRows} row(s) carry no money and will be left out.`}
            />
          ) : null}

          {parse.unbalancedDates.length > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message="Some dates do not balance"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {parse.unbalancedDates.slice(0, 8).map((day) => (
                    <li key={day.date}>
                      {day.date}: off by {money(day.differenceMinor)}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {missingAccounts && missingAccounts.length > 0 ? (
            <UnresolvedAccountsTable
              rows={missingAccounts}
              accounts={[...accounts, ...created]}
              overrides={overrides}
              onOverride={(ref, code) => {
                const next = { ...overrides };
                if (code) next[ref] = code;
                else delete next[ref];
                answer(next);
              }}
              onCreateAccount={setCreatingFor}
              countLabel="Lines"
            />
          ) : null}

          {missingAccounts && missingAccounts.length > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message={`${missingAccounts.length} name(s) in this file do not name one account`}
              description="Point each at an account that already exists, or create it above. A ledger row never creates an account on its own — the same name can mean different things in two charts, and a typo would become a permanent account."
            />
          ) : null}

          {parse.sectionMismatches.length > 0 ? (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message="One Book read this file differently from the file's own totals"
              description={`${parse.sectionMismatches.join(", ")}. Nothing will be imported — send this file to support rather than working around it.`}
            />
          ) : null}

          <Table<WaveLedgerSection>
            style={{ marginTop: 12 }}
            size="small"
            rowKey="account"
            pagination={false}
            scroll={{ y: 320 }}
            dataSource={parse.sections}
            columns={sectionColumns(money)}
          />
        </Card>
      ) : null}

      {parse ? (
        <Card size="small" title="What to bring across">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
              <Space direction="vertical">
                <Radio value="history">
                  The whole history — {parse.entries.length} entries, {parse.lineCount} lines, dated
                  as the file dates them
                </Radio>
                <Radio value="balances">
                  Closing balances only — one entry, {parse.balances.length} lines
                </Radio>
              </Space>
            </Radio.Group>
            {mode === "balances" ? (
              <Space>
                <span>as of</span>
                <DatePicker
                  value={asOf}
                  onChange={(date) => date && setAsOf(date)}
                  allowClear={false}
                />
              </Space>
            ) : null}
            {!isSampleCompany ? (
              <Alert
                type="warning"
                showIcon
                message="These are live books"
                description={`Everything posts into ${companyName} in one transaction. It can be undone from the list below, but an entry in a closed period cannot be voided.`}
              />
            ) : null}
            <Button
              type="primary"
              loading={busy}
              disabled={blocked || !canManage}
              onClick={runImport}
            >
              Import {mode === "history" ? parse.entries.length : 1}{" "}
              {mode === "history" && parse.entries.length !== 1 ? "entries" : "entry"}
            </Button>
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="Ledgers imported before">
        <CreateAccountFromImport
          ref={creatingFor}
          onClose={() => setCreatingFor(null)}
          onCreated={(account) => {
            setCreated((current) => [
              ...current,
              { ...(account as unknown as AccountRow), status: "active" } as AccountRow,
            ]);
            if (creatingFor) answer({ ...overrides, [creatingFor]: account.account_code });
            setCreatingFor(null);
          }}
        />

        <LedgerBatchList
          batches={batches.filter((batch) => batch.source === "wave_ledger")}
          canManage={canManage}
          onChanged={refresh}
        />
      </Card>
    </Space>
  );
}
