import "server-only";
import { createProvisioningClient } from "@/lib/db/provisioning-client";
import { loadMigrationSources, type MigrationSource } from "@/lib/db/migration-sources";
import {
  provisionCompany,
  type PgLike,
  type ProvisionCompanyInput,
  type ProvisionCompanyResult,
} from "@/lib/services/company-provisioning";

export interface CompanyQueueResult {
  requestId: string;
  slug: string;
  ok: boolean;
  error?: string;
}

export interface CompanyQueueRun {
  processed: number;
  /** How many migration files the deployment could actually see. */
  migrationFileCount: number;
  results: CompanyQueueResult[];
}

interface QueueDependencies {
  createClient?: () => Promise<PgLike & { end(): Promise<void> }>;
  provision?: (
    client: PgLike,
    input: ProvisionCompanyInput,
    sources: readonly MigrationSource[],
  ) => Promise<ProvisionCompanyResult>;
  loadSources?: () => MigrationSource[];
  maxRequests?: number;
}

/**
 * Build whatever companies are waiting.
 *
 * One transaction per request: a company either exists completely or was never
 * started, and either way the request row says which. The failure message is
 * kept because the person who asked is not watching a terminal.
 */
export async function runPendingCompanyProvisioning(
  deps: QueueDependencies = {},
): Promise<CompanyQueueRun> {
  const createClient = deps.createClient ?? createProvisioningClient;
  const provision = deps.provision ?? provisionCompany;
  const loadSources = deps.loadSources ?? loadMigrationSources;
  const maxRequests = deps.maxRequests ?? 3;

  const sources = loadSources();
  const client = await createClient();
  const results: CompanyQueueResult[] = [];

  try {
    for (let i = 0; i < maxRequests; i += 1) {
      const claimed = await client.query(`select * from onebook.claim_company_request()`);
      const row = claimed.rows[0];
      if (!row || !row.id) break;

      const requestId = row.id as string;
      const slug = row.slug as string;
      try {
        await client.query("begin");
        const result = await provision(
          client,
          {
            slug,
            legalName: row.legal_name as string,
            isSample: Boolean(row.is_sample),
            displayOrder: Number(row.display_order ?? 100),
            adminUserIds: row.requested_by ? [row.requested_by as string] : [],
          },
          sources,
        );
        await client.query(`select onebook.complete_company_request($1, $2)`, [
          requestId,
          result.companyId,
        ]);
        await client.query("commit");
        results.push({ requestId, slug, ok: true });
      } catch (error) {
        await client.query("rollback");
        const message = error instanceof Error ? error.message : "Provisioning failed";
        // Outside the rolled-back transaction, so the reason survives.
        await client.query(`select onebook.fail_company_request($1, $2)`, [requestId, message]);
        results.push({ requestId, slug, ok: false, error: message });
      }
    }
  } finally {
    await client.end();
  }

  return { processed: results.length, migrationFileCount: sources.length, results };
}
