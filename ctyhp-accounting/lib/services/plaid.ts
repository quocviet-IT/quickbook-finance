import "server-only";

export type PlaidEnvironment = "sandbox" | "development" | "production";

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  original_description?: string | null;
  amount: number;
  pending: boolean;
  payment_channel?: string | null;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}

export interface PlaidRemovedTransaction {
  transaction_id: string;
}

export interface PlaidSyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: PlaidRemovedTransaction[];
  next_cursor: string;
  has_more: boolean;
  request_id: string;
}

interface PlaidErrorBody {
  error_code?: string;
  error_message?: string;
  display_message?: string | null;
  request_id?: string;
}

export class PlaidError extends Error {
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(message: string, code: string | null = null, requestId: string | null = null) {
    super(message);
    this.name = "PlaidError";
    this.code = code;
    this.requestId = requestId;
  }
}

const BASE_URLS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

function environment(): PlaidEnvironment {
  const value = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (value !== "sandbox" && value !== "development" && value !== "production") {
    throw new PlaidError("PLAID_ENV must be sandbox, development, or production");
  }
  return value;
}

export function plaidConfiguration() {
  const clientId = process.env.PLAID_CLIENT_ID?.trim() ?? "";
  const secret = process.env.PLAID_SECRET?.trim() ?? "";
  const env = environment();
  return {
    configured: clientId.length > 8 && secret.length > 8,
    environment: env,
    clientName: process.env.PLAID_CLIENT_NAME?.trim() || "CTYHP Accounting",
  };
}

function credentials(): { clientId: string; secret: string; baseUrl: string } {
  const clientId = process.env.PLAID_CLIENT_ID?.trim() ?? "";
  const secret = process.env.PLAID_SECRET?.trim() ?? "";
  if (!clientId || !secret) {
    throw new PlaidError("Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET on the server.");
  }
  return { clientId, secret, baseUrl: BASE_URLS[environment()] };
}

async function plaidRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret, baseUrl } = credentials();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PlaidError(error instanceof Error ? `Plaid request failed: ${error.message}` : "Plaid request failed");
  }

  const payload = (await response.json().catch(() => ({}))) as T & PlaidErrorBody;
  if (!response.ok) {
    throw new PlaidError(
      payload.display_message || payload.error_message || `Plaid returned HTTP ${response.status}`,
      payload.error_code ?? null,
      payload.request_id ?? null,
    );
  }
  return payload;
}

export async function createPlaidLinkToken(userId: string): Promise<string> {
  const config = plaidConfiguration();
  const body: Record<string, unknown> = {
    client_name: config.clientName,
    language: "en",
    country_codes: ["US"],
    products: ["transactions"],
    user: { client_user_id: userId },
    transactions: { days_requested: 180 },
  };
  const webhook = process.env.PLAID_WEBHOOK_URL?.trim();
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim();
  if (webhook) body.webhook = webhook;
  if (redirectUri) body.redirect_uri = redirectUri;

  const response = await plaidRequest<{ link_token: string }>("/link/token/create", body);
  return response.link_token;
}

export async function exchangePlaidPublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const response = await plaidRequest<{ access_token: string; item_id: string }>(
    "/item/public_token/exchange",
    { public_token: publicToken },
  );
  return { accessToken: response.access_token, itemId: response.item_id };
}

export async function getPlaidAccounts(accessToken: string): Promise<PlaidAccount[]> {
  const response = await plaidRequest<{ accounts: PlaidAccount[] }>("/accounts/get", {
    access_token: accessToken,
  });
  return response.accounts;
}

export async function syncPlaidTransactions(
  accessToken: string,
  cursor?: string | null,
): Promise<PlaidSyncResponse> {
  const body: Record<string, unknown> = {
    access_token: accessToken,
    options: { include_original_description: true },
  };
  if (cursor) body.cursor = cursor;
  return plaidRequest<PlaidSyncResponse>("/transactions/sync", body);
}
