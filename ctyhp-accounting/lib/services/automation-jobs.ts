import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringFrequency } from "@/lib/db/types";
import { createSupabaseAutomationClient, listActiveAutomationCompanies } from "@/lib/db/automation";
import {
  AUTOMATION_COMPANY_CONCURRENCY,
  runForAutomationCompanies,
  summarizeCompanyRun,
  type AutomationCompany,
  type CompanyRunResult,
} from "@/lib/domain/company-automation";
import { nextRecurringDate } from "@/lib/domain/recurring";
import { listBankConnections, syncBankConnection } from "@/lib/services/banking";
import { companyToday } from "@/lib/services/company";
import { generateRecurringTemplate, listDueRecurringTemplates } from "@/lib/services/recurring";

/**
 * The two background jobs, run once per company (the document scan went in 2.52).
 *
 * Every quota below is *per company*. A busy company must not spend the budget
 * of the company after it in the register, so each worker starts from a fresh
 * count and the register order decides nothing except the order of the report.
 *
 * The routes own authorization and the HTTP shape; everything about what work
 * gets done, and how much of it, lives here.
 */

/** At most this many non-disconnected bank connections per company, per run. */
const BANK_CONNECTION_LIMIT = 20;
/** At most this many due recurring templates per company, per run. */
const RECURRING_TEMPLATE_LIMIT = 50;
/** At most this many claimed occurrences per company, per run. */
const RECURRING_OCCURRENCE_LIMIT = 100;
/** No single template may run away with a company's whole budget. */
const RECURRING_TEMPLATE_OCCURRENCE_LIMIT = 12;

interface CompanyDependencies {
  listCompanies?: () => Promise<AutomationCompany[]>;
  createClient?: (schema: string) => SupabaseClient;
  concurrency?: number;
}

/**
 * Discover companies, then run `worker` for each of them.
 *
 * Discovery failure is deliberately outside the isolation the runner provides:
 * an unreadable register means we do not know who the companies are, and a run
 * that covered only `public` would look like a success. It has to fail loudly.
 */
async function runPerCompany<T>(
  deps: CompanyDependencies,
  worker: (company: AutomationCompany, sb: SupabaseClient) => Promise<T>,
): Promise<{ companies: CompanyRunResult<T>[]; companyCount: number; failedCompanyCount: number }> {
  const listCompanies = deps.listCompanies ?? listActiveAutomationCompanies;
  const createClient = deps.createClient ?? createSupabaseAutomationClient;
  const companies = await listCompanies();

  const results = await runForAutomationCompanies(
    companies,
    // One client per company, reused for every item: the schema binding is what
    // keeps a company's work inside its own books.
    (company) => worker(company, createClient(company.schemaName)),
    deps.concurrency ?? AUTOMATION_COMPANY_CONCURRENCY,
  );

  return { companies: results, ...summarizeCompanyRun(results) };
}

/** Total of a per-company figure, counting only companies that got that far. */
function sumOverCompanies<T>(
  results: readonly CompanyRunResult<T>[],
  of: (result: T) => number,
): number {
  return results.reduce((total, row) => (row.ok ? total + of(row.result) : total), 0);
}

// ---------------------------------------------------------------- bank feeds

export interface BankFeedItemResult {
  connectionId: string;
  institution: string;
  ok: boolean;
  added?: number;
  modified?: number;
  removed?: number;
  suggestions?: number;
  error?: string;
}

export interface BankFeedCompanyResult {
  connectionCount: number;
  results: BankFeedItemResult[];
}

export interface BankFeedJobResult {
  companyCount: number;
  failedCompanyCount: number;
  connectionCount: number;
  companies: CompanyRunResult<BankFeedCompanyResult>[];
}

export interface BankFeedJobDependencies extends CompanyDependencies {
  listConnections?: (
    sb: SupabaseClient,
  ) => Promise<Array<{ id: string; institution_name: string; status: string }>>;
  syncConnection?: (
    sb: SupabaseClient,
    connectionId: string,
  ) => Promise<{ added: number; modified: number; removed: number; suggestions: number }>;
}

