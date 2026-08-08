"use client";
import { useCallback, useState } from "react";
import {
  Alert,
  App,
  Button,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { excludedRowsCsv } from "@/lib/domain/excluded-rows";
import { downloadTextFile } from "@/lib/client/download";
import type { AccountRow } from "@/lib/db/types";
import type { AccountType } from "@/lib/domain/accounts";
import { fromMinor } from "@/lib/domain/money";
import {
  fieldsFor,
  type ImportTarget,
} from "@/lib/domain/import-mapping";
import ImportColumnsTable from "./ImportColumnsTable";
import ImportPreviewPanel from "./ImportPreviewPanel";
import ImportGuidance from "./ImportGuidance";
import ImportToolbar from "./ImportToolbar";
import { useImportSource } from "./useImportSource";
import AccountTypeReview from "./AccountTypeReview";
import ImportBatchRegister from "./ImportBatchRegister";
import ImportPreflightSection from "./ImportPreflightSection";
import ImportConfirmContent from "./ImportConfirmContent";
import LedgerImportPanel from "./LedgerImportPanel";
import { detectFileShape } from "@/lib/domain/import-shape";
import type { ImportPreview } from "@/lib/services/data-import";
import {
  previewImportAction,
  runImportAction,
} from "./actions";

const TARGETS: ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
  "transactions",
  "general_ledger",
];

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
  bankAccounts,
  accounts,
}: {
  companyName: string;
  isSampleCompany: boolean;
  baseDecimals: number;
  /** Where a transaction row posts when the file does not name a bank. */
  bankAccounts: AccountRow[];
  /** The whole chart, for pointing a name in the file at an account. */
  accounts: AccountRow[];
}) {
  const { message, modal } = App.useApp();
  const [target, setTarget] = useState<ImportTarget>("chart_of_accounts");
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [withBalances, setWithBalances] = useState(false);
  const [asOf, setAsOf] = useState<Dayjs>(dayjs().startOf("year"));
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(0);
  // What the reader decided a name in the file means, as an account code.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // The file's own type word → the One Book type the reader chose for it.
  const [typeOverrides, setTypeOverrides] = useState<Record<string, AccountType>>({});
  const source = useImportSource(target);
  const { fileName, headers, rows, mapping, unmapped, aiBusy, aiNote, aiFields } = source;

  const fields = fieldsFor(target);
  // A ledger export has no columns to agree on, so none of the three steps —
  // upload, map, preview — apply to it. It gets its own panel instead.
  const ledgerTab = target === "general_ledger";
  // Derived from the headers already in state: no second copy of the file, and
  // nothing to keep in step when the tab changes.
  const detection = headers.length > 0 ? detectFileShape(headers) : null;
  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  function reset() {
    source.clear();
    setPreview(null);
    setOverrides({});
    setTypeOverrides({});
  }

  async function runPreview() {
    setBusy(true);
    const res = await previewImportAction(
      target,
      rows,
      mapping,
      bankAccountId,
      overrides,
      typeOverrides,
    );
    setBusy(false);
    if (res.ok && res.data) setPreview(res.data);
    else message.error(res.error ?? "Could not read the file");
  }

  /**
   * Write the rows this import will leave out, from the file already in hand.
   *
   * Nothing goes to the server: the browser still holds every row it read, so
   * the count on screen and the file written from it cannot disagree.
   */
  function downloadExcluded() {
    if (!preview?.excluded?.length) return;
    downloadTextFile(
      `${(fileName ?? "import").replace(/\.csv$/i, "")}-rows-left-out.csv`,
      excludedRowsCsv(headers, rows, preview.excluded),
    );
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
        <ImportConfirmContent
          target={target}
          preview={preview}
          balances={balances}
          isSampleCompany={isSampleCompany}
          money={money}
          asOf={asOf}
        />
      ),
      onOk: async () => {
        setBusy(true);
        const res = await runImportAction(
          target,
          rows,
          mapping,
          balances ? asOf.format("YYYY-MM-DD") : null,
          bankAccountId,
          fileName,
          overrides,
          typeOverrides,
        );
        setBusy(false);
        if (!res.ok || !res.data) {
          message.error(res.error ?? "Import failed");
          throw new Error(res.error);
        }
        const { created, updated, skipped, openingCreated, classification } = res.data;
        message.success(
          `${created} created, ${updated} updated, ${skipped} skipped` +
            (openingCreated
              ? `, ${openingCreated} opening balance(s) brought across`
              : "") +
            // Said out loud because it used to be silent, and its absence only
            // showed up later as a Cash Flow Statement stuck in review.
            (classification && classification.rolesSet > 0
              ? `. ${classification.rolesSet} account(s) classified for cash flow`
              : "") +
            (classification && classification.stillUnclassified.length > 0
              ? `; ${classification.stillUnclassified.length} still need a policy — set it under Chart of accounts`
              : ""),
        );
        reset();
        setImported((count) => count + 1);
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
            {isSampleCompany ? (
              <Tag color="orange" style={{ marginLeft: 8 }}>
                sample
              </Tag>
            ) : null}
          </>
        }
        description={
          isSampleCompany
            ? "A sample company. Load anything here to try it out — it can be thrown away without touching real books."
            : "These are live books. Try the file on a sample company first: a numbered document cannot be deleted once it exists."
        }
      />

      {ledgerTab ? null : (
        <Steps
          size="small"
          current={preview ? 2 : headers.length > 0 ? 1 : 0}
          items={[
            { title: "Choose and upload" },
            { title: "Agree the columns" },
            { title: "See what will happen" },
          ]}
        />
      )}

      <ImportToolbar
        targets={TARGETS}
        target={target}
        onTargetChange={(next) => {
          setTarget(next);
          reset();
        }}
        bankAccounts={bankAccounts}
        bankAccountId={bankAccountId}
        onBankAccountChange={setBankAccountId}
        ledgerTab={ledgerTab}
        fileName={fileName}
        onFile={source.read}
      />

      {ledgerTab ? (
        <LedgerImportPanel
          companyName={companyName}
          isSampleCompany={isSampleCompany}
          baseDecimals={baseDecimals}
          canManage
          accounts={accounts}
        />
      ) : null}

      {ledgerTab ? null : (
        <ImportGuidance
          target={target}
          detection={detection}
          onSwitchTarget={(next) => {
            setTarget(next);
            source.reproposeFor(next);
            setPreview(null);
          }}
        />
      )}

      {headers.length > 0 && target === "transactions" ? (
        <ImportPreflightSection
          rows={rows}
          mapping={mapping}
          accounts={accounts}
          overrides={overrides}
          onOverridesChange={setOverrides}
        />
      ) : null}

      {headers.length > 0 && !ledgerTab ? (
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
              source.setMapping((prev) => ({ ...prev, [fieldKey]: columnIndex }))
            }
          />

          <Space wrap>
            <Button
              type="primary"
              onClick={runPreview}
              loading={busy}
              disabled={source.missingRequired.length > 0}
            >
              See what will happen
            </Button>
            {source.missingRequired.length > 0 ? (
              <Typography.Text type="danger">
                Still to choose: {source.missingRequired.join(", ")}
              </Typography.Text>
            ) : null}
          </Space>
        </>
      ) : null}

      {preview?.typeReadings && preview.typeReadings.length > 0 ? (
        <AccountTypeReview
          readings={preview.typeReadings}
          onChange={(source, type) => {
            const next = { ...typeOverrides };
            if (type) next[source] = type;
            else delete next[source];
            setTypeOverrides(next);
            void previewImportAction(target, rows, mapping, bankAccountId, overrides, next).then(
              (res) => {
                if (res.ok && res.data) setPreview(res.data);
                else message.error(res.error ?? "Could not re-read the file");
              },
            );
          }}
        />
      ) : null}

      {preview && !ledgerTab ? (
        <ImportPreviewPanel
          preview={preview}
          target={target}
          busy={busy}
          money={money}
          withBalances={withBalances}
          onWithBalancesChange={setWithBalances}
          asOf={asOf}
          onAsOfChange={setAsOf}
          onImport={confirmImport}
          onDownloadExcluded={downloadExcluded}
        />
      ) : null}

      {target === "transactions" ? (
        <ImportBatchRegister reloadKey={imported} onChanged={reset} />
      ) : null}
    </Space>
  );
}
