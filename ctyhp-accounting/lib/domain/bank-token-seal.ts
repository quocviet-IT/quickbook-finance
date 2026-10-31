import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Sealing a bank feed's access token (Plaid) for storage, and opening it again.
 *
 * AES-256-GCM. Two formats are read:
 *
 *   v1.<iv>.<tag>.<data>          (until 2.96) one key, nothing bound to the row
 *   v2.<key>.<iv>.<tag>.<data>    (2.96) names the key that sealed it, and is
 *                                 bound to the Plaid item it belongs to
 *
 * Only v2 is written. Naming the key is what makes rotation possible: a new key
 * goes in, the old one stays readable as a previous key until every token has
 * been resealed (scripts/reseal-bank-tokens.mjs), then it is dropped. Binding
 * to the item (the GCM associated data) means a sealed token copied onto
 * another connection's row does not open there.
 *
 * Pure: node:crypto only and relative imports, so the reseal script can load
 * it under plain Node. The keys come from the caller.
 */

/** Each secret is hashed to the 32-byte key, as v1 always did. */
function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** A short public name for a key: 8 hex characters of a hash of the key, never the key. */
export function keyIdOf(secret: string): string {
  return createHash("sha256").update("onebook bank token key id ").update(keyFrom(secret)).digest("hex").slice(0, 8);
}

function associatedData(itemId: string): Buffer {
  return Buffer.from(`onebook bank token v2 ${itemId}`, "utf8");
}

export function sealBankToken(plainText: string, secret: string, itemId: string): string {
  if (!itemId) throw new Error("A bank token is sealed for one Plaid item; the item id is missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  cipher.setAAD(associatedData(itemId));
  const data = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return ["v2", keyIdOf(secret), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function open(secret: string, iv: string, tag: string, data: string, aad: Buffer | null): string {
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * The token inside `payload`. `secrets` is the current key first, then any
 * previous ones still being retired. Throws when no key opens it, when it was
 * sealed for another item, or when the format is unknown.
 */
export function openBankToken(payload: string, secrets: readonly string[], itemId: string): string {
  const parts = payload.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, keyId, iv, tag, data] = parts;
    const secret = secrets.find((candidate) => keyIdOf(candidate) === keyId);
    if (!secret) throw new Error(`The bank token was sealed with a key OneBook no longer holds (${keyId})`);
    try {
      return open(secret, iv, tag, data, associatedData(itemId));
    } catch {
      throw new Error("The bank token does not open for this connection");
    }
  }
  if (parts[0] === "v1" && parts.length === 4) {
    // v1 named no key, so each one held is tried.
    const [, iv, tag, data] = parts;
    for (const secret of secrets) {
      try {
        return open(secret, iv, tag, data, null);
      } catch {
        // Not this key; try the next.
      }
    }
    throw new Error("No key OneBook holds opens this bank token");
  }
  throw new Error("Bank token payload is invalid or uses an unsupported version");
}

/** Whether `payload` should be sealed again: an old format, or a key other than the current one. */
export function needsReseal(payload: string, currentSecret: string): boolean {
  const parts = payload.split(".");
  return !(parts[0] === "v2" && parts.length === 5 && parts[1] === keyIdOf(currentSecret));
}
