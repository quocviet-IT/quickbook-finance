import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MigrationSource {
  file: string;
  sql: string;
}

/**
 * The migration that builds the register itself; a company never contains it.
 * Matched by full name — two branches can land on the same number.
 */
export const REGISTER_MIGRATION = "0081_company_register.sql";

/**
 * Every migration a new company must be given, in order.
 *
 * Read from disk at call time rather than bundled as a string, so a migration
 * added tomorrow needs no code change. On Vercel the files reach the function
 * through `outputFileTracingIncludes` in next.config.ts; if that is ever
 * dropped this throws here rather than building three quarters of a ledger.
 */
export function loadMigrationSources(root = process.cwd()): MigrationSource[] {
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && file !== REGISTER_MIGRATION)
    .sort();
  if (files.length === 0) {
    throw new Error(`No migration files found in ${dir}; a company cannot be built without them`);
  }
  return files.map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}