export async function runBankFeedAutomationJob(
  deps: BankFeedJobDependencies = {},
): Promise<BankFeedJobResult> {
  const listConnections = deps.listConnections ?? listBankConnections;
  const syncConnection = deps.syncConnection ?? syncBankConnection;

  const run = await runPerCompany<BankFeedCompanyResult>(deps, async (_company, sb) => {
    const connections = (await listConnections(sb))
      .filter((connection) => connection.status !== "disconnected")
      .slice(0, BANK_CONNECTION_LIMIT);
    const results: BankFeedItemResult[] = [];

    // Sequential by design: it avoids provider bursts and keeps one connection's
    // cursor update isolated from every other institution.
    for (const connection of connections) {
      try {
        const result = await syncConnection(sb, connection.id);
        results.push({
          connectionId: connection.id,
          institution: connection.institution_name,
          ok: true,
          ...result,
        });
      } catch (error) {
        results.push({
          connectionId: connection.id,
          institution: connection.institution_name,
          ok: false,
          error: error instanceof Error ? error.message : "Synchronization failed",
        });
      }
    }

    return { connectionCount: connections.length, results };
  });

  return {
    ...run,
    connectionCount: sumOverCompanies(run.companies, (result) => result.connectionCount),
  };
}

// ------------------------------------------------------ recurring transactions

export interface RecurringItemResult {
  templateId: string;
  name: string;
  scheduledDate: string;
  ok: boolean;
  status?: string;
  documentId?: string | null;
  error?: string;
}

export interface RecurringCompanyResult {
  /** The day this company was run for: its own today unless the caller named one. */
  asOf: string;
  scheduleCount: number;
  results: RecurringItemResult[];
}

export interface RecurringJobResult {
  /** The day the caller named, or null when each company ran for its own today. */
  asOf: string | null;
  companyCount: number;
  failedCompanyCount: number;
  scheduleCount: number;
  companies: CompanyRunResult<RecurringCompanyResult>[];
}

interface DueTemplate {
  id: string;
  name: string;
  start_date: string;
  next_run_date: string;
  end_date: string | null;
  frequency: RecurringFrequency;
  interval_count: number;
}

export interface RecurringJobDependencies extends CompanyDependencies {
  listDueTemplates?: (sb: SupabaseClient, asOf: string, limit: number) => Promise<DueTemplate[]>;
  generateTemplate?: (
    sb: SupabaseClient,
    templateId: string,
  ) => Promise<{ status: string; documentId: string | null; claimed: boolean }>;
}

/** `asOf` left out, every company runs for its own today, in its own time zone. */
export async function runRecurringAutomationJob(
  asOf?: string,
  deps: RecurringJobDependencies = {},
): Promise<RecurringJobResult> {
  const listDueTemplates = deps.listDueTemplates ?? listDueRecurringTemplates;
  const generateTemplate = deps.generateTemplate ?? generateRecurringTemplate;

  const run = await runPerCompany<RecurringCompanyResult>(deps, async (_company, sb) => {
    const runDay = asOf ?? (await companyToday(sb));
    const templates = await listDueTemplates(sb, runDay, RECURRING_TEMPLATE_LIMIT);
    const results: RecurringItemResult[] = [];

    // The budget is per company, so it is declared here and nowhere higher up.
    let occurrenceCount = 0;
    for (const template of templates) {
      let scheduledDate = template.next_run_date;
      let scheduleOccurrences = 0;
      while (
        scheduledDate <= runDay &&
        (!template.end_date || scheduledDate <= template.end_date) &&
        scheduleOccurrences < RECURRING_TEMPLATE_OCCURRENCE_LIMIT &&
        occurrenceCount < RECURRING_OCCURRENCE_LIMIT
      ) {
        try {
          const result = await generateTemplate(sb, template.id);
          results.push({
            templateId: template.id,
            name: template.name,
            scheduledDate,
            ok: true,
            status: result.status,
            documentId: result.documentId,
          });
          if (!result.claimed) break;
          scheduledDate = nextRecurringDate(
            scheduledDate,
            template.start_date,
            template.frequency,
            template.interval_count,
          );
          scheduleOccurrences += 1;
          occurrenceCount += 1;
        } catch (error) {
          results.push({
            templateId: template.id,
            name: template.name,
            scheduledDate,
            ok: false,
            error: error instanceof Error ? error.message : "Generation failed",
          });
          break;
        }
      }
    }

    return { asOf: runDay, scheduleCount: templates.length, results };
  });

  return {
    asOf: asOf ?? null,
    ...run,
    scheduleCount: sumOverCompanies(run.companies, (result) => result.scheduleCount),
  };
}
