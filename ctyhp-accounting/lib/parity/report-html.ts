/**
 * The parity report: one self-contained HTML page, kept on the local machine
 * (it names real accounts). Every text is escaped; every figure is in dollars;
 * a difference is OneBook minus the prototype.
 */
import type { Comparison, Difference, DifferenceTag } from "./compare.ts";
import type { DriftEntry, DriftResult } from "./drift.ts";

export interface BookReport {
  name: string;
  accounts: number;
  entries: number;
  loaded: number;
  notLoaded: { id: string; date: string; problem: string }[];
  months: number;
  fiscalYears: number;
  comparison: Comparison;
}

export interface ShotRecord {
  book: string;
  name: string;
  theme: "light" | "dark";
  /** Relative to the report, e.g. "shots/book1-light-tab-today.png"; empty when the capture failed. */
  file: string;
  error: string | null;
}

export interface ParityReport {
  generatedAt: string;
  prototypeFile: string;
  books: BookReport[];
  drift: { schema: string; book: string; result: DriftResult } | null;
  shots: ShotRecord[];
}

const TAG_ORDER: DifferenceTag[] = ["new", "not loaded", "closing entry", "rounding"];
const KIND_LABEL: Record<Difference["kind"], string> = {
  balance: "Account balance",
  trial_balance: "Trial Balance",
  profit_and_loss: "Profit and Loss",
  balance_sheet: "Balance Sheet",
};
const MAX_DIFFERENCES = 2000;
const MAX_DRIFT = 500;

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function dollars(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

const period = (d: Difference) => (d.from ? `${d.from} → ${d.to}` : d.to);
const count = (differences: readonly Difference[], tag: DifferenceTag) => differences.filter((d) => d.tag === tag).length;

function summary(books: readonly BookReport[]): string {
  const rows = books
    .map(
      (b) =>
        `<tr><td>${esc(b.name)}</td><td class="r">${b.loaded} of ${b.entries}</td><td class="r">${b.months}</td>` +
        `<td class="r">${b.fiscalYears}</td><td class="r">${b.comparison.compared}</td><td class="r">${b.comparison.agreed}</td>` +
        TAG_ORDER.map((tag) => `<td class="r">${count(b.comparison.differences, tag)}</td>`).join("") +
        "</tr>",
    )
    .join("");
  return (
    `<h2>Summary</h2><table><thead><tr><th>Book</th><th>Entries loaded</th><th>Month ends</th><th>Fiscal years</th>` +
    `<th>Figures compared</th><th>Agree</th>${TAG_ORDER.map((t) => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function bookSection(book: BookReport): string {
  const sorted = [...book.comparison.differences].sort(
    (a, b) =>
      TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag) ||
      a.kind.localeCompare(b.kind) ||
      a.to.localeCompare(b.to) ||
      a.key.localeCompare(b.key),
  );
  const shown = sorted.slice(0, MAX_DIFFERENCES);
  const rows = shown
    .map(
      (d) =>
        `<tr class="tag-${d.tag.replace(/\s+/g, "-")}"><td>${esc(d.tag)}</td><td>${esc(KIND_LABEL[d.kind])}</td><td>${esc(period(d))}</td>` +
        `<td>${esc(d.key)}</td><td class="r">${dollars(d.prototypeCents)}</td><td class="r">${dollars(d.onebookCents)}</td>` +
        `<td class="r">${dollars(d.diffCents)}</td></tr>`,
    )
    .join("");
  const more = sorted.length > shown.length ? `<p class="note">${sorted.length - shown.length} more not shown; see parity-result.json.</p>` : "";
  const notLoaded = book.notLoaded.length
    ? `<h3>Entries not loaded (${book.notLoaded.length})</h3><table><thead><tr><th>Entry</th><th>Date</th><th>Why</th></tr></thead><tbody>` +
      book.notLoaded.map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.date)}</td><td>${esc(e.problem)}</td></tr>`).join("") +
      "</tbody></table>"
    : "";
  const differences = book.comparison.differences.length
    ? `<table><thead><tr><th>Tag</th><th>Figure</th><th>Period</th><th>Account or total</th><th>Prototype</th><th>OneBook</th><th>Difference</th></tr></thead><tbody>${rows}</tbody></table>${more}`
    : `<p class="ok">Every figure agrees.</p>`;
  return `<h2>${esc(book.name)}</h2>${differences}${notLoaded}`;
}

function driftList(title: string, entries: readonly DriftEntry[]): string {
  if (!entries.length) return "";
  const shown = entries.slice(0, MAX_DRIFT);
  const rows = shown
    .map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.label)}</td><td class="r">${e.amounts.map(dollars).join(" / ")}</td></tr>`)
    .join("");
  const more = entries.length > shown.length ? `<p class="note">${entries.length - shown.length} more not shown.</p>` : "";
  return `<h3>${esc(title)} (${entries.length})</h3><table><thead><tr><th>Date</th><th>Description</th><th>Amounts</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function driftSection(drift: NonNullable<ParityReport["drift"]>): string {
  const r = drift.result;
  const differ = r.accountsDiffer.length
    ? `<h3>Same amounts, other accounts (${r.accountsDiffer.length})</h3><table><thead><tr><th>Date</th><th>Description</th><th>Prototype accounts</th><th>OneBook accounts</th></tr></thead><tbody>` +
      r.accountsDiffer
        .slice(0, MAX_DRIFT)
        .map(
          (d) =>
            `<tr><td>${esc(d.prototype.date)}</td><td>${esc(d.prototype.label)}</td><td>${esc((d.prototype.accounts ?? []).join(", "))}</td><td>${esc((d.onebook.accounts ?? []).join(", "))}</td></tr>`,
        )
        .join("") +
      "</tbody></table>"
    : "";
  return (
    `<h2>Data pass — ${esc(drift.book)} against ${esc(drift.schema)}</h2>` +
    `<p>${r.matched} entries match; ${r.onlyPrototype.length} are only in the prototype; ${r.onlyOnebook.length} are only in OneBook; ${r.accountsDiffer.length} have the same amounts on other accounts.</p>` +
    driftList("Only in the prototype", r.onlyPrototype) +
    driftList("Only in OneBook", r.onlyOnebook) +
    differ
  );
}

