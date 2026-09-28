/**
 * Print the report on screen and nothing else (the `@media print` block in
 * app/globals.css hides the rest of the page while `print-report` is set).
 *
 * A dark theme would print pale text on white paper, so the light theme is put
 * on for the print and the reader's own choice put back afterwards.
 */
export function printReport(): void {
  const body = document.body;
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  body.classList.add("print-report");
  root.setAttribute("data-theme", "light");
  const done = () => {
    body.classList.remove("print-report");
    if (theme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
