/**
 * What a person is shown when the database refuses a request.
 *
 * Nearly every service passes `error.message` from Supabase straight up to the
 * screen, and about 55 action files each do it their own way, so the message
 * is cleaned where it arrives instead: in the response from PostgREST, before
 * supabase-js turns it into a PostgrestError. Two kinds of message come back:
 *
 *   * the ones our own SQL raises ("This person is already in this company",
 *     "You do not have permission to manage users"). They are written for the
 *     screen and pass through untouched;
 *   * the ones Postgres or PostgREST writes about itself: constraint, table,
 *     column and function names, `Failing row contains (...)` with the row's
 *     values in `details`, a parser error. Those are replaced here by a
 *     sentence that says what happened in the screen's words.
 *
 * Which is which is told by the shape of the message, not by its code: our
 * functions raise 42501 and 23514 themselves, with their own wording, and
 * that wording must survive. `code` is never changed, so a caller that
 * branches on 23505 or P0002 keeps working. Where a caller needs to know
 * which unique or check rule was broken, `violatedConstraint` reads the name
 * from `details`, the only thing left there.
 *
 * Pure: no I/O. `sanitizingFetch` in ./sanitizing-fetch.ts applies it.
 */

/** The JSON body PostgREST answers an error with. */
export interface PostgrestErrorBody {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export const DUPLICATE = "A record with these details already exists.";
export const MISSING_REFERENCE = "Something this refers to is no longer there. Refresh the page and try again.";
export const STILL_IN_USE = "This is still used elsewhere in the books, so it cannot be removed.";
export const REQUIRED_VALUE = "A required value is missing.";
export const VALUE_NOT_ALLOWED = "One of the values is not allowed here.";
export const OVERLAPS = "This overlaps with one that is already here.";
export const NO_PERMISSION = "You do not have permission to do that.";
export const TOO_LONG = "One of the values is too long.";
export const NOT_VALID = "One of the values is not valid.";
export const NOT_FOUND = "That record could not be found. It may have been removed.";
export const UNAVAILABLE = "This part of OneBook is not available right now. Refresh the page and try again.";
export const CHANGED_AT_ONCE = "Someone else changed this at the same moment. Try again.";
export const BUSY = "Someone else is working on this right now. Try again in a moment.";
export const TOO_SLOW = "That took too long and was stopped. Try again, or ask for less at once.";
export const SESSION_ENDED = "Your session has ended. Sign in again.";
export const SOMETHING_WENT_WRONG =
  "Something went wrong in the books. Try again, and report it if it keeps happening.";

/** A message Postgres writes about itself, and what to say instead. */
interface Rule {
  shape: RegExp;
  say: string;
  /** Carries the constraint name into `details` for `violatedConstraint`. */
  keepsConstraint?: boolean;
}

const RULES: Rule[] = [
  { shape: /^duplicate key value violates unique constraint "[^"]+"/, say: DUPLICATE, keepsConstraint: true },
  { shape: /^insert or update on table "[^"]+" violates foreign key constraint "[^"]+"/, say: MISSING_REFERENCE, keepsConstraint: true },
  { shape: /^update or delete on table "[^"]+" violates foreign key constraint "[^"]+"/, say: STILL_IN_USE, keepsConstraint: true },
  { shape: /^null value in column "[^"]+"( of relation "[^"]+")? violates not-null constraint/, say: REQUIRED_VALUE },
  { shape: /violates check constraint "[^"]+"/, say: VALUE_NOT_ALLOWED, keepsConstraint: true },
  { shape: /^check constraint "[^"]+" (of relation "[^"]+" )?is violated by some row/, say: VALUE_NOT_ALLOWED, keepsConstraint: true },
  { shape: /violates exclusion constraint "[^"]+"/, say: OVERLAPS, keepsConstraint: true },
  { shape: /^new row violates row-level security policy/, say: NO_PERMISSION },
  { shape: /^permission denied for /, say: NO_PERMISSION },
  { shape: /^must be owner of /, say: NO_PERMISSION },
  { shape: /^value too long for type /, say: TOO_LONG },
  { shape: /^invalid input (syntax|value) for /, say: NOT_VALID },
  { shape: /^(date\/time field value|value "[^"]*" is) out of range/, say: NOT_VALID },
  { shape: /out of range for type /, say: NOT_VALID },
  { shape: /^numeric field overflow/, say: NOT_VALID },
  { shape: /^(JSON object requested, multiple \(or no\) rows returned|Cannot coerce the result to a single JSON object)/, say: NOT_FOUND },
  { shape: /^(column|relation|function|operator|type|schema) .+ does not exist/, say: UNAVAILABLE },
  { shape: /^Could not find (the|a) /, say: UNAVAILABLE },
  { shape: /^(The )?schema must be one of/i, say: UNAVAILABLE },
  { shape: /^could not serialize access/, say: CHANGED_AT_ONCE },
  { shape: /^deadlock detected/, say: CHANGED_AT_ONCE },
  { shape: /^(could not obtain lock|canceling statement due to lock timeout)/, say: BUSY },
  { shape: /^canceling statement due to statement timeout/, say: TOO_SLOW },
  { shape: /^(JWT|JWS)/, say: SESSION_ENDED },
  { shape: /^(division by zero|more than one row returned by a subquery|current transaction is aborted)/, say: SOMETHING_WENT_WRONG },
];

/**
 * Error classes our SQL never raises: Postgres's own internals, connection and
 * resource trouble. A message with one of these codes is never one of ours.
 */
const INTERNAL_CODE = /^(XX|08|0A|25|39|53|54|55|57|58)|^42601$|^PGRST/;

const CONSTRAINT = /constraint "([^"]+)"/;
const CONSTRAINT_DETAIL = /^constraint (\S+)$/;

/**
 * The body to hand on in place of `body`, or null when `body` is ours (or not
 * an error PostgREST wrote) and goes through as it is.
 */
export function publicErrorBody(body: PostgrestErrorBody): PostgrestErrorBody | null {
  const message = typeof body.message === "string" ? body.message : "";
  const code = typeof body.code === "string" ? body.code : "";
  const rule = RULES.find((r) => r.shape.test(message));
  if (!rule && !INTERNAL_CODE.test(code)) return null;
  const say = rule?.say ?? (code.startsWith("PGRST3") ? SESSION_ENDED : code.startsWith("PGRST") ? UNAVAILABLE : SOMETHING_WENT_WRONG);
  const constraint = rule?.keepsConstraint ? CONSTRAINT.exec(message)?.[1] : undefined;
  return {
    ...body,
    message: say,
    details: constraint ? `constraint ${constraint}` : null,
    hint: null,
  };
}

/**
 * Which unique, foreign-key or check rule a refused write broke, by name; null
 * when the database did not say. Reads what `publicErrorBody` left in
 * `details`, or the raw message where nothing cleaned it (a service-role
 * client, a test double).
 */
export function violatedConstraint(error: { message?: string | null; details?: string | null } | null | undefined): string | null {
  if (!error) return null;
  const kept = typeof error.details === "string" ? CONSTRAINT_DETAIL.exec(error.details)?.[1] : undefined;
  if (kept) return kept;
  return (typeof error.message === "string" ? CONSTRAINT.exec(error.message)?.[1] : undefined) ?? null;
}
