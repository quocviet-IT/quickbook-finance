import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keyIdOf, needsReseal, openBankToken, sealBankToken } from "@/lib/domain/bank-token-seal";

const CURRENT = "current-key-for-tests-0123456789abcdef";
const PREVIOUS = "previous-key-for-tests-0123456789abcdef";
const TOKEN = "access-sandbox-00000000-0000-0000-0000-000000000000";

/** A token as OneBook sealed it until 2.96: one key, no key name, nothing bound. */
function sealV1(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret, "utf8").digest(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

describe("sealBankToken / openBankToken", () => {
  it("seals in v2, naming the key and not showing it, and opens again for the same item", () => {
    const sealed = sealBankToken(TOKEN, CURRENT, "item-1");
    const [version, keyId] = sealed.split(".");
    expect(version).toBe("v2");
    expect(keyId).toBe(keyIdOf(CURRENT));
    expect(keyId).toMatch(/^[0-9a-f]{8}$/);
    expect(sealed).not.toContain(CURRENT);
    expect(sealed).not.toContain(TOKEN);
    expect(openBankToken(sealed, [CURRENT], "item-1")).toBe(TOKEN);
  });

  it("does not open a token copied onto another connection's row", () => {
    const sealed = sealBankToken(TOKEN, CURRENT, "item-1");
    expect(() => openBankToken(sealed, [CURRENT], "item-2")).toThrow("does not open for this connection");
  });

  it("opens with a previous key while a rotation is under way, and says when the key is gone", () => {
    const sealed = sealBankToken(TOKEN, PREVIOUS, "item-1");
    expect(openBankToken(sealed, [CURRENT, PREVIOUS], "item-1")).toBe(TOKEN);
    expect(() => openBankToken(sealed, [CURRENT], "item-1")).toThrow(`no longer holds (${keyIdOf(PREVIOUS)})`);
  });

  it("still opens a v1 token, with whichever key held sealed it", () => {
    expect(openBankToken(sealV1(TOKEN, CURRENT), [CURRENT], "item-1")).toBe(TOKEN);
    expect(openBankToken(sealV1(TOKEN, PREVIOUS), [CURRENT, PREVIOUS], "item-1")).toBe(TOKEN);
    expect(() => openBankToken(sealV1(TOKEN, PREVIOUS), [CURRENT], "item-1")).toThrow("No key OneBook holds");
  });

  it("refuses a payload it does not know, or one that was tampered with", () => {
    expect(() => openBankToken("v3.a.b.c.d", [CURRENT], "item-1")).toThrow("unsupported version");
    expect(() => openBankToken("garbage", [CURRENT], "item-1")).toThrow("unsupported version");
    const parts = sealBankToken(TOKEN, CURRENT, "item-1").split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => openBankToken(parts.join("."), [CURRENT], "item-1")).toThrow("does not open");
  });

  it("will not seal without the item it belongs to", () => {
    expect(() => sealBankToken(TOKEN, CURRENT, "")).toThrow("item id is missing");
  });

  it("draws a fresh nonce every time", () => {
    expect(sealBankToken(TOKEN, CURRENT, "item-1")).not.toBe(sealBankToken(TOKEN, CURRENT, "item-1"));
  });
});

describe("needsReseal", () => {
  it("is true for v1 and for v2 under another key, false for v2 under the current key", () => {
    expect(needsReseal(sealV1(TOKEN, CURRENT), CURRENT)).toBe(true);
    expect(needsReseal(sealBankToken(TOKEN, PREVIOUS, "item-1"), CURRENT)).toBe(true);
    expect(needsReseal(sealBankToken(TOKEN, CURRENT, "item-1"), CURRENT)).toBe(false);
  });
});
