"use client";
import { Alert, Button, InputNumber, Typography } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { PROOF_TEXT } from "@/lib/domain/statement-proof";
import type { StatementDialogView } from "@/lib/domain/statement-import-dialog";
import styles from "./import-statement.module.css";

/**
 * Whether the statement adds up (2.04), for every format the import dialog
 * reads, drawn from statementDialogView:
 *
 * - it adds up: "Opening $X (printed) + 42 lines −$Y = $Z, the closing balance
 *   the statement prints ✓", and the import is one click;
 * - it is out: "Out by $V. …", the line where a CSV's balance jumps or the one
 *   line it is out by, "Import is blocked until the statement adds up.", and
 *   "Import anyway…" for an administrator or who can for anyone else;
 * - a balance is missing: which, then the field to type the figure printed on
 *   the statement, with "Use $X (…)" when the prior statement's closing is on
 *   offer. A field stays while its figure is typed, so the figure can be
 *   corrected.
 *
 * Every sentence is the domain's; nothing here decides anything.
 */
interface Props {
  view: StatementDialogView;
  /** The account's decimals, for the two balance fields. */
  decimals: number;
  typedOpeningMinor: number | null;
  typedClosingMinor: number | null;
  onTypedOpening: (minor: number | null) => void;
  onTypedClosing: (minor: number | null) => void;
  /** Takes the prior statement's closing as the opening, or gives it back. */
  onUsePrior: (use: boolean) => void;
  /** Opens "Import anyway…"'s reason. */
  onImportAnyway: () => void;
  /** The import is on its way. */
  busy: boolean;
}

function BalanceField({
  label,
  minor,
  decimals,
  onChange,
}: {
  label: string;
  minor: number | null;
  decimals: number;
  onChange: (minor: number | null) => void;
}) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {label}
      </Typography.Text>
      <InputNumber<number>
        aria-label={label}
        style={{ width: "100%" }}
        precision={decimals}
        value={minor === null ? null : fromMinor(minor, decimals)}
        onChange={(value) => onChange(value === null || value === undefined ? null : toMinor(value, decimals))}
      />
    </div>
  );
}

export default function StatementProofPanel({
  view,
  decimals,
  typedOpeningMinor,
  typedClosingMinor,
  onTypedOpening,
  onTypedClosing,
  onUsePrior,
  onImportAnyway,
  busy,
}: Props) {
  const { proof, tone, blocked, override, priorOffer } = view;
  const { sentences } = proof;
  const fields = view.showOpeningField || view.showClosingField;
  return (
    <div className={styles.panel}>
      {tone === "adds" ? <Alert type="success" showIcon title={sentences.summary} /> : null}
      {tone === "out" ? (
        <Alert
          type="error"
          showIcon
          title={sentences.summary}
          description={
            <div className={styles.panel} style={{ marginTop: 0 }}>
              {sentences.detail ? <Typography.Text>{sentences.detail}</Typography.Text> : null}
              <Typography.Text strong>{blocked}</Typography.Text>
              {override === "button" ? (
                <div>
                  <Button danger size="small" disabled={busy || view.checking} onClick={onImportAnyway}>
                    {PROOF_TEXT.importAnyway}
                  </Button>
                </div>
              ) : null}
              {override === "sentence" ? (
                <Typography.Text type="secondary">{PROOF_TEXT.adminCanOverride}</Typography.Text>
              ) : null}
            </div>
          }
        />
      ) : null}
      {tone === "missing" ? <Alert type="warning" showIcon title={view.missingText} description={blocked} /> : null}
      {fields ? (
        <div className={styles.fields}>
          {view.showOpeningField ? (
            <BalanceField
              label={PROOF_TEXT.openingField}
              minor={typedOpeningMinor}
              decimals={decimals}
              onChange={onTypedOpening}
            />
          ) : null}
          {view.showClosingField ? (
            <BalanceField
              label={PROOF_TEXT.closingField}
              minor={typedClosingMinor}
              decimals={decimals}
              onChange={onTypedClosing}
            />
          ) : null}
        </div>
      ) : null}
      {priorOffer ? (
        <div>
          {/* The label is a sentence: it wraps on a phone rather than running off the dialog. */}
          <Button
            size="small"
            type={priorOffer.taken ? "primary" : "default"}
            aria-pressed={priorOffer.taken}
            style={{ whiteSpace: "normal", height: "auto", textAlign: "left" }}
            onClick={() => onUsePrior(!priorOffer.taken)}
          >
            {priorOffer.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
