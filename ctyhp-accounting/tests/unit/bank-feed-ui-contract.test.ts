import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), "app", "(app)", "banking", file), "utf8");

/**
 * Disconnect and Undo for bank feeds (1.87): what the screens must keep true.
 * A connection is never dropped in OneBook while Plaid keeps it unless the
 * person chose that, and Undo is offered only where the database will accept it.
 */
describe("bank feed screens", () => {
  const modal = read("DisconnectBankModal.tsx");
  const list = read("BankFeedSyncList.tsx");
  const banking = read("BankingClient.tsx");

  it("offers Disconnect in OneBook only after Plaid did not confirm, and only when ticked", () => {
    expect(modal).toMatch(/\{unconfirmed \? \(/);
    expect(modal).toContain("Disconnect in OneBook only");
    expect(modal).toContain("(unconfirmed !== null && !onlyInOneBook)");
    expect(modal).toContain("disconnectBankConnectionAction(connection.id, reason, onlyInOneBook)");
  });

  it("asks a reason before either", () => {
    expect(modal).toContain('reason.trim() === ""');
    expect(list).toContain('reason.trim() === ""');
  });

  it("never leaves a dialog spinning", () => {
    expect(modal).toMatch(/finally \{\s*setBusy\(false\);/);
    expect(list).toMatch(/finally \{\s*setBusy\(false\);/);
  });

  it("offers Undo only where the database will accept it, and says why not", () => {
    expect(list).toContain("syncUndoState(row)");
    expect(list).toContain("disabled={!state.canUndo}");
    expect(list).toContain("<Tooltip title={state.why ?? undefined}>");
    expect(list).toContain("<DataTable<BankFeedSyncView>");
  });

  it("refreshes the sync list after a sync that failed, not only after one that worked", () => {
    const failure = banking.slice(banking.indexOf("async function synchronizeFeed"));
    const failed = failure.slice(failure.indexOf("if (!result.ok || !result.data) {"), failure.indexOf("message.success"));
    expect(failed).toContain("setImportsKey((count) => count + 1);");
    expect(failed.indexOf("setImportsKey")).toBeLessThan(failed.indexOf("return;"));
  });

  it("drops the answer of a read that was overtaken, so one account never shows another's syncs", () => {
    expect(list).toContain("const read = ++latestRead.current;");
    expect(list).toContain("if (read !== latestRead.current) return;");
    expect(list).toMatch(/return \(\) => \{\s*latestRead\.current \+= 1;/);
  });

  it("says in the card when the syncs cannot be read, and shows no old rows", () => {
    expect(list).toMatch(/setRows\(\[\]\);\s*setReadError\(/);
    expect(list).toContain('<Alert type="error" showIcon message={readError} />');
    expect(list.indexOf("if (readError) {")).toBeGreaterThan(-1);
    expect(list.indexOf("if (readError) {")).toBeLessThan(list.indexOf("if (rows.length === 0) return null;"));
  });

  it("puts Disconnect on the connection card for people who may write, and the syncs under one account", () => {
    expect(banking).toContain("{selectedConnection && canWrite ? (");
    expect(banking).toContain("setDisconnecting(selectedConnection)");
    expect(banking).toContain("{selectedId && !allAccounts ? (");
    expect(banking).toContain("<BankFeedSyncList bankAccountId={selectedId}");
  });
});
