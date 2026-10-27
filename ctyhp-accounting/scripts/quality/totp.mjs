/**
 * Time-based one-time codes (RFC 6238: SHA-1, six digits, thirty seconds), as
 * an authenticator app computes them. For checks that sign in as an account
 * with two-step sign-in (2.65): the account's key comes from the environment,
 * never from the repository.
 */
import { createHmac } from "node:crypto";

function fromBase32(key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of key.replace(/[\s=]/g, "").toUpperCase()) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error("The two-step key is not base32");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code for `key` at `at` (milliseconds). */
export function totp(key, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hash = createHmac("sha1", fromBase32(key)).update(counter).digest();
  const offset = hash[hash.length - 1] & 0xf;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** A code with at least `margin` seconds left in its window, waiting for the next one if not. */
export async function freshCode(key, margin = 6) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < margin) await new Promise((resolve) => setTimeout(resolve, (left + 1) * 1000));
  return totp(key);
}
