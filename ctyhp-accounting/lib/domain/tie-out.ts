/**
 * A report's proof line: its total beside the figure it has to equal, and the
 * difference when they part. A report that disagrees with its own books says
 * so; it does not hide the gap.
 */
export interface TieOut {
  /** What the report's total has to equal. */
  expectedMinor: number;
  /** The report's total less what it has to equal; 0 when they agree. */
  differenceMinor: number;
  agrees: boolean;
}

export function tieOut(totalMinor: number, expectedMinor: number): TieOut {
  const differenceMinor = totalMinor - expectedMinor;
  return { expectedMinor, differenceMinor, agrees: differenceMinor === 0 };
}
