import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EICAR, startFakeClamd } from "./fake-clamd.mjs";

/**
 * The gateway, held to One Book's contract.
 *
 * Run: node test/contract.test.mjs
 *
 * What this proves: the HTTP contract in both directions, the token check, the
 * ceilings, and — the reason it exists — that **every failure answers 503 and
 * never "clean"**. A scanner that fails open is worse than no scanner, because
 * the screen then says the file was checked.
 *
 * What it does not prove: that ClamAV itself behaves as clamd(8) documents. The
 * fake speaks the documented protocol, which is the half this repository owns.
 * `npm run smoke:eicar` against a real deployment closes the other half, and the
 * README says so.
 */

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = "a-token-that-is-certainly-long-enough";

let passed = 0;
let failed = 0;

async function check(label, body) {
  try {
    await body();
    passed += 1;
    console.log(`  PASS  ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${label} — ${error.message.split("\n")[0]}`);
  }
}

async function startGateway(env) {
  const child = spawn(process.execPath, [join(here, "..", "server.mjs")], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = [];
  child.stdout.on("data", (d) => lines.push(String(d)));
  child.stderr.on("data", (d) => lines.push(String(d)));
  for (let i = 0; i < 100; i += 1) {
    if (lines.join("").includes("listening")) return { child, lines };
    if (child.exitCode !== null) throw new Error(`gateway exited: ${lines.join("")}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill();
  throw new Error(`gateway did not start: ${lines.join("")}`);
}

function post(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/scan`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/pdf",
      ...headers,
    },
    body,
  });
}

const PORT = 8791;

async function withStack(behaviour, body) {
  const clam = await startFakeClamd({ behaviour });
  const gateway = await startGateway({
    PORT: String(PORT),
    SCANNER_TOKEN: TOKEN,
    CLAMD_HOST: "127.0.0.1",
    CLAMD_PORT: String(clam.port),
    CLAMD_TIMEOUT_MS: "3000",
  });
  try {
    await body(PORT, gateway);
  } finally {
    gateway.child.kill();
    await once(gateway.child, "exit").catch(() => {});
    clam.server.close();
  }
}

console.log("\n== the verdicts One Book understands");
await withStack("normal", async (port) => {
  await check("a harmless file comes back clean, with an engine string", async () => {
    const res = await post(port, Buffer.from("%PDF-1.7 a perfectly ordinary invoice"));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.verdict, "clean");
    assert.match(json.engine, /^ClamAV /);
  });

  await check("EICAR comes back blocked, and names the signature", async () => {
    const res = await post(port, Buffer.from(EICAR, "latin1"));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.verdict, "blocked");
    // One Book's own schema refuses a blocked verdict with no threat name.
    assert.equal(json.threat, "Eicar-Signature");
  });

  await check("a signature is found even when it is split across chunks", async () => {
    // 64KB chunks: this puts EICAR either side of a boundary, which is exactly
    // where a hand-written length-prefixed stream goes wrong.
    const padding = Buffer.alloc(64 * 1024 - 20, 0x41);
    const res = await post(port, Buffer.concat([padding, Buffer.from(EICAR, "latin1")]));
    assert.equal((await res.json()).verdict, "blocked");
  });

  await check("a file at the ceiling is still scanned", async () => {
    const res = await post(port, Buffer.alloc(10 * 1024 * 1024, 0x42));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).verdict, "clean");
  });
});

console.log("\n== the token");
await withStack("normal", async (port) => {
  await check("no header is refused", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/scan`, {
      method: "POST",
      body: Buffer.from("x"),
    });
    assert.equal(res.status, 401);
  });
  await check("a wrong token is refused", async () => {
    const res = await post(port, Buffer.from("x"), { authorization: "Bearer nope" });
    assert.equal(res.status, 401);
  });
  await check("a token of the right length but wrong content is refused", async () => {
    const res = await post(port, Buffer.from("x"), {
      authorization: `Bearer ${"b".repeat(TOKEN.length)}`,
    });
    assert.equal(res.status, 401);
  });
  await check("GET is refused", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/scan`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 405);
  });
});

console.log("\n== the ceilings and the integrity header");
await withStack("normal", async (port) => {
  await check("a file over the ceiling is refused, not scanned", async () => {
    const res = await post(port, Buffer.alloc(10 * 1024 * 1024 + 1, 0x43));
    assert.equal(res.status, 413);
  });
  await check("an empty body is refused", async () => {
    const res = await post(port, Buffer.alloc(0));
    assert.equal(res.status, 400);
  });
  await check("a matching sha256 header passes through", async () => {
    const bytes = Buffer.from("the same bytes on both sides");
    const res = await post(port, bytes, {
      "x-document-sha256": createHash("sha256").update(bytes).digest("hex"),
    });
    assert.equal((await res.json()).verdict, "clean");
  });
  await check("a mismatched sha256 header is a 400, not a block", async () => {
    // Bytes that changed in transit are a transport fault. Blocking would put a
    // threat name on a file that has none and ask somebody to explain it.
    const res = await post(port, Buffer.from("these bytes"), {
      "x-document-sha256": "0".repeat(64),
    });
    assert.equal(res.status, 400);
  });
});

console.log("\n== fail closed — the rule the whole service exists for");
for (const [behaviour, label] of [
  ["daemon-error", "clamd reporting its own error"],
  ["truncated", "clamd hanging up mid-conversation"],
  ["gibberish", "a reply the client does not recognise"],
]) {
  await withStack(behaviour, async (port) => {
    await check(`${label} answers 503, never clean`, async () => {
      const res = await post(port, Buffer.from("%PDF-1.7 ordinary"));
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.verdict, undefined);
    });
  });
}

await check("an unreachable daemon answers 503, never clean", async () => {
  const gateway = await startGateway({
    PORT: String(PORT + 1),
    SCANNER_TOKEN: TOKEN,
    CLAMD_HOST: "127.0.0.1",
    CLAMD_PORT: "1", // nothing listens here
    CLAMD_TIMEOUT_MS: "1000",
  });
  try {
    const res = await post(PORT + 1, Buffer.from("%PDF-1.7 ordinary"));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).verdict, undefined);
  } finally {
    gateway.child.kill();
    await once(gateway.child, "exit").catch(() => {});
  }
});

console.log("\n== it refuses to run with a weak token");
await check("a short token stops the process rather than starting insecure", async () => {
  const child = spawn(process.execPath, [join(here, "..", "server.mjs")], {
    env: { ...process.env, PORT: String(PORT + 2), SCANNER_TOKEN: "short" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
