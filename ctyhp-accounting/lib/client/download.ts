/**
 * Hand the browser a file it never fetched.
 *
 * Two screens were doing this dance separately — the import template and the
 * rows an import leaves out — and both are built in the browser from data it
 * already holds, so neither has a URL to link to. One copy, because the object
 * URL has to be revoked and the second copy is where that gets forgotten.
 */
export function downloadTextFile(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
