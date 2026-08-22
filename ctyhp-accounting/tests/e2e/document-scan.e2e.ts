import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { scanDocumentAttachment } from "@/lib/services/document-scanner";
import { DOCUMENT_BUCKET } from "@/lib/domain/documents";

/**
 * The scanning pipeline, end to end, against the gateway this repository ships.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config vitest.e2e.config.ts tests/e2e/document-scan.e2e.ts
 *
 * What runs for real: an object is written to the private bucket, an attachment
 * row is created in a **sample company's** books, and One Book's own
 * `scanDocumentAttachment` downloads it, re-verifies its digest, POSTs it to the
 * gateway in `services/document-scanner`, and writes the verdict back through
 * the same RPCs the application uses.
 *
 * What is simulated: ClamAV itself. `test/fake-clamd.mjs` speaks the documented
 * INSTREAM protocol and finds EICAR; a real signature database is proven by
 * `services/document-scanner/smoke.mjs` against a deployment, which is a
 * different question and is documented as one.
 *
 * Safety: everything is written into the company marked `is_sample` and removed
 * afterwards, object and row. Nothing here touches a customer's books — the same
 * rule `capture-guide-shots.mjs` follows, for the same reason.
 */

const here = dirname(fileURLToPath(import.meta.url));
const scannerDir = join(here, "..", "..", "..", "services", "document-scanner");

const TOKEN = "an-end-to-end-token-long-enough-for-the-floor";
const GATEWAY_PORT = 8793;
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

let clamd: { server: { close(): void }; port: number };
let gateway: ChildProcess;
let sb: SupabaseClient;
let schema: string;
let invoiceId: string;
let uploaderId: string;
const created: { id: string; path: string }[] = [];

function serviceClient(forSchema: string): SupabaseClient {
  // The schema is chosen at runtime — a sample company, or the register — so the
  // generic parameter cannot be narrowed the way `createClient` assumes.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: forSchema } },
  ) as unknown as SupabaseClient;
}

async function waitForListening(child: ChildProcess): Promise<void> {
  const seen: string[] = [];
  child.stdout?.on("data", (d) => seen.push(String(d)));
  child.stderr?.on("data", (d) => seen.push(String(d)));
  for (let i = 0; i < 200; i += 1) {
    if (seen.join("").includes("listening")) return;
    if (child.exitCode !== null) throw new Error(`gateway exited: ${seen.join("")}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`gateway did not start: ${seen.join("")}`);
}

beforeAll(async () => {
  const { startFakeClamd } = (await import(
    /* @vite-ignore */ join(scannerDir, "test", "fake-clamd.mjs")
  )) as { startFakeClamd: (o?: { behaviour?: string }) => Promise<typeof clamd> };
  clamd = await startFakeClamd();

  gateway = spawn(process.execPath, [join(scannerDir, "server.mjs")], {
    env: {
      ...process.env,
      PORT: String(GATEWAY_PORT),
      SCANNER_TOKEN: TOKEN,
      CLAMD_HOST: "127.0.0.1",
      CLAMD_PORT: String(clamd.port),
      CLAMD_TIMEOUT_MS: "10000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForListening(gateway);

  // The service reads these at call time, so setting them here is enough.
  process.env.DOCUMENT_SCANNER_URL = `http://127.0.0.1:${GATEWAY_PORT}/scan`;
  process.env.DOCUMENT_SCANNER_TOKEN = TOKEN;

  // A sample company, never a customer's books.
  const register = serviceClient("onebook");
  const { data: companies, error } = await register
    .from("company")
    .select("schema_name,is_sample,status")
    .eq("is_sample", true)
    .eq("status", "active")
    .limit(1);
  if (error) throw new Error(error.message);
  if (!companies?.length) throw new Error("no company marked is_sample to test against");
  schema = companies[0].schema_name as string;

  sb = serviceClient(schema);
  const { data: invoice } = await sb.from("acc_invoice").select("id").limit(1).maybeSingle();
  if (!invoice) throw new Error(`${schema} has no invoice to attach evidence to`);
  invoiceId = invoice.id as string;

  const { data: actor } = await sb
    .from("acc_app_user")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!actor) throw new Error(`${schema} has no active user to record as the uploader`);
  uploaderId = actor.id as string;
});

afterAll(async () => {
  for (const { id, path } of created) {
    await sb.storage.from(DOCUMENT_BUCKET).remove([path]);
    await sb.from("acc_document_attachment").delete().eq("id", id);
  }
  gateway?.kill();
  clamd?.server.close();
});

/** Put real bytes in the private bucket and register them, the way an upload does. */
async function attach(bytes: Buffer, fileName: string): Promise<string> {
  const path = `invoice/${invoiceId}/${randomUUID()}.pdf`;
  const upload = await sb.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error(`upload failed: ${upload.error.message}`);

  const { data, error } = await sb
    .from("acc_document_attachment")
    .insert({
      entity_type: "invoice",
      entity_id: invoiceId,
      file_name: fileName,
      storage_bucket: DOCUMENT_BUCKET,
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      scan_status: "pending",
      uploaded_by: uploaderId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`register failed: ${error.message}`);
  created.push({ id: data.id as string, path });
  return data.id as string;
}

describe("scanning a real attachment through the shipped gateway", () => {
  it("marks an ordinary file clean, and names the engine", async () => {
    const id = await attach(Buffer.from("%PDF-1.7 an ordinary invoice"), "ordinary.pdf");
    const result = await scanDocumentAttachment(sb, id);
    expect(result.scan_status).toBe("clean");
    expect(result.scan_engine).toMatch(/^ClamAV /);
    expect(result.threat_name).toBeNull();
  });

  it("blocks EICAR and records what found it", async () => {
    const id = await attach(Buffer.from(EICAR, "latin1"), "eicar.pdf");
    const result = await scanDocumentAttachment(sb, id);
    expect(result.scan_status).toBe("blocked");
    expect(result.threat_name).toBe("Eicar-Signature");
  });

  it("blocks a file whose stored bytes no longer match what was registered", async () => {
    // The integrity check that runs before the scanner is ever called: if the
    // object in the bucket is not the object the row describes, the row is not
    // evidence of anything and nothing about it should be trusted.
    const id = await attach(Buffer.from("%PDF-1.7 the original"), "swapped.pdf");
    const { path } = created[created.length - 1];
    const swap = await sb.storage
      .from(DOCUMENT_BUCKET)
      .update(path, Buffer.from("%PDF-1.7 something else entirely"), {
        contentType: "application/pdf",
      });
    expect(swap.error).toBeNull();

    const result = await scanDocumentAttachment(sb, id);
    expect(result.scan_status).toBe("blocked");
    expect(result.threat_name).toBe("Stored file integrity mismatch");
    expect(result.scan_engine).toBe("One Book integrity verifier");
  });

  it("records an error rather than a clean verdict when the gateway cannot answer", async () => {
    // The rule the whole design turns on. The file stays unreadable and the
    // nightly job will try again; it does not become clean by failing.
    const id = await attach(Buffer.from("%PDF-1.7 ordinary again"), "unreachable.pdf");
    const url = process.env.DOCUMENT_SCANNER_URL;
    process.env.DOCUMENT_SCANNER_URL = "http://127.0.0.1:1/scan";
    try {
      const result = await scanDocumentAttachment(sb, id);
      expect(result.scan_status).toBe("error");
      expect(result.scan_error).toBeTruthy();
    } finally {
      process.env.DOCUMENT_SCANNER_URL = url;
    }
  });
});
