import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { ping, scanBuffer, version } from "./clamd.mjs";

/**
 * The malware-scanner gateway One Book expects.
 *
 * One Book will not accept an uploaded file until `DOCUMENT_SCANNER_URL` and
 * `DOCUMENT_SCANNER_TOKEN` are set — the upload control is disabled, the server
 * action refuses, and the nightly job returns 503. This is the service those two
 * variables point at.
 *
 * ## The contract, exactly
 *
 * Request  POST <any path>
 *          authorization:      Bearer <token>
 *          content-type:       the file's MIME type
 *          x-document-name:    encodeURIComponent(file name)   — not required
 *          x-document-sha256:  hex digest of the body          — not required
 *          body:               the raw file bytes
 *
 * Response 200 {"verdict":"clean","engine":"ClamAV 1.x/27000/..."}
 *          200 {"verdict":"blocked","engine":"...","threat":"Eicar-Signature"}
 *          401 / 413 / 415 / 400 / 503 with {"error":"..."}
 *
 * A blocked verdict **must** carry a threat name; One Book's own schema rejects
 * the response otherwise and records the scan as an error.
 *
 * ## The rule that matters more than any of the above
 *
 * **Nothing here may answer "clean" unless clamd said so.** An unreachable
 * daemon, a timeout, a reply this code does not recognise — every one of them
 * is a 503, which One Book records as `scan_status = 'error'` and retries up to
 * five times. A scanner that fails open is worse than no scanner, because the
 * screen then says the file was checked.
 *
 * ## What is deliberately not logged
 *
 * Not the file name, and not the body. These are a customer's accounting
 * records; a container log is not the place for "Invoice from Aurora Fine
 * Jewelry.pdf". The digest prefix, the size and the verdict are enough to trace
 * a scan back to a row in `acc_document_attachment`.
 */

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = (process.env.SCANNER_TOKEN ?? "").trim();
const CLAMD = {
  host: process.env.CLAMD_HOST ?? "clamav",
  port: Number(process.env.CLAMD_PORT ?? 3310),
  timeoutMs: Number(process.env.CLAMD_TIMEOUT_MS ?? 55_000),
};
/** One Book's own ceiling is 10 MB, enforced in four places. This is the fifth. */
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 10 * 1024 * 1024);

// The same floor One Book applies before it will treat the scanner as
// configured. Refusing to start is better than running with a guessable token.
if (TOKEN.length < 24) {
  console.error("SCANNER_TOKEN must be at least 24 characters. Refusing to start.");
  process.exit(1);
}

/** Cached because it costs a round trip and changes only when clamd restarts. */
let engineCache = { value: null, at: 0 };
const ENGINE_TTL_MS = 10 * 60 * 1000;

async function engineName() {
  if (engineCache.value && Date.now() - engineCache.at < ENGINE_TTL_MS) return engineCache.value;
  try {
    const value = await version(CLAMD);
    engineCache = { value, at: Date.now() };
    return value;
  } catch {
    // Not fatal: the verdict is what matters, and One Book has its own fallback
    // string. Never let a missing version number fail a scan.
    return "ClamAV";
  }
}

function authorized(header) {
  const presented = /^Bearer\s+(.+)$/i.exec(header ?? "")?.[1]?.trim() ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(TOKEN);
  // timingSafeEqual throws on a length mismatch, so compare lengths first — and
  // still run the comparison, so the work does not depend on the guess.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * Read the body, refusing anything over the ceiling without buffering it all.
 *
 * The declared length is checked first so an oversized upload is refused before
 * a byte of it is read. The streaming guard behind it is the backstop for a
 * chunked request that declares nothing — and it stops *reading* rather than
 * destroying the socket, because a socket destroyed mid-upload gives the caller
 * a connection reset instead of the 413 that would have told it why.
 */
function readBody(req) {
  const tooLarge = () =>
    Object.assign(new Error("Body larger than the ceiling"), { status: 413 });

  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return Promise.reject(tooLarge());
  }

  return new Promise((resolve, reject) => {
    const parts = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        req.pause();
        reject(tooLarge());
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    try {
      const alive = await ping(CLAMD);
      return send(res, alive ? 200 : 503, { ok: alive, engine: await engineName() });
    } catch (error) {
      return send(res, 503, { ok: false, error: String(error.message).slice(0, 200) });
    }
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Send the file bytes with POST." });
  }
  if (!authorized(req.headers.authorization)) {
    return send(res, 401, { error: "Unauthorized." });
  }

  let bytes;
  try {
    bytes = await readBody(req);
  } catch (error) {
    return send(res, error.status ?? 400, {
      error: error.status === 413 ? `Files must be ${MAX_BYTES} bytes or fewer.` : "Unreadable body.",
    });
  }
  if (bytes.length === 0) {
    return send(res, 400, { error: "Empty body." });
  }

  // If the caller told us what it sent, hold it to that. A mismatch means the
  // bytes changed between One Book's own verification and here, which is a
  // transport fault rather than a virus — so it is a 400 that One Book records
  // as an error and retries, not a block that would need explaining to a user.
  const claimed = String(req.headers["x-document-sha256"] ?? "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(claimed)) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== claimed) {
      console.warn(`sha256 mismatch: claimed ${claimed.slice(0, 12)}, received ${actual.slice(0, 12)}`);
      return send(res, 400, { error: "The body does not match x-document-sha256." });
    }
  }

  try {
    const result = await scanBuffer(bytes, CLAMD);
    const engine = await engineName();
    console.log(
      `scanned sha256=${createHash("sha256").update(bytes).digest("hex").slice(0, 12)} ` +
        `bytes=${bytes.length} verdict=${result.verdict}` +
        (result.threat ? ` threat=${result.threat}` : ""),
    );
    return send(
      res,
      200,
      result.verdict === "blocked"
        ? { verdict: "blocked", engine, threat: result.threat }
        : { verdict: "clean", engine },
    );
  } catch (error) {
    // The fail-closed path. One Book turns this into scan_status='error' and
    // tries again; the file stays unreadable in the meantime.
    console.error(`scan failed: ${error.message}`);
    return send(res, 503, { error: "The scanner could not complete this scan." });
  }
});

server.headersTimeout = 65_000;
server.requestTimeout = 65_000;

server.listen(PORT, () => {
  console.log(`document scanner listening on ${PORT}, clamd at ${CLAMD.host}:${CLAMD.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
