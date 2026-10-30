import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAutomationClient, listActiveAutomationCompanies } from "@/lib/db/automation";
import {
  runForAutomationCompanies,
  type AutomationCompany,
} from "@/lib/domain/company-automation";
import { takeCompanyBackup } from "@/lib/services/backup";
import { BACKUP_TIME_BUDGET_MS, companiesDueForBackup, type BackupCandidate } from "@/lib/services/backup-queue";

export interface BackupRunItemResult {
  slug: string;
  ok: boolean;
  status?: "stored" | "skipped";
  /** A stored night whose retention pass afterwards got stuck — a caveat, not a failure. */
  retentionWarning?: string;
  error?: string;
}

export interface BackupRunResult {
  /** Companies actually run through takeCompanyBackup tonight: stored + skipped + failed. */
  attempted: number;
  stored: number;
  skipped: number;
  /**
   * Includes a takeCompanyBackup failure and a company whose last-snapshot
   * date could not even be read (see readLastBackup below) — either way,
   * that company did not get covered tonight. It does not include a stored
   * night with a stuck retentionWarning; that night still succeeded.
   */
  failed: number;
  /**
   * Companies the night ran out of time for, by slug, in the order they wait.
   * Not failures: nothing was tried, and they are first in line for the next run.
   */
  deferred: string[];
  /**
   * On the night's last run only (2.90): the companies the night ended without a
   * snapshot for, deferred or failed. Empty on an earlier run, whose leftovers
   * the next run takes.
   */
  incomplete: string[];
  results: BackupRunItemResult[];
}

interface BackupQueueDependencies {
  listCompanies?: () => Promise<AutomationCompany[]>;
  createClient?: (schema: string) => SupabaseClient;
  readLastBackup?: (sb: SupabaseClient) => Promise<string | null>;
  takeBackup?: (
    sb: SupabaseClient,
    companyId: string,
    today: string,
  ) => ReturnType<typeof takeCompanyBackup>;
  today?: string;
  /** Milliseconds, for the time budget. A test passes its own clock. */
  now?: () => number;
  /** The night's last run (?pass=3): what it leaves undone, nothing after it will do. */
  final?: boolean;
}

/**
 * The date of a company's most recent snapshot attempt, `stored` or
 * `skipped` alike — both mean the night was covered, since takeCompanyBackup
 * writes an acc_backup row either way and only omits one when it throws.
 * Reading only `stored` rows would make an unchanging company look
 * permanently overdue and let it crowd every batch, which is the opposite of
 * what "waiting longest" is supposed to mean.
 */
