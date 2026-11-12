"use client";
import { Button, Space, Typography } from "antd";
import type { BankRecodeRow } from "@/lib/services/banking";

const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
const small = { fontSize: 12 } as const;

/**
 * The Category cell of a recoded line (1.85; any account since 3.0.25): where
 * its money went, the account its own entry names, and the two entries. Undo
 * recode is the only way back. Voiding the first entry is not offered under a
 * recode: it sat beside Undo recode and was pressed by mistake.
 */
export default function RecodedCategory({
  recode,
  from,
  entryNumber,
  onUndo,
  undoing,
  onCreateRule,
}: {
  recode: BankRecodeRow;
  /** The account the line's own entry names: where the money was before the recode. */
  from: string;
  /** The bank line's own entry. */
  entryNumber: string | null;
  /** Null when this person may not take the recode back. */
  onUndo: (() => void) | null;
  undoing: boolean;
  /** Null when this person may not make a rule. */
  onCreateRule: (() => void) | null;
}) {
  const account = `${recode.account_code} — ${recode.account_name}`;
  return (
    <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
      <Typography.Text ellipsis={{ tooltip: account }}>{account}</Typography.Text>
      <Typography.Text type="secondary" style={small} ellipsis={{ tooltip: `Recoded from ${from}` }}>
        Recoded from {from}
      </Typography.Text>
      <Typography.Text type="secondary" style={small}>
        {entryNumber ?? "posted"}
        {recode.entry_number ? ` → ${recode.entry_number}` : ""}
      </Typography.Text>
      {/* One link to a line: the Category column is too narrow for both, and a
          separator left at the end of a wrapped line reads as a stray mark. */}
      {onUndo ? (
        <div>
          <Button type="link" size="small" style={linkStyle} loading={undoing} onClick={onUndo}>
            Undo recode
          </Button>
        </div>
      ) : null}
      {onCreateRule ? (
        <div>
          <Button type="link" size="small" style={linkStyle} onClick={onCreateRule}>
            Create rule
          </Button>
        </div>
      ) : null}
    </Space>
  );
}