function shotsSection(shots: readonly ShotRecord[]): string {
  const rows = shots
    .map(
      (s) =>
        `<tr><td>${esc(s.book)}</td><td>${esc(s.name)}</td><td>${esc(s.theme)}</td><td>${
          s.file ? `<a href="${esc(s.file)}">${esc(s.file)}</a>` : `<span class="bad">${esc(s.error ?? "failed")}</span>`
        }</td></tr>`,
    )
    .join("");
  return `<h2>Prototype screens (${shots.length})</h2><table><thead><tr><th>Book</th><th>Screen</th><th>Theme</th><th>File</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const CSS =
  ":root{--bg:#f6f7f8;--fg:#14202b;--muted:#4b5a67;--card:#ffffff;--line:#d9e0e6;--bad:#a4262c;--ok:#1d6b3a}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#0e141a;--fg:#e4eaef;--muted:#a9b6c1;--card:#151d25;--line:#2a3743;--bad:#ff8a8a;--ok:#7bd69a}}" +
  "body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}" +
  "main{max-width:1400px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{margin:28px 0 8px;font-size:18px}" +
  ".lede,.note{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--card);margin:8px 0}" +
  "th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}" +
  ".tag-new td:first-child{color:var(--bad);font-weight:600}.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad)}a{color:inherit}";

export function renderParityReport(report: ParityReport): string {
  const body =
    `<h1>Prototype parity</h1><p class="lede">Generated ${esc(report.generatedAt)} from ${esc(report.prototypeFile)}. ` +
    `Figures in dollars; a difference is OneBook minus the prototype. Tags: <strong>new</strong> is a finding; ` +
    `<strong>not loaded</strong>, <strong>closing entry</strong> and <strong>rounding</strong> match a known reason.</p>` +
    summary(report.books) +
    report.books.map(bookSection).join("") +
    (report.drift ? driftSection(report.drift) : "") +
    (report.shots.length ? shotsSection(report.shots) : "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prototype parity</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}
