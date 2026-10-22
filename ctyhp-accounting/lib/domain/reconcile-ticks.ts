/**
 * "Tick everything shown" and "Clear the ticks" on a reconciliation's ledger
 * lines, as the approved design has them above its two columns.
 *
 * Only the lines whose tick would change are sent: ticking everything leaves
 * the ticked lines alone, and clearing leaves the unticked ones alone, so the
 * count said afterwards is the count that changed.
 */
export function linesToTick(lines: readonly { journalLineId: string; cleared: boolean }[], cleared: boolean): string[] {
  return lines.filter((line) => line.cleared !== cleared).map((line) => line.journalLineId);
}
