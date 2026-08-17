import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAutomationClient, listActiveAutomationCompanies } from "@/lib/db/automation";
import {
  runForAutomationCompanies,
  type AutomationCompany,
} from "@/lib/domain/company-automation";
import { takeCompanyBackup } from "@/lib/services/backup";
import { companiesDueForBackup, type BackupCandidate } from "@/lib/services/backup-queue";

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
 * Tonight's snapshots: a batch of the companies waiting longest.
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
  const today = deps.today ?? new Date().toISOString().slice(0, 10);

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

  const due = companiesDueForBackup(candidates);
  for (const candidate of due) {
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

  const result: BackupRunResult = {
    attempted: due.length,
    stored: results.filter((r) => r.ok && r.status === "stored").length,
    skipped: results.filter((r) => r.ok && r.status === "skipped").length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };

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
