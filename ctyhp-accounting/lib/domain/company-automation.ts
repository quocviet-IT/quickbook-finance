/**
 * Running background work for every company, one company at a time.
 *
 * Automation used to serve a single set of books. With a register of companies
 * it has to serve all of them, and two rules matter more than speed:
 *
 *   a company that fails must not silence the others, and the answer must come
 *   back in register order so the same run always reads the same way.
 *
 * Concurrency stays deliberately small. These jobs talk to outside services —
 * a bank provider, a scanner — and flooding them is worse than finishing late.
 */

/** A company as automation needs it: who it is, and where its books live. */
export interface AutomationCompany {
  id: string;
  slug: string;
  schemaName: string;
  legalName: string;
}

export interface CompanyRunSuccess<T> {
  company: AutomationCompany;
  ok: true;
  result: T;
}

export interface CompanyRunFailure {
  company: AutomationCompany;
  ok: false;
  error: string;
}

export type CompanyRunResult<T> = CompanyRunSuccess<T> | CompanyRunFailure;

export const AUTOMATION_COMPANY_CONCURRENCY = 2;

/**
 * Run `worker` for each company, at most `concurrency` at a time.
 *
 * Results come back at the index of the company that produced them, never in
 * completion order: a run of six companies has to be comparable to yesterday's
 * run of six companies. A thrown worker becomes a failure result for that one
 * company; nothing propagates out of this function except a caller mistake.
 */
export async function runForAutomationCompanies<T>(
  companies: readonly AutomationCompany[],
  worker: (company: AutomationCompany) => Promise<T>,
  concurrency: number = AUTOMATION_COMPANY_CONCURRENCY,
): Promise<CompanyRunResult<T>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Company automation concurrency must be a positive integer");
  }

  const results: CompanyRunResult<T>[] = new Array(companies.length);
  let next = 0;

  // A fixed pool of pullers rather than a promise per company: nothing is
  // started until a lane is free, so the limit holds however slow a company is.
  async function lane(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= companies.length) return;
      const company = companies[index];
      try {
        results[index] = { company, ok: true, result: await worker(company) };
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : "Company automation failed";
        results[index] = { company, ok: false, error };
      }
    }
  }

  const lanes = Math.min(concurrency, companies.length);
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}

/** How many companies finished their work, and how many could not. */
export function summarizeCompanyRun<T>(results: readonly CompanyRunResult<T>[]): {
  companyCount: number;
  failedCompanyCount: number;
} {
  return {
    companyCount: results.length,
    failedCompanyCount: results.filter((row) => !row.ok).length,
  };
}