async function lastBackupDate(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_backup")
    .select("taken_at")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the last snapshot date failed: ${error.message}`);
  return (data?.taken_at as string | undefined) ?? null;
}

/**
 * Tonight's snapshots: every company not yet backed up today, longest waiting
 * first, for as long as the time budget lasts (BACKUP_TIME_BUDGET_MS). The
 * night has three runs; each later one takes what an earlier one did not reach.
 *
 * Ranking needs every company's last snapshot date, so that read runs for
 * all of them first, isolated per company through runForAutomationCompanies —
 * the same helper the other background jobs use to keep one company's
 * trouble from taking the others down with it. A company whose read fails is
 * recorded as failed and left out of the ranking rather than guessed at
 * (guessing it "never backed up" would let a broken company monopolise every
 * batch ahead of companies genuinely waiting). Only the companies chosen
 * after that go on to takeCompanyBackup, each in its own try/catch for the
 * same reason: one company storing or skipping must say nothing about the
 * rest. Discovering the companies at all (listCompanies) is deliberately
 * outside every isolation this function offers — a register nobody can read
 * means we do not know who the companies are, and a run that quietly
 * skipped everyone would look identical to a quiet, uneventful night.
 *
 * Every failure caught below is also logged where it is caught, and the run
 * logs once more if any of them did. Nothing else in this job persists a run
 * record or reads acc_backup back out, and the cron route this feeds answers
 * every night with HTTP 200 regardless — so without these lines a company
 * stuck here (missing grants, an unreachable bucket, anything) fails the
 * same way, silently, for as long as the condition lasts.
 */
export async function runDueCompanyBackups(
  deps: BackupQueueDependencies = {},
): Promise<BackupRunResult> {
  const listCompanies = deps.listCompanies ?? listActiveAutomationCompanies;
  const createClient = deps.createClient ?? createSupabaseAutomationClient;
  const readLastBackup = deps.readLastBackup ?? lastBackupDate;
  const takeBackup = deps.takeBackup ?? takeCompanyBackup;
  // A machine day, not a screen date: the nightly job ranks companies by how long since their last backup, on one clock for all of them, so UTC is right here.
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const now = deps.now ?? Date.now;
  const started = now();

  const companies = await listCompanies();
  const reads = await runForAutomationCompanies(companies, (company) =>
    readLastBackup(createClient(company.schemaName)),
  );

  const results: BackupRunItemResult[] = [];
  const candidates: Array<BackupCandidate & { company: AutomationCompany }> = [];
  for (const read of reads) {
    if (read.ok) {
      candidates.push({ slug: read.company.slug, lastBackup: read.result, company: read.company });
    } else {
      // Excluded from tonight's ranking below, and — without this line —
      // from every other trace of the run too: this result field is the
      // only other place the failure is recorded, and nothing reads it back.
      console.error(
        `Nightly backup: could not read company ${read.company.slug}'s last snapshot date, so it was left out of tonight's ranking:`,
        read.error,
      );
      results.push({ slug: read.company.slug, ok: false, error: read.error });
    }
  }

  // A later run the same night covers only what an earlier one did not reach.
  const due = companiesDueForBackup(candidates, today);
  const deferred: string[] = [];
  for (const candidate of due) {
    // Checked before each snapshot, never during one: a snapshot is started
    // only while the budget lasts, and one under way always gets to finish.
    if (now() - started >= BACKUP_TIME_BUDGET_MS) {
      deferred.push(candidate.slug);
      continue;
    }
    try {
      const outcome = await takeBackup(
        createClient(candidate.company.schemaName),
        candidate.company.id,
        today,
      );
      results.push({
        slug: candidate.slug,
        ok: true,
        status: outcome.status,
        retentionWarning: outcome.retentionWarning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup failed";
      // Same reasoning as the read failure above, and the one gap Task 4's
      // own retention log does not cover: that log only ever fires from
      // inside a night that already got as far as `stored`. A night that
      // never reached that point — takeBackup itself threw — has nothing
      // else naming which company it was.
      console.error(`Nightly backup failed for company ${candidate.slug}:`, message);
      results.push({ slug: candidate.slug, ok: false, error: message });
    }
  }

  const failedSlugs = results.filter((r) => !r.ok).map((r) => r.slug);
  const incomplete = deps.final ? [...deferred, ...failedSlugs] : [];
  const result: BackupRunResult = {
    attempted: due.length - deferred.length,
    stored: results.filter((r) => r.ok && r.status === "stored").length,
    skipped: results.filter((r) => r.ok && r.status === "skipped").length,
    failed: results.filter((r) => !r.ok).length,
    deferred,
    incomplete,
    results,
  };

  if (incomplete.length > 0) {
    // The night is over: no later run will take these, so this is an error,
    // and the route answers 500 for it (2.90). On 29 October two companies
    // went without a snapshot under a 200 that said nothing.
    console.error(
      `Nightly backup: the night's last run is over and these companies have no snapshot today: ${incomplete.join(", ")}`,
    );
  } else if (deferred.length > 0) {
    // Not an error, and the route still answers 200: nothing failed. It is a
    // sign the companies have outgrown one night, so it is logged where
    // whoever reads the cron log will see it.
    console.warn(
      `Nightly backup: the ${BACKUP_TIME_BUDGET_MS / 1000}-second budget ran out; first in line for the next run: ${deferred.join(", ")}`,
    );
  }

  if (result.failed > 0) {
    // Each failure above already named its own company; this line is for
    // the reader who never gets that far down the log, and for the route
    // below, which turns this same count into a status code — Vercel's own
    // cron log keeps path, status and duration and discards the body, so
    // the status code is the only thing a glance at that log will show.
    const failedSlugs = results.filter((r) => !r.ok).map((r) => r.slug);
    const noun = results.length === 1 ? "company" : "companies";
    console.error(
      `Nightly backup run: ${result.failed} of ${results.length} ${noun} touched tonight failed: ${failedSlugs.join(", ")}`,
    );
  }

  return result;
}
