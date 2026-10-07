"use client";
import { Button, Space, Typography } from "antd";
import type { BankRecodeRow } from "@/lib/services/banking";

const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
const small = { fontSize: 12 } as const;

/**
 * The Category cell of a line recoded out of Uncategorized (1.85): where its
 * money went, then the entry that put it in Uncategorized and the recode that
 * moved it out. Undo recode is the only way back. Voiding the first entry is
 * not offered under a recode: it sat beside Undo recode and was pressed by
 * mistake.
 */
export default function RecodedCategory({
  recode,
  entryNumber,
  onUndo,
  undoing,
  onCreateRule,
}: {
  recode: BankRecodeRow;
  /** The bank line's own entry, the one that put it in Uncategorized. */
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
      <Typography.Text type="secondary" style={small}>
        Recoded from Uncategorized
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
