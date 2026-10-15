/**
 * The most statement lines one run of statement files may hold.
 *
 * Apart from statement-run.ts, which reads the files and proves them: the
 * forms' schemas.ts is loaded on every page and needs only this number, and
 * importing it from statement-run.ts put the statement readers into the
 * bundle every page shares.
 */
export const MAX_RUN_LINES = 10_000;
