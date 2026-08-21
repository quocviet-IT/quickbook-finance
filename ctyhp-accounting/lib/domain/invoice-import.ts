/**
 * Turning a flat file of invoice lines into invoices.
 *
 * Every other import target here is one record per row. An invoice is not: a
 * header and its lines are spread across several rows that share an invoice
 * number, and nothing about a CSV says where one document ends. That grouping,
 * and refusing the groups that contradict themselves, is the whole of this
 * module — and the part most worth testing, because a mis-grouped file bills the
 * wrong customer for someone else's work.
 *
 * Nothing here posts. The importer raises drafts; issuing them stays a separate,
 * deliberate act, so a bad file costs a review rather than a period.
 */

/** One mapped row, as `applyMapping` produces it for the invoices target. */
export interface InvoiceImportRecord {
  invoice_number: string;
  customer: string;
  issue_date: string;
  due_date: string | null;
  description: string | null;
  quantity: number;
  unit_price_minor: number;
  income_account: string;
  tax_code: string | null;
  memo: string | null;
}

export interface InvoiceImportLine {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  incomeAccount: string;
  taxCode: string | null;
}

export interface InvoiceImportDocument {
  /** The number in the file. Grouping key and, later, the reference. */
  invoiceNumber: string;
  /**
   * The same value, named for what it becomes. Our own sequence numbers an
   * invoice when it is issued, so the file's number cannot be the document
   * number — it is what the customer knows this invoice by, and is kept as a
   * reference so the two can be reconciled.
   */
  externalReference: string;
  customer: string;
  issueDate: string;
  dueDate: string | null;
  memo: string | null;
  lines: InvoiceImportLine[];
  subtotalMinor: number;
}

export interface InvoiceImportProblem {
  /** The invoice number the problem belongs to, or "" when even that is missing. */
  reference: string;
  message: string;
}

export interface GroupedInvoiceImport {
  invoices: InvoiceImportDocument[];
  problems: InvoiceImportProblem[];
}

/** True only for a real calendar date written as YYYY-MM-DD. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Group mapped rows into invoices, reporting every group that cannot stand.
 *
 * Grouping is by invoice number and does not require the rows to be adjacent: a
 * spreadsheet sorted by product rather than by invoice is still a valid file.
 * Order of output follows first appearance, so the preview reads like the file.
 *
 * A group whose rows disagree about the customer or the issue date is refused
 * rather than resolved. Picking one of two customers would post revenue against
 * the wrong party, and there is no reading of the file that says which is meant.
 * One broken document never costs the others.
 */
export function groupInvoiceRows(
  records: readonly InvoiceImportRecord[],
): GroupedInvoiceImport {
  const problems: InvoiceImportProblem[] = [];
  const order: string[] = [];
  const groups = new Map<string, InvoiceImportRecord[]>();

  for (const record of records) {
    const number = (record.invoice_number ?? "").trim();
    if (number === "") {
      problems.push({ reference: "", message: "A line has no invoice number, so it belongs to no document" });
      continue;
    }
    if (!groups.has(number)) {
      groups.set(number, []);
      order.push(number);
    }
    groups.get(number)!.push(record);
  }

  const invoices: InvoiceImportDocument[] = [];

  for (const number of order) {
    const rows = groups.get(number)!;
    const fail = (message: string) => problems.push({ reference: number, message });

    const customers = new Set(rows.map((r) => (r.customer ?? "").trim()).filter(Boolean));
    if (customers.size === 0) {
      fail("No customer name on any line");
      continue;
    }
    if (customers.size > 1) {
      fail(`Lines name more than one customer (${[...customers].join(", ")})`);
      continue;
    }

    const issueDates = new Set(rows.map((r) => (r.issue_date ?? "").trim()).filter(Boolean));
    if (issueDates.size > 1) {
      fail(`Lines carry more than one issue date (${[...issueDates].join(", ")})`);
      continue;
    }
    const issueDate = [...issueDates][0] ?? "";
    if (!isCalendarDate(issueDate)) {
      fail(`Issue date "${issueDate}" is not a date`);
      continue;
    }

    const dueDates = new Set(rows.map((r) => (r.due_date ?? "").trim()).filter(Boolean));
    if (dueDates.size > 1) {
      fail(`Lines carry more than one due date (${[...dueDates].join(", ")})`);
      continue;
    }
    const dueDate = [...dueDates][0] ?? null;
    if (dueDate !== null && !isCalendarDate(dueDate)) {
      fail(`Due date "${dueDate}" is not a date`);
      continue;
    }
    if (dueDate !== null && dueDate < issueDate) {
      fail(`Due date ${dueDate} is before the issue date ${issueDate}`);
      continue;
    }

    let broken = false;
    const lines: InvoiceImportLine[] = [];
    for (const row of rows) {
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
        fail(`Quantity must be greater than zero (found ${row.quantity})`);
        broken = true;
        break;
      }
      if (!Number.isInteger(row.unit_price_minor) || row.unit_price_minor < 0) {
        fail(`Unit price cannot be negative (found ${row.unit_price_minor})`);
        broken = true;
        break;
      }
      const account = (row.income_account ?? "").trim();
      if (account === "") {
        fail("A line has no income account");
        broken = true;
        break;
      }
      lines.push({
        description: (row.description ?? "").trim(),
        quantity: row.quantity,
        unitPriceMinor: row.unit_price_minor,
        incomeAccount: account,
        taxCode: (row.tax_code ?? "").trim() || null,
      });
    }
    if (broken) continue;

    const memo = rows.map((r) => (r.memo ?? "").trim()).find(Boolean) ?? null;

    invoices.push({
      invoiceNumber: number,
      externalReference: number,
      customer: [...customers][0],
      issueDate,
      dueDate,
      memo,
      lines,
      subtotalMinor: lines.reduce(
        (sum, l) => sum + Math.round(l.quantity * l.unitPriceMinor),
        0,
      ),
    });
  }

  return { invoices, problems };
}

