import { COLUMN } from "@/lib/design/table-metrics";

/** Fixed widths of the Related companies table; Matches on carries none and takes what is left. */
export const RELATED_COLUMN_WIDTH = {
  name: COLUMN.PICKER,
  account: COLUMN.PICKER + COLUMN.ACTION,
  balance: COLUMN.PICKER,
  waiting: COLUMN.QTY,
  active: COLUMN.ACTION * 1.5,
  actions: COLUMN.ACTION * 2,
} as const;
