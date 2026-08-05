import "server-only";
import pg from "pg";

/**
 * A direct Postgres connection, for the one job PostgREST cannot do.
 *
 * Creating a company needs `create schema`, a role setting and `notify pgrst` —
 * DDL and server configuration, not row access. This is the only place in the
 * running application that holds the connection string, and nothing but
 * provisioning may import it.
 */
export async function createProvisioningClient(): Promise<pg.Client> {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "This deployment has no database connection string, so it cannot create a company. " +
        "Set SUPABASE_DB_URL in the project's environment.",
    );
  }
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  return client;
}
