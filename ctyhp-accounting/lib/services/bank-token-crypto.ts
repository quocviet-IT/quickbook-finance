import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.BANK_FEED_ENCRYPTION_KEY?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("BANK_FEED_ENCRYPTION_KEY must be configured with at least 32 characters");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function bankFeedEncryptionConfigured(): boolean {
  return (process.env.BANK_FEED_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function encryptBankToken(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBankToken(payload: string): string {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Bank token payload is invalid or uses an unsupported version");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