/**
 * What the importer will actually find when it looks these names up.
 *
 * The account list is expected to hold only accounts an invoice line may
 * credit — active, posting, and of type `income` — because that is the set
 * `acc_import_invoices` searches. Handing it a wider list here would put the
 * preview back out of step with the import, which is the whole fault this
 * exists to fix.
 */
export interface InvoiceResolutionSources {
  customers: readonly string[];
  incomeAccounts: readonly { code: string; name: string }[];
  /** Every tax code an invoice line may name. A line may name none. */
  taxCodes: readonly { code: string; name: string }[];
}

export interface ResolvedInvoiceImport {
  importable: InvoiceImportDocument[];
  blocked: InvoiceImportProblem[];
}

const norm = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

/**
 * Split grouped invoices into the ones that can be raised and the ones that
 * cannot, with the reason.
 *
 * These are the same two lookups `acc_import_invoices` does, in the same
 * order and with the same matching rules, and that is the point: the preview
 * used to count every well-formed group as a create, while the import then
 * silently skipped the ones naming a customer or an account that does not
 * exist. A screen promising "3 to create" and delivering one is worse than a
 * screen that refuses — the reader has no way to tell which two are missing.
 *
 * Reporting stops at an invoice's first fault, as the importer does: a
 * document that cannot be raised is not made more actionable by listing every
 * further way it also could not be raised.
 */
export function resolveInvoiceImports(
  invoices: readonly InvoiceImportDocument[],
  sources: InvoiceResolutionSources,
): ResolvedInvoiceImport {
  const customers = new Set(sources.customers.map(norm));
  const byCode = new Set(sources.incomeAccounts.map((a) => a.code.trim()));
  const byName = new Set(sources.incomeAccounts.map((a) => norm(a.name)));
  const taxByCode = new Set(sources.taxCodes.map((t) => norm(t.code)));
  const taxByName = new Set(sources.taxCodes.map((t) => norm(t.name)));

  const importable: InvoiceImportDocument[] = [];
  const blocked: InvoiceImportProblem[] = [];

  for (const invoice of invoices) {
    if (!customers.has(norm(invoice.customer))) {
      blocked.push({
        reference: invoice.externalReference,
        message: `No customer named ${invoice.customer}`,
      });
      continue;
    }
    const badAccount = invoice.lines.find(
      (line) => !byCode.has(line.incomeAccount.trim()) && !byName.has(norm(line.incomeAccount)),
    );
    if (badAccount) {
      blocked.push({
        reference: invoice.externalReference,
        message: `No active income account matches ${badAccount.incomeAccount}`,
      });
      continue;
    }
    // Sales tax is optional on a line, so only a code that was actually
    // written has to resolve. This is the refusal the preview missed on the
    // day it shipped: six invoices previewed as six creates and raised none,
    // every one carrying a tax code the company does not have.
    const badTax = invoice.lines.find(
      (line) =>
        norm(line.taxCode) !== "" &&
        !taxByCode.has(norm(line.taxCode)) &&
        !taxByName.has(norm(line.taxCode)),
    );
    if (badTax) {
      blocked.push({
        reference: invoice.externalReference,
        message: `No sales tax code matches ${badTax.taxCode}`,
      });
      continue;
    }
    importable.push(invoice);
  }

  return { importable, blocked };
}
