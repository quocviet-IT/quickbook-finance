const OPT_IN = "ONEBOOK_TEST_DATABASE_ONLY";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for destructive E2E tests`);
  }
  return value;
}

function parseUrl(value, name) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL for destructive E2E tests`);
  }
}

function normalizedHttpTarget(value, name) {
  const url = parseUrl(value, name);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.host}${pathname}`;
}

function normalizedDatabaseTarget(value, name) {
  const url = parseUrl(value, name);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function requireDestructiveE2eEnvironment(env = process.env) {
  if (env.ALLOW_DESTRUCTIVE_E2E !== OPT_IN) {
    throw new Error(
      `Set ALLOW_DESTRUCTIVE_E2E=${OPT_IN} only for an isolated test project`,
    );
  }

  const result = {
    databaseUrl: required(env, "E2E_DATABASE_URL"),
    supabaseUrl: required(env, "E2E_SUPABASE_URL"),
    anonKey: required(env, "E2E_SUPABASE_ANON_KEY"),
    email: required(env, "E2E_EMAIL"),
    password: required(env, "E2E_PASSWORD"),
    secondaryEmail: required(env, "E2E_SECONDARY_EMAIL"),
    secondaryPassword: required(env, "E2E_SECONDARY_PASSWORD"),
  };

  if (
    env.SUPABASE_DB_URL &&
    normalizedDatabaseTarget(result.databaseUrl, "E2E_DATABASE_URL") ===
      normalizedDatabaseTarget(env.SUPABASE_DB_URL, "SUPABASE_DB_URL")
  ) {
    throw new Error("E2E_DATABASE_URL must not target SUPABASE_DB_URL");
  }

  if (
    env.NEXT_PUBLIC_SUPABASE_URL &&
    normalizedHttpTarget(result.supabaseUrl, "E2E_SUPABASE_URL") ===
      normalizedHttpTarget(
        env.NEXT_PUBLIC_SUPABASE_URL,
        "NEXT_PUBLIC_SUPABASE_URL",
      )
  ) {
    throw new Error(
      "E2E_SUPABASE_URL must not target NEXT_PUBLIC_SUPABASE_URL",
    );
  }

  return result;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function requireDestructiveE2eServiceRoleEnvironment(env = process.env) {
  return {
    ...requireDestructiveE2eEnvironment(env),
    serviceRoleKey: required(env, "E2E_SUPABASE_SERVICE_ROLE_KEY"),
  };
}
