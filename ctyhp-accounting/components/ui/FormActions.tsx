import type { ReactNode } from "react";

/**
 * Where a form that sits on a page keeps its buttons: under the last field,
 * behind a rule, the primary action first and on the left, Cancel or Discard
 * after it, and anything the reader should know about saving (who may, what is
 * unsaved) at the end of the same row.
 *
 * The UI review of 2026-10-19 found three settings forms with a Save button
 * each placed its own way, and Approval Policies with no Save button at all —
 * a floppy-disk icon at the end of every row. A form in a dialog keeps the
 * dialog's own footer, bottom right; this is for the forms that are the page.
 */
export default function FormActions({ children, note }: { children?: ReactNode; note?: ReactNode }) {
  return (
    <div className="accounting-form-actions">
      {children}
      {note ? <span className="accounting-form-actions__note">{note}</span> : null}
    </div>
  );
}
