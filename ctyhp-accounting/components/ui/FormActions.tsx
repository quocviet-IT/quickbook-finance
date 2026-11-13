import type { ReactNode } from "react";
import { Alert } from "antd";

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
 *
 * Since 3.0.30 the row stays at the foot of the window while the form runs on
 * below it. The company settings form is taller than a laptop screen, and its
 * Save sat 130px under the bottom edge, where nobody editing the top of the
 * form could see it. The buttons stay on the left: the floating Report and
 * Ask Abacus buttons hold the bottom right corner, and a Save placed there
 * would be under them.
 *
 * `dirty` says "Unsaved changes" when the form has no note of its own, and
 * `error` keeps why the last save failed beside the button that will try
 * again. A toast was gone before the reason could be read.
 */
export default function FormActions({
  children,
  note,
  dirty = false,
  error = null,
}: {
  children?: ReactNode;
  note?: ReactNode;
  /** The form holds edits that are not saved yet. */
  dirty?: boolean;
  /** Why the last save failed, until the next attempt. */
  error?: string | null;
}) {
  const said = note ?? (dirty ? "Unsaved changes" : null);
  return (
    <div className="accounting-form-actions">
      {error ? (
        <Alert className="accounting-form-actions__error" type="error" showIcon role="alert" title={error} />
      ) : null}
      <div className="accounting-form-actions__row">
        {children}
        {/* Always present, so a screen reader hears "Unsaved changes" arrive. */}
        <span className="accounting-form-actions__note" aria-live="polite">
          {said}
        </span>
      </div>
    </div>
  );
}
