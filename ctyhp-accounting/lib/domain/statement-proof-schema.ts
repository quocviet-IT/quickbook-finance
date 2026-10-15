/**
 * The proof as the server takes it, and an administrator's override (2.04).
 *
 * Apart from statement-proof.ts, which carries the reading rules and every
 * sentence the import dialog says: schemas.ts is loaded by forms on every
 * page, and through it this module, so it holds only what a schema needs and
 * pulls nothing else into the bundle every page shares.
 */
import { z } from "zod";

export const OPENING_BASES = ["printed", "running", "prior", "typed"] as const;
export const CLOSING_BASES = ["printed", "running", "ledger", "typed"] as const;
/** Where an opening came from; the database keeps it with the import (0143). */
export type OpeningBasis = (typeof OPENING_BASES)[number];
/** Where a closing came from; the database keeps it with the import (0143). */
export type ClosingBasis = (typeof CLOSING_BASES)[number];

/** Importing a statement that does not add up: an administrator's reason, kept with the import and in the audit log. */
export const statementOverrideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason for importing a statement that does not add up")
    .max(500, "Keep the reason to 500 characters or fewer"),
});
export type StatementOverride = z.infer<typeof statementOverrideSchema>;

/** The proof as `acc_import_bank_statement_proved` takes it (`p_proof`, 0143). */
export const statementProofPayloadSchema = z
  .object({
    opening_minor: z.number().int("The opening balance must be a whole minor-unit amount").nullable(),
    closing_minor: z.number().int("The closing balance must be a whole minor-unit amount").nullable(),
    opening_basis: z.enum(OPENING_BASES).nullable(),
    closing_basis: z.enum(CLOSING_BASES).nullable(),
    /** How many lines were marked Not a transaction. */
    set_aside: z.number().int().nonnegative("The number of lines marked Not a transaction cannot be negative").default(0),
    override: statementOverrideSchema.nullable().default(null),
  })
  .superRefine((proof, ctx) => {
    if (proof.opening_minor !== null && proof.opening_basis === null) {
      ctx.addIssue({
        code: "custom",
        path: ["opening_basis"],
        message: "Say where the opening balance came from: printed, running, prior or typed",
      });
    }
    if (proof.closing_minor !== null && proof.closing_basis === null) {
      ctx.addIssue({
        code: "custom",
        path: ["closing_basis"],
        message: "Say where the closing balance came from: printed, running, ledger or typed",
      });
    }
  });
export type StatementProofPayload = z.output<typeof statementProofPayloadSchema>;
