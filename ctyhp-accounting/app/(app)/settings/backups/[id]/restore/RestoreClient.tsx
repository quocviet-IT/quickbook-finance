"use client";

import { useState } from "react";
import { Alert, Button, Descriptions, Input, Space, Typography } from "antd";
import { formatBytes } from "@/lib/domain/feedback-attachment";
import { restoreBackupAction } from "./actions";

export interface RestoreSnapshot {
  id: string;
  takenAt: string;
  status: string;
  sizeBytes: number | null;
  schemaVersion: string;
  contentHash: string;
  journalLineCount: number | null;
}

type RestoreOutcome = NonNullable<Awaited<ReturnType<typeof restoreBackupAction>>["data"]>;

/**
 * The five figures both sides were measured by. Money figures are integer
 * minor units and are shown as such — the display never divides them, per the
 * rule that only the money formatting edge may convert.
 */
const FIGURE_LABELS: Array<{ key: keyof RestoreOutcome["expected"]; label: string }> = [
  { key: "trialBalanceDebitMinor", label: "Trial balance debits (minor units)" },
  { key: "trialBalanceCreditMinor", label: "Trial balance credits (minor units)" },
  { key: "arTotalMinor", label: "Accounts receivable (minor units)" },
  { key: "apTotalMinor", label: "Accounts payable (minor units)" },
  { key: "journalLineCount", label: "Journal lines" },
];

export default function RestoreClient({
  snapshot,
  loadError,
}: {
  snapshot: RestoreSnapshot | null;
  loadError: string | null;
}) {
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!snapshot) {
    return <Alert type="error" showIcon message={loadError ?? "Could not read the snapshot"} />;
  }

  const restore = async () => {
    setRunning(true);
    setFailure(null);
    setOutcome(null);
    try {
      const result = await restoreBackupAction(snapshot.id, name);
      if (!result.ok || !result.data) {
        setFailure(result.error ?? "The restore failed before it could finish.");
        return;
      }
      setOutcome(result.data);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The restore failed before it could finish.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Descriptions
        bordered
        size="small"
        column={1}
        items={[
          { key: "date", label: "Snapshot date", children: snapshot.takenAt },
          {
            key: "size",
            label: "Size",
            children: snapshot.sizeBytes === null ? "—" : formatBytes(snapshot.sizeBytes),
          },
          {
            key: "lines",
            label: "Journal lines",
            children:
              snapshot.journalLineCount === null
                ? "—"
                : snapshot.journalLineCount.toLocaleString("en-US"),
          },
          { key: "schema", label: "Taken under schema", children: snapshot.schemaVersion },
          {
            key: "hash",
            label: "Content hash",
            children: <Typography.Text code>{snapshot.contentHash.slice(0, 16)}</Typography.Text>,
          },
        ]}
      />

      {snapshot.status !== "stored" ? (
        <Alert
          type="warning"
          showIcon
          message="This snapshot holds no file"
          description={`Only a stored snapshot can be restored; this one is "${snapshot.status}". A skipped night means the books had not changed — the previous stored snapshot holds the same content.`}
        />
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            message="What a restore does — and deliberately does not"
            description={
              <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
                <li>
                  The snapshot is loaded into a brand-new company beside the running books. Nothing
                  in this company changes.
                </li>
                <li>
                  You will be the copy&apos;s only user. The snapshot&apos;s user list and role
                  assignments are not carried over — access to a set of books is granted by a
                  person, not by a file.
                </li>
                <li>
                  Attachments are listed in the snapshot, but their files are not in it, so they
                  will not open in the copy.
                </li>
                <li>
                  Bank feed credentials are never in a snapshot, so restored bank connections
                  cannot sync.
                </li>
                <li>
                  When it finishes, the copy&apos;s trial balance, receivables, payables and journal
                  line count are checked against the snapshot&apos;s own figures, and any
                  difference is named.
                </li>
              </ul>
            }
          />
          <Space.Compact style={{ width: "100%", maxWidth: 480 }}>
            <Input
              placeholder="Name for the new company"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              disabled={running}
            />
            <Button
              type="primary"
              onClick={restore}
              loading={running}
              disabled={name.trim().length === 0}
            >
              Restore into a new company
            </Button>
          </Space.Compact>
          {running ? (
            <Alert
              type="info"
              showIcon
              message="Building the company and loading the books"
              description="This provisions a complete company and can take a few minutes. Keep this page open."
            />
          ) : null}
        </>
      )}

      {failure ? <Alert type="error" showIcon message="The restore did not finish" description={failure} /> : null}

      {outcome ? (
        <>
          {outcome.verdict === "matched" ? (
            <Alert
              type="success"
              showIcon
              message="The books came back whole"
              description={`Every control total of "${outcome.legalName}" matches the snapshot, measured as of ${outcome.comparedAsOf}. Open it from the company menu to work with the two sets of books side by side.`}
            />
          ) : outcome.verdict === "mismatched" ? (
            <Alert
              type="error"
              showIcon
              message="The restored books do not add up to the snapshot"
              description={
                <>
                  <p style={{ marginTop: 0 }}>
                    The company &quot;{outcome.legalName}&quot; was still created so the two sets of
                    books can be compared side by side. These figures disagree (measured as of{" "}
                    {outcome.comparedAsOf}):
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
                    {outcome.differences.map((difference) => (
                      <li key={difference}>{difference}</li>
                    ))}
                  </ul>
                </>
              }
            />
          ) : (
            // The one thing this state must never say is "the restore did not
            // finish": it did. The company is fully loaded — a retry would
            // build a second copy — its figures just have not been proved.
            <Alert
              type="warning"
              showIcon
              message="The company was created, but its figures are unproven"
              description={
                <>
                  <p style={{ marginTop: 0 }}>
                    &quot;{outcome.legalName}&quot; exists and is fully loaded — do not run the
                    restore again. Checking its figures failed after the load finished:{" "}
                    {outcome.unverifiedReason}
                  </p>
                  <p style={{ margin: 0 }}>
                    To check them yourself, open &quot;{outcome.legalName}&quot; from the company
                    menu, run the Trial Balance and the AR and AP aging reports as of{" "}
                    {outcome.comparedAsOf}, and compare each total against the snapshot figures
                    below.
                  </p>
                </>
              }
            />
          )}
          {outcome.verdictRecorded ? null : (
            <Alert
              type="warning"
              showIcon
              message="This verdict could not be written into the copy's audit log"
              description={`The result above is shown here only; recording it in "${outcome.legalName}" failed: ${outcome.verdictRecordError}`}
            />
          )}
          {outcome.nulledReferences.length === 0 ? null : (
            <Alert
              type="info"
              showIcon
              message="Some references came back without their link"
              description={
                <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
                  {outcome.nulledReferences.map((nulled) => (
                    <li key={`${nulled.table}.${nulled.column}`}>
                      {nulled.rowsAffected.toLocaleString("en-US")} row
                      {nulled.rowsAffected === 1 ? "" : "s"} in {nulled.table} came back without
                      their {nulled.column} link to {nulled.referencedTable}, because{" "}
                      {nulled.reason}.
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          <Descriptions
            bordered
            size="small"
            column={1}
            title="Control totals — snapshot vs. restored"
            items={FIGURE_LABELS.map(({ key, label }) => ({
              key,
              label,
              children: `${outcome.expected[key].toLocaleString("en-US")} in the snapshot · ${
                outcome.actual === null
                  ? "could not be read"
                  : `${outcome.actual[key].toLocaleString("en-US")} restored`
              }`,
            }))}
          />
        </>
      ) : null}
    </Space>
  );
}
