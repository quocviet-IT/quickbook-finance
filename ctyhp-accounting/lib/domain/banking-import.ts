import { createHash } from "node:crypto";
// With its .ts suffix and free of other modules, so the verification scripts
// can load this file straight into Node.
import { repeatKey, rowKeyText, statementLineKeyText } from "./statement-key-text.ts";

/** Collision-resistant deterministic hash for immutable statement rows. */
export function statementRowHash(
  parts: (string | number | null | undefined)[],
): string {
  return createHash("sha256").update(rowKeyText(parts)).digest("hex");
}

/**
 * The duplicate key of one statement line. A line that carries the bank's own
 * id (OFX FITID) is keyed on it, so a re-downloaded file is recognised even when
 * the bank rewords a description; any other line is keyed as imports always
 * have been, so it still meets the lines imported before. The n-th identical
 * line of one file (n ≥ 2) adds its `occurrence`: two $5.00 fees on one day are
 * two lines, and the first keeps the key it always had. Since 2.04 that holds
 * for the bank's own id too: two lines of one file carrying the same FITID are
 * two lines, not one. The text hashed is statementLineKeyText's, which the
 * import dialog hashes in the browser to the same key.
 */
export function statementLineHash(
  bankAccountId: string,
  line: StatementLineKey,
  occurrence = 1,
): string {
  return createHash("sha256").update(statementLineKeyText(bankAccountId, line, occurrence)).digest("hex");
}

export interface StatementLineKey {
  txn_date: string;
  amount_minor: number;
  description: string;
  reference: string | null;
  external_id?: string | null;
}

/** The duplicate keys of one file's lines, in file order, each repeat of an identical line counted (repeatKey). */
export function statementLineHashes(bankAccountId: string, lines: readonly StatementLineKey[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = repeatKey(line);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return statementLineHash(bankAccountId, line, occurrence);
  });
}

/**
 * One key per line read, in file order, as the import will send them: counted
 * over exactly the lines sent — every line but those marked Not a transaction,
 * the lines to be skipped included — so ticking a skipped line back never
 * moves another line's key. Null for a line marked Not a transaction.
 */
export function statementKeysAsSent(
  bankAccountId: string,
  lines: readonly StatementLineKey[],
  aside: Iterable<number> = [],
): (string | null)[] {
  const setAside = new Set(aside);
  const sent = lines.flatMap((line, index) => (setAside.has(index) ? [] : [{ line, index }]));
  const hashes = statementLineHashes(
    bankAccountId,
    sent.map(({ line }) => line),
  );
  const out: (string | null)[] = lines.map(() => null);
  sent.forEach(({ index }, i) => {
    out[index] = hashes[i];
  });
  return out;
}
