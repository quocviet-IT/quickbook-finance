/**
 * Watch for the browser printing and show the report alone while it does (the
 * `@media print` block in app/globals.css hides the rest of the page while
 * `print-report` is set on `<body>`), on the light palette — see the
 * `body.print-report .report-print-area` selector `cssVariableBlock` emits in
 * lib/design/tokens.ts.
 *
 * Used by the report page so the browser's own Ctrl+P also prints the report
 * alone, not only the `printReport` button. Returns a cleanup that removes
 * both listeners and the class, for the page's effect to call on unmount.
 */
export function watchReportPrinting(): () => void {
  const body = document.body;
  const add = () => body.classList.add("print-report");
  const remove = () => body.classList.remove("print-report");
  window.addEventListener("beforeprint", add);
  window.addEventListener("afterprint", remove);
  return () => {
    window.removeEventListener("beforeprint", add);
    window.removeEventListener("afterprint", remove);
    remove();
  };
}

/**
 * Print the report on screen and nothing else.
 *
 * Never touches `data-theme`: the printed area gets the light palette from its
 * own CSS declarations (see `watchReportPrinting` above), so there is nothing
 * to force onto `<html>` and nothing to restore afterwards. `window.print()`
 * blocks until the print dialog closes in current browsers, so the class comes
 * off in `finally` rather than on an `afterprint` listener. Idempotent: a
 * second call while the class is already set changes nothing about the
 * reader's own theme, because that was never touched.
 */
export function printReport(): void {
  const body = document.body;
  body.classList.add("print-report");
  try {
    window.print();
  } finally {
    body.classList.remove("print-report");
  }
}
