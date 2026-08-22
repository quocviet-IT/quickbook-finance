/**
 * Prove a deployed scanner works, against the real thing.
 *
 * Run it after deploying, before pointing One Book at the URL:
 *
 *   node smoke.mjs https://scanner.example.com <token>
 *
 * It sends a harmless file and then EICAR — the industry-standard harmless test
 * string every scanner is required to flag. A deployment that returns clean for
 * both is not scanning anything, and is the one failure this catches that the
 * contract tests cannot: they run against a fake that speaks the documented
 * protocol, and this runs against ClamAV with a real signature database.
 */
import { createHash } from "node:crypto";

const [, , base, token] = process.argv;
if (!base || !token) {
  console.error("usage: node smoke.mjs <https://scanner-url> <token>");
  process.exit(2);
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failed += 1;
}

async function scan(bytes) {
  const res = await fetch(base, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/pdf",
      "x-document-name": encodeURIComponent("smoke-test.pdf"),
      "x-document-sha256": createHash("sha256").update(bytes).digest("hex"),
    },
    body: bytes,
    signal: AbortSignal.timeout(90_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log(`Scanning against ${base}\n`);

try {
  const health = await fetch(new URL("/health", base), { signal: AbortSignal.timeout(30_000) });
  const body = await health.json().catch(() => null);
  check("health reports clamd alive", health.status === 200 && body?.ok === true, JSON.stringify(body));
  if (body?.engine) console.log(`        engine: ${body.engine}`);
} catch (error) {
  check("health responds", false, error.message);
}

const clean = await scan(Buffer.from("%PDF-1.7 an ordinary invoice"));
check("a harmless file is clean", clean.status === 200 && clean.body?.verdict === "clean",
  JSON.stringify(clean));

const bad = await scan(Buffer.from(EICAR, "latin1"));
check("EICAR is blocked", bad.status === 200 && bad.body?.verdict === "blocked", JSON.stringify(bad));
check("and the block names a signature", Boolean(bad.body?.threat), JSON.stringify(bad.body));

const unauthorized = await fetch(base, {
  method: "POST",
  headers: { authorization: "Bearer not-the-token", "content-type": "application/pdf" },
  body: Buffer.from("x"),
});
check("a wrong token is refused", unauthorized.status === 401, String(unauthorized.status));

console.log(failed === 0 ? "\nReady. Point DOCUMENT_SCANNER_URL at this." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
