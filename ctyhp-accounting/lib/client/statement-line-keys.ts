/**
 * The duplicate keys of a statement's lines, hashed in the browser (2.04): the
 * same SHA-256 of the same text the import hashes on the server
 * (statementLineHash), so the dialog can say which lines are already in Bank
 * Transactions without sending the lines anywhere. Worked out once per
 * statement read, for every occurrence a line can be sent as; each Not a
 * transaction tick then only looks them up (keysAsSentFrom).
 *
 * Web Crypto, as keeping a statement file already uses (lib/client/documents.ts).
 */
import { lineKeyTexts, type LineKeyTable } from "@/lib/domain/statement-line-keys";
import type { RepeatLine } from "@/lib/domain/statement-repeats";

/** Said when the browser offers no Web Crypto: it does only on a secure (https) page. */
export const NO_WEB_CRYPTO = "this browser cannot work out the lines’ keys outside a secure (https) page";

/** SHA-256 of a text's UTF-8 bytes, in lowercase hex: what node:crypto's createHash("sha256").update(text).digest("hex") gives. */
async function sha256Hex(subtle: SubtleCrypto, text: string): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Every key the lines of one statement can be sent with, by set of identical lines. */
export async function statementLineKeyTable(bankAccountId: string, lines: readonly RepeatLine[]): Promise<LineKeyTable> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error(NO_WEB_CRYPTO);
  const sets = await Promise.all(
    lineKeyTexts(bankAccountId, lines).map(
      async ({ key, texts }) => [key, await Promise.all(texts.map((text) => sha256Hex(subtle, text)))] as const,
    ),
  );
  return new Map(sets);
}
