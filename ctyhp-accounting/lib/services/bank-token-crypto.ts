import "server-only";
import { openBankToken, sealBankToken } from "@/lib/domain/bank-token-seal";

/**
 * The keys bank feed tokens are sealed with (lib/domain/bank-token-seal.ts).
 *
 *   BANK_FEED_ENCRYPTION_KEY           the key every new token is sealed with
 *   BANK_FEED_ENCRYPTION_KEY_PREVIOUS  older keys, comma-separated, still read
 *                                      while a rotation is under way
 *
 * Rotating: put the new key in BANK_FEED_ENCRYPTION_KEY and the old one in
 * BANK_FEED_ENCRYPTION_KEY_PREVIOUS, deploy, run
 * scripts/reseal-bank-tokens.mjs --commit, then remove the previous key.
 */
function currentSecret(): string {
  const secret = process.env.BANK_FEED_ENCRYPTION_KEY?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("BANK_FEED_ENCRYPTION_KEY must be configured with at least 32 characters");
  }
  return secret;
}

function previousSecrets(): string[] {
  return (process.env.BANK_FEED_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= 32);
}

export function bankFeedEncryptionConfigured(): boolean {
  return (process.env.BANK_FEED_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

/** Seals a Plaid access token for the item it belongs to. */
export function encryptBankToken(plainText: string, itemId: string): string {
  return sealBankToken(plainText, currentSecret(), itemId);
}

/** Opens a stored token; `itemId` is the connection's Plaid item. */
export function decryptBankToken(payload: string, itemId: string): string {
  return openBankToken(payload, [currentSecret(), ...previousSecrets()], itemId);
}
