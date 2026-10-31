import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUSY,
  CHANGED_AT_ONCE,
  DUPLICATE,
  MISSING_REFERENCE,
  NOT_FOUND,
  NOT_VALID,
  NO_PERMISSION,
  REQUIRED_VALUE,
  SESSION_ENDED,
  SOMETHING_WENT_WRONG,
  STILL_IN_USE,
  TOO_LONG,
  TOO_SLOW,
  UNAVAILABLE,
  VALUE_NOT_ALLOWED,
  publicErrorBody,
  violatedConstraint,
} from "@/lib/db/postgrest-errors";
import { sanitizingFetch } from "@/lib/db/sanitizing-fetch";

describe("publicErrorBody: what Postgres says about itself", () => {
  const cases: Array<[string, string, string]> = [
    ["23505", 'duplicate key value violates unique constraint "acc_contact_name_key"', DUPLICATE],
    ["23503", 'insert or update on table "acc_invoice" violates foreign key constraint "acc_invoice_customer_id_fkey"', MISSING_REFERENCE],
    ["23503", 'update or delete on table "acc_customer" violates foreign key constraint "acc_invoice_customer_id_fkey" on table "acc_invoice"', STILL_IN_USE],
    ["23502", 'null value in column "name" of relation "acc_item" violates not-null constraint', REQUIRED_VALUE],
    ["23514", 'new row for relation "acc_account" violates check constraint "acc_account_clearing_type_ck"', VALUE_NOT_ALLOWED],
    ["42501", 'new row violates row-level security policy for table "acc_feedback_report"', NO_PERMISSION],
    ["42501", "permission denied for table acc_audit_log", NO_PERMISSION],
    ["22001", "value too long for type character varying(40)", TOO_LONG],
    ["22P02", 'invalid input syntax for type uuid: "abc"', NOT_VALID],
    ["22P02", 'invalid input value for enum acc_app_role: "owner"', NOT_VALID],
    ["22003", "numeric field overflow", NOT_VALID],
    ["PGRST116", "JSON object requested, multiple (or no) rows returned", NOT_FOUND],
    ["PGRST116", "Cannot coerce the result to a single JSON object", NOT_FOUND],
    ["42883", "function acc_bank_standing(date) does not exist", UNAVAILABLE],
    ["PGRST202", "Could not find the function public.acc_bank_standing(p_as_of) in the schema cache", UNAVAILABLE],
    ["PGRST106", "The schema must be one of the following: public, co_example", UNAVAILABLE],
    ["40001", "could not serialize access due to concurrent update", CHANGED_AT_ONCE],
    ["40P01", "deadlock detected", CHANGED_AT_ONCE],
    ["55P03", 'could not obtain lock on row in relation "acc_invoice"', BUSY],
    ["57014", "canceling statement due to statement timeout", TOO_SLOW],
    ["PGRST303", "JWT expired", SESSION_ENDED],
    ["22012", "division by zero", SOMETHING_WENT_WRONG],
    ["XX000", "cache lookup failed for relation 12345", SOMETHING_WENT_WRONG],
    ["PGRST100", '"failed to parse filter (eq.)" (line 1, column 4)', UNAVAILABLE],
    ["PGRST301", "No suitable key or wrong key type", SESSION_ENDED],
  ];

  it.each(cases)("%s %s", (code, message, say) => {
    const safe = publicErrorBody({ code, message, details: "Failing row contains (secret, 12.00).", hint: "Look at acc_x." });
    expect(safe?.message).toBe(say);
    expect(safe?.code, "the code is never changed").toBe(code);
    expect(safe?.hint).toBeNull();
    expect(safe?.details ?? "").not.toContain("secret");
  });

  it("passes our own messages through untouched, whatever their code", () => {
    for (const body of [
      { code: "P0001", message: "This person is already in this company", details: null, hint: null },
      { code: "42501", message: "You do not have permission to manage users", details: null, hint: null },
      { code: "23514", message: "A sub-account must have the same type as its parent", details: null, hint: null },
      { code: "22023", message: "Two-step sign-in is still on for this account", details: null, hint: null },
      { code: "P0002", message: "This related company is no longer in the list", details: null, hint: null },
    ]) {
      expect(publicErrorBody(body), body.message).toBeNull();
    }
  });

  it("keeps the broken rule's name, and only the name, for the code that needs it", () => {
    const safe = publicErrorBody({
      code: "23505",
      message: 'duplicate key value violates unique constraint "acc_account_account_code_key"',
      details: "Key (account_code)=(1000) already exists.",
    });
    expect(safe?.details).toBe("constraint acc_account_account_code_key");
    expect(violatedConstraint(safe)).toBe("acc_account_account_code_key");
  });

  it("drops details where a rule's name is not the point", () => {
    const safe = publicErrorBody({ code: "23502", message: 'null value in column "name" violates not-null constraint', details: "Failing row contains (a, b)." });
    expect(safe?.details).toBeNull();
    expect(violatedConstraint(safe)).toBeNull();
  });
});

describe("violatedConstraint", () => {
  it("reads a raw message too, as a service-role client or a test double gives it", () => {
    expect(violatedConstraint({ message: 'duplicate key value violates unique constraint "acc_related_company_name_key"' })).toBe(
      "acc_related_company_name_key",
    );
  });

  it("is null when nothing names a rule", () => {
    expect(violatedConstraint({ message: "This person is already in this company", details: null })).toBeNull();
    expect(violatedConstraint(null)).toBeNull();
  });
});

describe("sanitizingFetch", () => {
  afterEach(() => vi.restoreAllMocks());

  const rest = "https://example.supabase.co/rest/v1/rpc/acc_save_account";
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "content-length": "999" },
    });

  it("rewrites a refused PostgREST request, logs the original code and message, and keeps the status", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = sanitizingFetch(async () =>
      json(409, { code: "23505", message: 'duplicate key value violates unique constraint "acc_account_account_code_key"', details: "Key (account_code)=(1000) already exists.", hint: null }),
    );
    const response = await fetch(rest);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-length")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ code: "23505", message: DUPLICATE, details: "constraint acc_account_account_code_key", hint: null });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain("23505");
    expect(String(log.mock.calls[0][0])).not.toContain("1000");
  });

  it("hands our own messages on as they came", async () => {
    const original = { code: "P0001", message: "This person is already in this company", details: null, hint: null };
    const fetch = sanitizingFetch(async () => json(400, original));
    expect(await (await fetch(rest)).json()).toEqual(original);
  });

  it("leaves successes, Auth, Storage and bodies that are not JSON alone", async () => {
    const ok = json(200, [{ id: 1 }]);
    expect(await sanitizingFetch(async () => ok)(rest)).toBe(ok);
    const auth = json(400, { code: "invalid_credentials", message: "Invalid login credentials" });
    expect(await sanitizingFetch(async () => auth)("https://example.supabase.co/auth/v1/token")).toBe(auth);
    const storage = json(400, { message: 'new row violates row-level security policy for table "objects"' });
    expect(await sanitizingFetch(async () => storage)("https://example.supabase.co/storage/v1/object/x")).toBe(storage);
    const text = await sanitizingFetch(async () => new Response("Bad gateway", { status: 502, headers: { "content-type": "text/plain" } }))(rest);
    expect(await text.text()).toBe("Bad gateway");
  });

  it("reads the address from a URL or a Request as well as a string", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refused = () => json(403, { code: "42501", message: "permission denied for table acc_audit_log" });
    for (const input of [new URL(rest), new Request(rest)]) {
      const body = await (await sanitizingFetch(async () => refused())(input)).json();
      expect(body.message).toBe(NO_PERMISSION);
    }
  });
});
