import { createHash } from "node:crypto";

/** Collision-resistant deterministic hash for immutable statement rows. */
export function statementRowHash(
  parts: (string | number | null | undefined)[],
): string {
  const canonical = parts.map((part) => String(part ?? "")).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
