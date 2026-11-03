# Scanned Statements via the Company OCR Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Import statement is given a scanned PDF, OneBook offers **Read with OCR**. It sends the file to the company's on-premise OCR server through a pull queue, then puts the text through the existing PDF statement reader and the existing proof.

**Architecture:**
- **Queue.** A global queue lives in `onebook` (migration 0188). It holds the job row and a heartbeat, and is reachable only through security-definer functions.
- **Worker.** The worker on the OCR machine calls one route, `/api/ocr/worker`, with a bearer secret. It claims a job, downloads the kept file through a signed URL, OCRs each page with the local vLLM server, and posts the text back.
- **Dialog.** The browser polls a server action for the job. It turns the text into `PdfGlyph[]` on a column grid and reuses `readPdfStatements`, so the existing review, proof and import run unchanged.

**Tech Stack:**
- Next.js 16 (route handlers and server actions), Supabase (PostgREST RPCs in the `onebook` schema), zod 4, vitest and Ant Design 6.
- Python 3 standard library with poppler (`pdftoppm`, `pdfinfo`) on the worker, and vLLM serving Unlimited-OCR (already installed).

Spec: `docs/superpowers/specs/2026-11-03-ocr-scanned-statements-design.md`.

All paths below are relative to `ctyhp-accounting/` unless they start with `docs/`.

## Global Constraints

**Scope and limits**
- Release **3.02**. Migration **0188** (`supabase/migrations/0188_ocr_jobs.sql`, already drafted, not yet applied).
- At most **20 pages** per file. A claim holds a job for **10 minutes**; each progress report extends that. After **3 attempts** the job fails with a reason.
- A company may have at most **3 open jobs**.
- Who may use it: `documents.manage` (checked inside `onebook.request_ocr_job`). The import itself is still checked by `importStatementAction`.

**Worker**
- Secret env var: `OCR_WORKER_SECRET`, at least 24 characters, compared with `timingSafeEqual`. When it is unset, `/api/ocr/worker` answers 404 and the button never shows.
- The worker runs around the clock and makes outbound HTTPS calls only. It polls every **30 s** when idle, and every **5 s** for **15 minutes** after any job.

**Data and privacy**
- No real customer data in the repo. The fixtures are the OCR output of the made-up "Example Bank / Sample Trading LLC" statement only. The OCR machine's address and the secret never go in the repo.
- The UI copy is US English, and the chat with the owner is Vietnamese.
- Commits carry **no Claude attribution** (project rule).
- Stage files one by one, and read `git diff --cached` for real names or figures before every commit (the repo is public).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0188_ocr_jobs.sql` | Queue tables and functions (exists; verified here, applied with approval) |
| `scripts/verify-ocr-queue.mjs` | Runs the whole queue cycle in one transaction that is always rolled back |
| `lib/domain/ocr-statement.ts` | Pure: result schema, OCR text → `PdfGlyph[]`, running-balance breaks, reading states and copy |
| `lib/domain/ocr-worker-auth.ts` | Pure: is this bearer the worker's? |
| `lib/services/ocr-queue.ts` | Server-only: the worker side of the queue (claim + signed URL, progress, complete, fail) |
| `app/api/ocr/worker/route.ts` | The one route the worker calls |
| `app/(app)/banking/ocr-actions.ts` | Server actions: is OCR available, request a job, a job's status |
| `lib/client/read-scanned-statement.ts` | Browser: keep the file, request, poll, parse |
| `app/(app)/banking/PdfStatementPreview.tsx` | Adds `ScannedPdf` and `OcrNotice` |
| `app/(app)/banking/ImportStatementModal.tsx` | A scanned PDF becomes `kind: "scanned"`, then `kind: "pdf"` with `viaOcr` |
| `lib/domain/changelog.ts` | Release 3.02 |
| `ocr-worker/worker.py`, `ocr-worker/onebook-ocr.service`, `ocr-worker/README.md` | The worker and how to install it |
| `tests/fixtures/ocr/*` | OCR output of the made-up statement (clean and poor) and its answers |
| `tests/unit/ocr-statement.test.ts`, `tests/unit/ocr-worker-route.test.ts` | Unit tests |

---

### Task 1: Queue in the database (0188) and its verify script

**Files:**
- Verify: `supabase/migrations/0188_ocr_jobs.sql`
- Create: `scripts/verify-ocr-queue.mjs`
- Modify: `package.json` (script `verify:ocr-queue`)

**Interfaces:**
- Produces the following onebook RPCs.
  - For `authenticated`:
    - `request_ocr_job(p_schema text, p_saved_report_id uuid) → uuid`
    - `ocr_job_status(p_id uuid) → setof (id, status, pages_done, pages_total, result jsonb|null, error, created_at, finished_at)`
    - `ocr_worker_online() → boolean`
  - For `service_role`:
    - `claim_ocr_job(p_worker_version text) → setof (id, schema_name, storage_path, mime_type, attempts)`
    - `report_ocr_progress(p_id, p_pages_done, p_pages_total) → boolean`
    - `complete_ocr_job(p_id, p_result jsonb) → boolean`
    - `fail_ocr_job(p_id, p_error text) → boolean`

- [ ] **Step 1: Install dependencies in the worktree**

Run (from `ctyhp-accounting/`): `npm ci`
Expected: completes; `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Write the verify script**

`scripts/verify-ocr-queue.mjs`:

```js
/**
 * The OCR queue (0188), end to end, inside one transaction that is always
 * rolled back: nothing it does is left behind.
 *
 * Needs SUPABASE_DB_URL (the pooler) and 0188 applied to the database it points at.
 * Run: node --env-file=.env.local scripts/verify-ocr-queue.mjs
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

async function as(user) {
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  await client.query("set local role authenticated");
}
async function asService() {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '', true)");
}

await client.connect();
try {
  await client.query("begin");

  // A member of the first company who may keep statement files.
  const members = await client.query(
    `select m.user_id from onebook.company_member m join onebook.company c on c.id = m.company_id
      where c.schema_name = 'public' order by m.added_at`,
  );
  let user = null;
  for (const { user_id } of members.rows) {
    await as(user_id);
    const { rows } = await client.query("select public.acc_has_permission('documents.manage') as ok");
    await asService();
    if (rows[0].ok) { user = user_id; break; }
  }
  if (!user) throw new Error("No member of the first company holds documents.manage");

  const report = await client.query(
    `insert into public.acc_saved_report (title, source, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by)
     values ('OCR verify', 'bank', 'scan.pdf', 'public/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000, repeat('a', 64), $1)
     returning id`,
    [user],
  );
  const fileId = report.rows[0].id;

  await as(user);
  const first = (await client.query("select onebook.request_ocr_job('public', $1) as id", [fileId])).rows[0].id;
  const again = (await client.query("select onebook.request_ocr_job('public', $1) as id", [fileId])).rows[0].id;
  check("asking twice for one file returns the same job", first === again);
  const waiting = (await client.query("select * from onebook.ocr_job_status($1)", [first])).rows[0];
  check("the asker sees the job waiting", waiting?.status === "pending" && waiting.result === null);
  // A refused statement aborts the transaction; the savepoint takes back only the refusal.
  await client.query("savepoint probe");
  let denied = false;
  try { await client.query("select * from onebook.ocr_job"); } catch { denied = true; }
  await client.query("rollback to savepoint probe");
  check("a session cannot read the queue table", denied);
  await asService();
  const job = first;

  const claimed = (await client.query("select * from onebook.claim_ocr_job('verify')")).rows[0];
  check("the worker claims the waiting job", claimed?.id === job && claimed.attempts === 1);
  check("the claim names the kept file", claimed?.storage_path?.startsWith("public/"));
  const online = (await client.query("select onebook.ocr_worker_online() as ok")).rows[0].ok;
  check("claiming marks the worker online", online === true);
  const none = await client.query("select * from onebook.claim_ocr_job('verify')");
  check("a running job is not handed out twice", none.rows.length === 0);

  const progressed = (await client.query("select onebook.report_ocr_progress($1, 1, 2) as ok", [job])).rows[0].ok;
  check("progress is recorded", progressed === true);
  const done = (await client.query("select onebook.complete_ocr_job($1, $2) as ok", [job, { engine: "verify", pages: [{ page: 1, text: "x" }] }])).rows[0].ok;
  check("the job completes", done === true);

  await as(user);
  const finished = (await client.query("select * from onebook.ocr_job_status($1)", [job])).rows[0];
  check("the asker reads the text once done", finished?.status === "done" && finished.result?.pages?.length === 1);
  await asService();

  // A worker that stops: the lease runs out three times, then the job fails.
  const stuck = (await client.query(
    `insert into onebook.ocr_job (schema_name, saved_report_id, storage_path, mime_type, requested_by, status, attempts, lease_until)
     values ('public', gen_random_uuid(), 'public/x.pdf', 'application/pdf', $1, 'running', 3, now() - interval '1 minute') returning id`,
    [user],
  )).rows[0].id;
  await client.query("select * from onebook.claim_ocr_job('verify')");
  const failed = (await client.query("select status, error from onebook.ocr_job where id = $1", [stuck])).rows[0];
  check("a job whose worker stopped three times fails with a reason", failed.status === "failed" && /three times/.test(failed.error));
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
const failedCount = checks.filter((c) => !c.ok).length;
console.log(failedCount ? `${failedCount} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exit(failedCount ? 1 : 0);
```

Add to `package.json` `scripts`:

```json
"verify:ocr-queue": "node --env-file=.env.local scripts/verify-ocr-queue.mjs",
```

- [ ] **Step 3: Copy `.env.local` into the worktree**

Run: `cp ../../../ctyhp-accounting/.env.local .env.local` (from the worktree's `ctyhp-accounting/`). `.env.local` is gitignored. Confirm with `git check-ignore .env.local`, which should print the path.

- [ ] **Step 4: Apply 0188 (owner approved the migration on 2026-11-03)**

Run: `node --env-file=.env.local scripts/migrate.mjs`
Expected: `0188_ocr_jobs.sql` applied once to `public`, with each company schema showing it as skipped or global, and no errors. If the permission classifier blocks this command, stop and ask the owner to run it.

- [ ] **Step 5: Run the verify script**

Run: `npm run verify:ocr-queue`
Expected: `all 11 checks passed`.

- [ ] **Step 6: Run the provisioning self-check**

Run: `npm run verify:company-provisioning`
Expected: passes. The new tables are in `onebook`, and every 0188 statement is global.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0188_ocr_jobs.sql scripts/verify-ocr-queue.mjs package.json
git diff --cached   # read it: no real names, no figures, no secrets
git commit -m "feat(db): a queue for scanned statements read by the company's OCR server (0188)"
```

---

### Task 2: OCR text into statements (pure)

**Files:**
- Create: `lib/domain/ocr-statement.ts`
- Create: `tests/fixtures/ocr/made-up-statement-clean.md`, `tests/fixtures/ocr/made-up-statement-poor.md` and `tests/fixtures/ocr/made-up-statement.json`
- Test: `tests/unit/ocr-statement.test.ts`

**Interfaces:**
- Consumes: `PdfGlyph`, `PdfStatementLine`, `readPdfStatements` and `statementProof` from `lib/domain/pdf-statement.ts`.
- Produces:
  - `OCR_MAX_PAGES = 20`.
  - `ocrResultSchema` (zod) and `type OcrResult = { engine: string; pages: { page: number; text: string }[] }`.
  - `glyphsFromOcrPages(pages: OcrResult["pages"]): PdfGlyph[]`.
  - `balanceBreaks(lines: readonly PdfStatementLine[], openingMinor: number | null): number[]`, which returns 0-based line indexes.
  - `type ScannedReading`.
  - `OCR_TEXT` (all UI copy).

- [ ] **Step 1: Bring the fixtures from the OCR machine**

These are the model's answers for the made-up statement rendered on 2026-11-02. They contain no real data.

```bash
scp <user>@<ocr-machine>:ocr-test/statement-clean.png.md tests/fixtures/ocr/made-up-statement-clean.md
scp <user>@<ocr-machine>:ocr-test/statement-poor.jpg.md  tests/fixtures/ocr/made-up-statement-poor.md
cp "<scratchpad>/ocr-test-src/ocr-test/truth.json" tests/fixtures/ocr/made-up-statement.json
```

- `<ocr-machine>` is the owner's OCR machine. Ask the owner if SSH by key is not set up, and do not write the address into any file.
- `<scratchpad>` is this session's scratchpad. If it is gone, regenerate the files with `ocr-test-src/make.py`.
- Open each `.md` and confirm it holds `EXAMPLE BANK`, `SAMPLE TRADING LLC` and a `<table>` with 14 transaction rows.

- [ ] **Step 2: Write the failing tests**

`tests/unit/ocr-statement.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  balanceBreaks,
  glyphsFromOcrPages,
  ocrResultSchema,
  OCR_MAX_PAGES,
} from "@/lib/domain/ocr-statement";
import { readPdfStatements, rowsFromGlyphs, statementProof } from "@/lib/domain/pdf-statement";

const dir = join(__dirname, "../fixtures/ocr");
const truth = JSON.parse(readFileSync(join(dir, "made-up-statement.json"), "utf8")) as {
  rows: { date: string; amount: string; kind: "deposit" | "withdrawal"; balance: string }[];
  summary: { beginning: string; ending: string };
};
const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
const page = (file: string) => ({ page: 1, text: readFileSync(join(dir, file), "utf8") });

describe("glyphsFromOcrPages", () => {
  it("lays table cells on a grid wide enough for the column rules", () => {
    const glyphs = glyphsFromOcrPages([
      { page: 1, text: "<table><tr><td>Date</td><td>Description</td><td>Balance</td></tr><tr><td>10/02/2026</td><td>FEE</td><td>1.00</td></tr></table>" },
    ]);
    const rows = rowsFromGlyphs(glyphs);
    expect(rows.map((r) => r.text)).toEqual(["Date Description Balance", "10/02/2026 FEE 1.00"]);
    const xs = rows[0].cells.map((c) => c.x);
    expect(xs[1] - xs[0]).toBeGreaterThan(140);
  });

  it("drops the layout tags and keeps the words", () => {
    const glyphs = glyphsFromOcrPages([{ page: 1, text: "<|ref|>title<|/ref|><|det|>[[1,2,3,4]]<|/det|>EXAMPLE BANK\n<|det|>text [5,6,7,8]<|/det|>Page 1 of 1" }]);
    expect(rowsFromGlyphs(glyphs).map((r) => r.text)).toEqual(["EXAMPLE BANK", "Page 1 of 1"]);
  });

  it("keeps a colspan in its columns and decodes entities", () => {
    const glyphs = glyphsFromOcrPages([{ page: 1, text: '<table><tr><td colspan="2">A &amp; B</td><td>C</td></tr></table>' }]);
    const [row] = rowsFromGlyphs(glyphs);
    expect(row.text).toBe("A & B C");
    expect(row.cells[1].x - row.cells[0].x).toBeGreaterThan(290);
  });

  it("orders pages one after another", () => {
    const glyphs = glyphsFromOcrPages([{ page: 2, text: "second" }, { page: 1, text: "first" }]);
    expect(rowsFromGlyphs(glyphs).map((r) => r.text)).toEqual(["first", "second"]);
  });
});

describe.each(["made-up-statement-clean.md", "made-up-statement-poor.md"])("the made-up statement read by OCR (%s)", (file) => {
  const statements = readPdfStatements(glyphsFromOcrPages([page(file)]));
  const s = statements.find((x) => x.lines.length) ?? null;

  it("is read as one statement with every line", () => {
    expect(s).not.toBeNull();
    expect(s!.lines).toHaveLength(14);
  });

  it("reads every amount the right way round and every balance", () => {
    expect(s!.lines.map((l) => l.amountMinor)).toEqual(
      truth.rows.map((r) => (r.kind === "deposit" ? 1 : -1) * cents(r.amount)),
    );
    expect(s!.lines.map((l) => l.balanceMinor)).toEqual(truth.rows.map((r) => cents(r.balance)));
  });

  it("adds up: opening plus the lines is the closing balance", () => {
    expect(s!.openingMinor).toBe(cents(truth.summary.beginning));
    expect(s!.closingMinor).toBe(cents(truth.summary.ending));
    expect(statementProof(s!).differenceMinor).toBe(0);
    expect(balanceBreaks(s!.lines, s!.openingMinor)).toEqual([]);
  });
});

describe("balanceBreaks", () => {
  const line = (amountMinor: number, balanceMinor: number | null) =>
    ({ date: "2026-10-01", description: "x", checkNumber: null, amountMinor, balanceMinor, raw: "x" });

  it("names the line whose balance does not follow from the one before", () => {
    expect(balanceBreaks([line(100, 1100), line(-50, 1080), line(10, 1090)], 1000)).toEqual([1]);
  });

  it("checks the first line against the opening, and skips lines with no balance", () => {
    expect(balanceBreaks([line(100, 1200), line(5, null), line(5, 1210)], 1000)).toEqual([0]);
  });
});

describe("ocrResultSchema", () => {
  it("accepts the worker's answer and refuses too many pages", () => {
    expect(ocrResultSchema.safeParse({ engine: "e", pages: [{ page: 1, text: "t" }] }).success).toBe(true);
    const many = Array.from({ length: OCR_MAX_PAGES + 1 }, (_, i) => ({ page: i + 1, text: "t" }));
    expect(ocrResultSchema.safeParse({ engine: "e", pages: many }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/unit/ocr-statement.test.ts`
Expected: FAIL with "Cannot find module '@/lib/domain/ocr-statement'".

- [ ] **Step 4: Implement**

`lib/domain/ocr-statement.ts`:

```ts
/**
 * A scanned statement, read by the company's own OCR server (3.02).
 *
 * The model answers each page with its words, its tables as HTML, and layout
 * tags (a label and a box) around each block. Here that answer becomes the
 * positioned text the PDF reader already understands: every table cell on a
 * column grid, one row per table row, every other line on its own row. The
 * statement is then read by readPdfStatements, by the same rules as a PDF
 * that has text, and proved the same way.
 *
 * Pure: no network, no React.
 */
import { z } from "zod";
import type { PdfGlyph, PdfStatementLine } from "./pdf-statement";

export const OCR_MAX_PAGES = 20;

export const ocrResultSchema = z.object({
  engine: z.string().min(1).max(100),
  pages: z
    .array(z.object({ page: z.number().int().min(1).max(OCR_MAX_PAGES), text: z.string().max(200_000) }))
    .min(1)
    .max(OCR_MAX_PAGES),
});
export type OcrResult = z.infer<typeof ocrResultSchema>;

/**
 * The reader puts a figure under the heading within 70 units of it, so columns
 * sit 150 apart: never within reach of the next. Rows sit 12 apart, and the
 * reader joins glyphs within 3 into one line.
 */
const COLUMN_GAP = 150;
const ROW_GAP = 12;
const PAGE_TOP = 100_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function clean(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** The model's layout tags: a block's label and its box. The words follow them. */
function withoutLayout(text: string): string {
  return text.replace(/<\|ref\|>[\s\S]*?<\|\/ref\|>/g, "").replace(/<\|det\|>[\s\S]*?<\|\/det\|>/g, "\n");
}

type Line = { x: number; text: string }[];

function tableLines(table: string): Line[] {
  const lines: Line[] = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: Line = [];
    let column = 0;
    for (const cell of row[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const span = Number(/colspan\s*=\s*"?(\d+)/i.exec(cell[1])?.[1] ?? 1);
      const text = clean(cell[2]);
      if (text) cells.push({ x: COLUMN_GAP * (column + 1), text });
      column += Math.max(1, span);
    }
    if (cells.length) lines.push(cells);
  }
  return lines;
}

function textLines(text: string): Line[] {
  return text
    .split(/\n/)
    .map((l) => clean(l))
    .filter(Boolean)
    .map((t) => [{ x: 0, text: t }]);
}

/** Every page's answer as positioned text, pages in order, top to bottom. */
export function glyphsFromOcrPages(pages: OcrResult["pages"]): PdfGlyph[] {
  const glyphs: PdfGlyph[] = [];
  for (const { page, text } of [...pages].sort((a, b) => a.page - b.page)) {
    const lines: Line[] = [];
    const body = withoutLayout(text);
    let at = 0;
    for (const table of body.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)) {
      const start = table.index ?? at;
      lines.push(...textLines(body.slice(at, start)));
      lines.push(...tableLines(table[0]));
      at = start + table[0].length;
    }
    lines.push(...textLines(body.slice(at)));
    lines.forEach((cells, i) => {
      for (const c of cells) glyphs.push({ page, x: c.x, y: PAGE_TOP - i * ROW_GAP, text: c.text });
    });
  }
  return glyphs;
}

/**
 * The lines whose printed balance does not follow from the one before (the
 * opening, for the first). A misread digit shows here on its own row, where
 * the proof only says the total is out.
 */
export function balanceBreaks(lines: readonly PdfStatementLine[], openingMinor: number | null): number[] {
  const breaks: number[] = [];
  let previous = openingMinor;
  lines.forEach((l, i) => {
    if (l.balanceMinor === null) {
      previous = null;
      return;
    }
    if (previous !== null && previous + l.amountMinor !== l.balanceMinor) breaks.push(i);
    previous = l.balanceMinor;
  });
  return breaks;
}

/** Where reading a scanned statement stands, as the dialog shows it. */
export type ScannedReading =
  | { phase: "offline" }
  | { phase: "ready" }
  | { phase: "sending" }
  | { phase: "waiting" }
  | { phase: "reading"; pagesDone: number; pagesTotal: number | null }
  | { phase: "failed"; message: string };

export const OCR_TEXT = {
  title: "This PDF is a scanned image",
  ready:
    "OneBook can read it with your company's own OCR server. The file is sent to that server, never to an outside service, and the lines come back here to be checked before anything is imported.",
  offline:
    "Your company's OCR server is not answering, so a scanned statement cannot be read now. Try again later, or download the statement from online banking as a PDF, or as CSV, OFX or QFX.",
  button: "Read with OCR",
  sending: "Sending the file to the OCR server…",
  waiting: "Waiting for the OCR server to start…",
  reading: (done: number, total: number | null) =>
    total ? `Reading page ${Math.min(done + 1, total)} of ${total}…` : "Reading…",
  banner: "Read by OCR from a scanned image. Check the lines against the statement before importing.",
  breaks: (rows: readonly number[]) =>
    rows.length > 5
      ? "The running balances do not follow from line to line in several places. Check the lines against the statement."
      : `The balance on line ${rows.map((r) => r + 1).join(", ")} does not follow from the line before. Check ${rows.length === 1 ? "it" : "them"} against the statement.`,
  timedOut: "The OCR server took too long. Try again, or download the statement from online banking.",
} as const;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/ocr-statement.test.ts`
Expected: PASS, with 4 + 2×3 + 2 + 1 = 13 tests.

If a fixture test fails, print `rowsFromGlyphs(glyphsFromOcrPages([page(file)])).map(r => r.text)` in a scratch test and compare it with how `headerShape` and `nearestCol` read the heading row. The likely causes are a heading split over two OCR rows, or a summary table read as a transaction table. Fix it in `glyphsFromOcrPages`, not in `pdf-statement.ts`, unless a rule there is wrong for text PDFs too.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/ocr-statement.ts tests/unit/ocr-statement.test.ts tests/fixtures/ocr/made-up-statement-clean.md tests/fixtures/ocr/made-up-statement-poor.md tests/fixtures/ocr/made-up-statement.json
git diff --cached   # made-up statement only
git commit -m "feat(banking): read a scanned statement's OCR text with the PDF statement reader"
```

---

### Task 3: The worker's route

**Files:**
- Create: `lib/domain/ocr-worker-auth.ts`
- Create: `lib/services/ocr-queue.ts`
- Create: `app/api/ocr/worker/route.ts`
- Test: `tests/unit/ocr-worker-route.test.ts`

**Interfaces:**
- Consumes: `ocrResultSchema`, `OCR_MAX_PAGES` and `OcrResult` (Task 2), and the service-role RPCs (Task 1).
- Produces:
  - `workerAccess(authorization: string | null, configured: string | undefined): "ok" | "unauthorized" | "disabled"`.
  - `claimOcrJob(version) → { id, downloadUrl, mimeType, attempts } | null`.
  - `reportOcrProgress(id, done, total)`, `completeOcrJob(id, result)` and `failOcrJob(id, error)`, each returning `Promise<boolean>`.
  - `POST /api/ocr/worker`, with a body of `{ action: "claim", version }`, `{ action: "progress", id, pagesDone, pagesTotal }`, `{ action: "complete", id, result }` or `{ action: "fail", id, error }`.
  - Responses: 200 JSON, or 204 when there is nothing to claim. 400 for a bad body, 401 for a wrong secret, 404 when the secret is unset, and 500 on a queue error.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ocr-worker-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/services/ocr-queue", () => ({
  claimOcrJob: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", downloadUrl: "https://x/y", mimeType: "application/pdf", attempts: 1 })),
  reportOcrProgress: vi.fn(async () => true),
  completeOcrJob: vi.fn(async () => true),
  failOcrJob: vi.fn(async () => true),
}));

import { POST } from "@/app/api/ocr/worker/route";
import { workerAccess } from "@/lib/domain/ocr-worker-auth";
import { claimOcrJob, completeOcrJob } from "@/lib/services/ocr-queue";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request("https://onebook.test/api/ocr/worker", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }));

describe("workerAccess", () => {
  it("is disabled without a secret of at least 24 characters", () => {
    expect(workerAccess(`Bearer ${SECRET}`, undefined)).toBe("disabled");
    expect(workerAccess("Bearer short", "short")).toBe("disabled");
  });
  it("accepts only the exact secret", () => {
    expect(workerAccess(`Bearer ${SECRET}`, SECRET)).toBe("ok");
    expect(workerAccess(`Bearer ${SECRET}x`, SECRET)).toBe("unauthorized");
    expect(workerAccess(null, SECRET)).toBe("unauthorized");
  });
});

describe("POST /api/ocr/worker", () => {
  beforeEach(() => { process.env.OCR_WORKER_SECRET = SECRET; });
  afterEach(() => { delete process.env.OCR_WORKER_SECRET; vi.clearAllMocks(); });

  it("answers 404 when OCR is not set up", async () => {
    delete process.env.OCR_WORKER_SECRET;
    expect((await post({ action: "claim", version: "v" })).status).toBe(404);
  });

  it("answers 401 to a wrong secret and touches nothing", async () => {
    expect((await post({ action: "claim", version: "v" }, "Bearer nope")).status).toBe(401);
    expect(claimOcrJob).not.toHaveBeenCalled();
  });

  it("hands out a job, or 204 when there is none", async () => {
    const res = await post({ action: "claim", version: "v1" });
    expect(res.status).toBe(200);
    expect((await res.json()).job.id).toBe(ID);
    vi.mocked(claimOcrJob).mockResolvedValueOnce(null);
    expect((await post({ action: "claim", version: "v1" })).status).toBe(204);
  });

  it("refuses a result with more than 20 pages", async () => {
    const pages = Array.from({ length: 21 }, (_, i) => ({ page: i + 1, text: "t" }));
    expect((await post({ action: "complete", id: ID, result: { engine: "e", pages } })).status).toBe(400);
    expect(completeOcrJob).not.toHaveBeenCalled();
  });

  it("stores a valid result", async () => {
    const res = await post({ action: "complete", id: ID, result: { engine: "e", pages: [{ page: 1, text: "t" }] } });
    expect(res.status).toBe(200);
    expect(completeOcrJob).toHaveBeenCalledWith(ID, { engine: "e", pages: [{ page: 1, text: "t" }] });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/unit/ocr-worker-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/ocr/worker/route'".

- [ ] **Step 3: Implement the auth helper**

`lib/domain/ocr-worker-auth.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request comes from the company's OCR server: the bearer must be
 * OCR_WORKER_SECRET exactly, compared in constant time as CRON_SECRET is. With
 * no secret of at least 24 characters configured, OCR is not set up at all.
 */
export function workerAccess(authorization: string | null, configured: string | undefined): "ok" | "unauthorized" | "disabled" {
  const secret = configured?.trim() ?? "";
  if (secret.length < 24) return "disabled";
  const supplied = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (supplied.length !== secret.length) return "unauthorized";
  return timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) ? "ok" : "unauthorized";
}
```

- [ ] **Step 4: Implement the queue service**

`lib/services/ocr-queue.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import type { OcrResult } from "@/lib/domain/ocr-statement";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";

/** Long enough to download a 10 MB file over a slow office line, short enough to be useless if it leaks. */
const DOWNLOAD_SECONDS = 600;

export interface ClaimedOcrJob {
  id: string;
  downloadUrl: string;
  mimeType: string;
  attempts: number;
}

/** The worker's side of the queue (0188) is the service role on the onebook schema; its functions refuse anyone else. */
function queue(): SupabaseClient {
  return createSupabaseAutomationClient("onebook");
}

async function flag(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data === true;
}

export async function claimOcrJob(
  version: string,
  sb: SupabaseClient = queue(),
  storage: SupabaseClient = createSavedReportStorageClient(),
): Promise<ClaimedOcrJob | null> {
  const { data, error } = await sb.rpc("claim_ocr_job", { p_worker_version: version.slice(0, 100) });
  if (error) throw new Error(error.message);
  const job = (data as { id: string; storage_path: string; mime_type: string; attempts: number }[] | null)?.[0];
  if (!job) return null;
  const signed = await storage.storage.from(SAVED_REPORT_BUCKET).createSignedUrl(job.storage_path, DOWNLOAD_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    await flag(sb, "fail_ocr_job", { p_id: job.id, p_error: "OneBook could not open the kept file for reading." });
    return null;
  }
  return { id: job.id, downloadUrl: signed.data.signedUrl, mimeType: job.mime_type, attempts: job.attempts };
}

export function reportOcrProgress(id: string, pagesDone: number, pagesTotal: number, sb: SupabaseClient = queue()) {
  return flag(sb, "report_ocr_progress", { p_id: id, p_pages_done: pagesDone, p_pages_total: pagesTotal });
}

export function completeOcrJob(id: string, result: OcrResult, sb: SupabaseClient = queue()) {
  return flag(sb, "complete_ocr_job", { p_id: id, p_result: result });
}

export function failOcrJob(id: string, error: string, sb: SupabaseClient = queue()) {
  return flag(sb, "fail_ocr_job", { p_id: id, p_error: error });
}
```

- [ ] **Step 5: Implement the route**

`app/api/ocr/worker/route.ts`:

```ts
import { z } from "zod";
import { OCR_MAX_PAGES, ocrResultSchema } from "@/lib/domain/ocr-statement";
import { workerAccess } from "@/lib/domain/ocr-worker-auth";
import { claimOcrJob, completeOcrJob, failOcrJob, reportOcrProgress } from "@/lib/services/ocr-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The company's OCR server asks for work and answers it here (3.02). It sits
 * inside the office network and only ever calls out, so this is the only way
 * work reaches it. Twenty pages of text is far below Vercel's 4.5 MB body cap.
 */
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), version: z.string().max(100) }),
  z.object({
    action: z.literal("progress"),
    id: z.uuid(),
    pagesDone: z.number().int().min(0).max(OCR_MAX_PAGES),
    pagesTotal: z.number().int().min(1).max(OCR_MAX_PAGES),
  }),
  z.object({ action: z.literal("complete"), id: z.uuid(), result: ocrResultSchema }),
  z.object({ action: z.literal("fail"), id: z.uuid(), error: z.string().max(2000) }),
]);

export async function POST(request: Request) {
  const access = workerAccess(request.headers.get("authorization"), process.env.OCR_WORKER_SECRET);
  if (access === "disabled") return Response.json({ error: "Not found" }, { status: 404 });
  if (access === "unauthorized") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;
  try {
    switch (body.action) {
      case "claim": {
        const job = await claimOcrJob(body.version);
        return job ? Response.json({ job }) : new Response(null, { status: 204 });
      }
      case "progress":
        return Response.json({ ok: await reportOcrProgress(body.id, body.pagesDone, body.pagesTotal) });
      case "complete":
        return Response.json({ ok: await completeOcrJob(body.id, body.result) });
      case "fail":
        return Response.json({ ok: await failOcrJob(body.id, body.error) });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The OCR queue failed";
    console.error("OCR worker request failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/ocr-worker-route.test.ts tests/unit/public-routes.test.ts`
Expected: PASS. `public-routes` already lets every `/api/` path skip the session.

- [ ] **Step 7: Commit**

```bash
git add lib/domain/ocr-worker-auth.ts lib/services/ocr-queue.ts app/api/ocr/worker/route.ts tests/unit/ocr-worker-route.test.ts
git commit -m "feat(api): the route the company's OCR server claims and answers jobs on"
```

---

### Task 4: Asking for a reading from the browser

**Files:**
- Create: `app/(app)/banking/ocr-actions.ts`
- Create: `lib/client/read-scanned-statement.ts`
- Test: `tests/unit/read-scanned-statement.test.ts`

**Interfaces:**
- Consumes:
  - `keepStatementFile(file, account, period)` from `lib/client/keep-statement-file.ts`.
  - The onebook RPCs `request_ocr_job`, `ocr_job_status` and `ocr_worker_online`.
  - `ocrResultSchema`, `glyphsFromOcrPages`, `OCR_TEXT` and `ScannedReading` (Task 2), and `readPdfStatements` and `PDF_MESSAGES.noLines`.
- Produces:
  - `ocrAvailableAction(): Promise<boolean>`.
  - `requestOcrAction(savedReportId: string): Promise<ActionResult<{ jobId: string }>>`.
  - `ocrStatusAction(jobId: string): Promise<ActionResult<OcrJobStatus>>`.
  - `readScannedStatement(file, account, onProgress, deps?): Promise<{ statements: PdfStatement[] } | { message: string }>`.

- [ ] **Step 1: Write the failing test** (the polling and parsing, with the server actions injected)

`tests/unit/read-scanned-statement.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readScannedStatement, type ScannedStatementDeps } from "@/lib/client/read-scanned-statement";

const text = readFileSync(join(__dirname, "../fixtures/ocr/made-up-statement-clean.md"), "utf8");
const file = new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" });

function deps(statuses: unknown[]): ScannedStatementDeps {
  return {
    keep: vi.fn(async () => ({ ok: true as const, id: "report-1" })),
    request: vi.fn(async () => ({ ok: true, data: { jobId: "job-1" } })),
    status: vi.fn(async () => ({ ok: true, data: statuses.shift() as never })),
    wait: async () => {},
  };
}

describe("readScannedStatement", () => {
  it("keeps the file, waits, shows the pages, and reads the statement", async () => {
    const seen: string[] = [];
    const d = deps([
      { status: "pending", pages_done: 0, pages_total: null, result: null, error: null },
      { status: "running", pages_done: 0, pages_total: 1, result: null, error: null },
      { status: "done", pages_done: 1, pages_total: 1, result: { engine: "e", pages: [{ page: 1, text }] }, error: null },
    ]);
    const out = await readScannedStatement(file, "Example Bank ****4821", (r) => seen.push(r.phase), d);
    expect(d.keep).toHaveBeenCalledWith(file, "Example Bank ****4821", { from: null, to: null });
    expect(seen).toEqual(["sending", "waiting", "reading"]);
    expect("statements" in out && out.statements[0].lines).toHaveLength(14);
  });

  it("says why when the server could not read the file", async () => {
    const out = await readScannedStatement(file, "x", () => {}, deps([
      { status: "failed", pages_done: 0, pages_total: null, result: null, error: "The file has 25 pages; OCR reads at most 20." },
    ]));
    expect(out).toEqual({ message: "The file has 25 pages; OCR reads at most 20." });
  });

  it("says so when the file cannot be kept", async () => {
    const d = deps([]);
    d.keep = vi.fn(async () => ({ ok: false as const, reason: "the store is full" }));
    expect(await readScannedStatement(file, "x", () => {}, d)).toEqual({
      message: "The file could not be sent for reading: the store is full.",
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/unit/read-scanned-statement.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the server actions**

`app/(app)/banking/ocr-actions.ts`:

```ts
"use server";
/**
 * A scanned statement read by the company's own OCR server (3.02): whether the
 * server is there, asking for a kept file to be read, and where that stands.
 * Who may ask, and who may see the answer, is decided again by the onebook
 * functions (0188); these only carry the request.
 */
import { z } from "zod";
import { canWrite, getUserRole } from "@/lib/auth";
import { activeSchema } from "@/lib/db/company";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import type { ActionResult } from "./actions";

export interface OcrJobStatus {
  status: "pending" | "running" | "done" | "failed";
  pages_done: number;
  pages_total: number | null;
  result: unknown;
  error: string | null;
}

const ocrConfigured = () => (process.env.OCR_WORKER_SECRET?.trim().length ?? 0) >= 24;

export async function ocrAvailableAction(): Promise<boolean> {
  if (!ocrConfigured()) return false;
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("ocr_worker_online");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function requestOcrAction(savedReportId: string): Promise<ActionResult<{ jobId: string }>> {
  if (!ocrConfigured()) return { ok: false, error: "OCR is not set up for this OneBook." };
  if (!canWrite(await getUserRole())) return { ok: false, error: "You do not have permission to perform this action" };
  const id = z.uuid().safeParse(savedReportId);
  if (!id.success) return { ok: false, error: "That statement file is not kept in this company" };
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("request_ocr_job", { p_schema: await activeSchema(), p_saved_report_id: id.data });
    if (error || typeof data !== "string") return { ok: false, error: error?.message ?? "The reading could not be requested" };
    return { ok: true, data: { jobId: data } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}

export async function ocrStatusAction(jobId: string): Promise<ActionResult<OcrJobStatus>> {
  const id = z.uuid().safeParse(jobId);
  if (!id.success) return { ok: false, error: "That reading does not exist" };
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await sb.rpc("ocr_job_status", { p_id: id.data });
    if (error) return { ok: false, error: error.message };
    const row = (data as OcrJobStatus[] | null)?.[0];
    return row ? { ok: true, data: row } : { ok: false, error: "That reading does not exist, or is not yours to see" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
```

- [ ] **Step 4: Implement the browser orchestration**

`lib/client/read-scanned-statement.ts`:

```ts
"use client";
/**
 * Reading a scanned statement (3.02): the file is kept as evidence, as an
 * import keeps it (1.83; the import later finds the same file by its SHA-256),
 * the company's OCR server is asked to read it, and its answer is read by the
 * same rules as a PDF with text. Never throws: every failure comes back as the
 * words to show.
 */
import { glyphsFromOcrPages, ocrResultSchema, OCR_TEXT, type ScannedReading } from "@/lib/domain/ocr-statement";
import { readPdfStatements, type PdfStatement } from "@/lib/domain/pdf-statement";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import type { StatementPeriod } from "@/lib/domain/statement-evidence";
import type { ActionResult } from "@/app/(app)/banking/actions";
import type { OcrJobStatus } from "@/app/(app)/banking/ocr-actions";

const POLL_MS = 3000;
/** Twenty pages at about fifteen seconds each, plus a wait for the server to pick the job up. */
const GIVE_UP_MS = 15 * 60 * 1000;

export interface ScannedStatementDeps {
  keep: (file: File, account: string, period: StatementPeriod) => Promise<KeptStatementFile>;
  request: (savedReportId: string) => Promise<ActionResult<{ jobId: string }>>;
  status: (jobId: string) => Promise<ActionResult<OcrJobStatus>>;
  wait: (ms: number) => Promise<void>;
}

async function defaultDeps(): Promise<ScannedStatementDeps> {
  const [{ keepStatementFile }, actions] = await Promise.all([
    import("@/lib/client/keep-statement-file"),
    import("@/app/(app)/banking/ocr-actions"),
  ]);
  return {
    keep: keepStatementFile,
    request: actions.requestOcrAction,
    status: actions.ocrStatusAction,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function readScannedStatement(
  file: File,
  account: string,
  onProgress: (reading: ScannedReading) => void,
  deps?: ScannedStatementDeps,
): Promise<{ statements: PdfStatement[] } | { message: string }> {
  try {
    const d = deps ?? (await defaultDeps());
    onProgress({ phase: "sending" });
    const kept = await d.keep(file, account, { from: null, to: null });
    if (!kept.ok) return { message: `The file could not be sent for reading: ${kept.reason}.` };
    const requested = await d.request(kept.id);
    if (!requested.ok || !requested.data) return { message: requested.error ?? "The reading could not be requested." };

    const started = Date.now();
    while (Date.now() - started < GIVE_UP_MS) {
      const status = await d.status(requested.data.jobId);
      if (!status.ok || !status.data) return { message: status.error ?? "The reading could not be followed." };
      const job = status.data;
      if (job.status === "failed") return { message: job.error ?? "The OCR server could not read this file." };
      if (job.status === "done") {
        const parsed = ocrResultSchema.safeParse(job.result);
        if (!parsed.success) return { message: "The OCR server's answer could not be read." };
        const statements = readPdfStatements(glyphsFromOcrPages(parsed.data.pages));
        return statements.some((s) => s.lines.length) ? { statements } : { message: PDF_MESSAGES.noLines };
      }
      onProgress(job.status === "pending" ? { phase: "waiting" } : { phase: "reading", pagesDone: job.pages_done, pagesTotal: job.pages_total });
      await d.wait(POLL_MS);
    }
    return { message: OCR_TEXT.timedOut };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "An unexpected error occurred" };
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/unit/read-scanned-statement.test.ts`
Expected: PASS (3 tests). If `PDF_MESSAGES.noLines` is a function rather than a string in `pdf-statement-view.ts`, call it the same way `lib/client/pdf-text.ts` does.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/banking/ocr-actions.ts" lib/client/read-scanned-statement.ts tests/unit/read-scanned-statement.test.ts
git commit -m "feat(banking): ask the company's OCR server to read a kept statement and follow it"
```

---

### Task 5: The dialog

**Files:**
- Modify: `app/(app)/banking/PdfStatementPreview.tsx` (add `ScannedPdf` and `OcrNotice` after `UnreadableFile`, around line 49)
- Modify: `app/(app)/banking/ImportStatementModal.tsx` (`FileState` at lines 160–166, `readPdf` at about 249, render at about 567 and about 632)
- Test: `tests/unit/ocr-statement.test.ts` (copy is already covered); a live check follows in Task 7

**Interfaces:**
- Consumes: `ScannedReading`, `OCR_TEXT` and `balanceBreaks` (Task 2), `readScannedStatement` (Task 4), `ocrAvailableAction` (Task 4) and `statementFileAccount` (`lib/domain/statement-evidence.ts`).

- [ ] **Step 1: Add the two components**

In `app/(app)/banking/PdfStatementPreview.tsx`, extend the antd import to `import { Alert, Button, Select, Space, Spin, Typography } from "antd";`. Add `import { OCR_TEXT, balanceBreaks, type ScannedReading } from "@/lib/domain/ocr-statement";`. Then add after `UnreadableFile`:

```tsx
/** A PDF with no text (3.02): offered to the company's OCR server, and how far reading it has got. */
export function ScannedPdf({ reading, onRead }: { reading: ScannedReading; onRead: () => void }) {
  if (reading.phase === "offline") {
    return <Alert style={{ marginTop: 12 }} type="error" showIcon title={OCR_TEXT.title} description={OCR_TEXT.offline} />;
  }
  if (reading.phase === "failed") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="error"
        showIcon
        title="The scanned statement could not be read"
        description={reading.message}
        action={<Button onClick={onRead}>Try again</Button>}
      />
    );
  }
  if (reading.phase === "ready") {
    return (
      <Alert
        style={{ marginTop: 12 }}
        type="info"
        showIcon
        title={OCR_TEXT.title}
        description={OCR_TEXT.ready}
        action={<Button type="primary" onClick={onRead}>{OCR_TEXT.button}</Button>}
      />
    );
  }
  const text =
    reading.phase === "sending" ? OCR_TEXT.sending
    : reading.phase === "waiting" ? OCR_TEXT.waiting
    : OCR_TEXT.reading(reading.pagesDone, reading.pagesTotal);
  return (
    <Space style={{ marginTop: 12 }}>
      <Spin size="small" />
      <Typography.Text>{text}</Typography.Text>
    </Space>
  );
}

/** Said above the lines of a statement read by OCR: check them, and where the running balance breaks. */
export function OcrNotice({ statement }: { statement: PdfStatement }) {
  const breaks = balanceBreaks(statement.lines, statement.openingMinor);
  return (
    <Alert
      style={{ marginTop: 12 }}
      type={breaks.length ? "warning" : "info"}
      showIcon
      title={OCR_TEXT.banner}
      description={breaks.length ? OCR_TEXT.breaks(breaks) : undefined}
    />
  );
}
```

- [ ] **Step 2: Wire the dialog**

In `app/(app)/banking/ImportStatementModal.tsx`:

1. Imports. Change line 67 to:
   `import PdfStatementPreview, { OcrNotice, ReadingPdf, ScannedPdf, UnreadableFile, WrongAccountAlert } from "./PdfStatementPreview";`
   Then add `import { ocrAvailableAction } from "./ocr-actions";`, `import type { ScannedReading } from "@/lib/domain/ocr-statement";`, `import { statementFileAccount } from "@/lib/domain/statement-evidence";` and `import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";`. Skip any import that already exists, and merge into the existing import of that module.
2. `FileState`. Replace `| { kind: "pdf"; statements: PdfStatement[] };` with:

```ts
  | { kind: "scanned"; reading: ScannedReading }
  | { kind: "pdf"; statements: PdfStatement[]; viaOcr?: boolean };
```

3. In `readPdf`, replace the `if ("message" in result) { ... }` block with:

```ts
    if ("message" in result) {
      if (result.message === PDF_MESSAGES.scanned) {
        const online = await ocrAvailableAction();
        if (token !== reading.current) return;
        setFile({ kind: "scanned", reading: { phase: online ? "ready" : "offline" } });
        return;
      }
      setFile({ kind: "unsupported", message: result.message });
      return;
    }
```

4. Add after `readPdf`:

```ts
  async function readWithOcr() {
    if (!chosen) return;
    const token = reading.current;
    const { readScannedStatement } = await import("@/lib/client/read-scanned-statement");
    const result = await readScannedStatement(
      chosen,
      statementFileAccount(bankAccount.label, bankAccount.maskedNumber),
      (progress) => {
        if (token === reading.current) setFile({ kind: "scanned", reading: progress });
      },
    );
    if (token !== reading.current) return;
    if ("message" in result) {
      setFile({ kind: "scanned", reading: { phase: "failed", message: result.message } });
      return;
    }
    setPicked(pickStatement(result.statements, bankAccount.maskedNumber));
    setFile({ kind: "pdf", statements: result.statements, viaOcr: true });
  }
```

5. Render. After `{file.kind === "unsupported" ? <UnreadableFile message={file.message} /> : null}` add:

```tsx
      {file.kind === "scanned" ? <ScannedPdf reading={file.reading} onRead={() => void readWithOcr()} /> : null}
```

   Inside the existing `{file.kind === "pdf" ? (` block (around line 632), put `{file.viaOcr && statement ? <OcrNotice statement={statement} /> : null}` as the first child passed to `PdfStatementPreview`, before `WrongAccountAlert`.

6. Search the dialog for every `file.kind ===` and `switch (file.kind)`. Any code that lists every kind, such as a disabled OK button or a "nothing chosen" check, must treat `"scanned"` like `"reading"`: nothing to import yet.

- [ ] **Step 3: Typecheck, lint and run the unit tests**

Run: `npm run typecheck && npx eslint "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/PdfStatementPreview.tsx" "app/(app)/banking/ocr-actions.ts" lib/client/read-scanned-statement.ts lib/domain/ocr-statement.ts lib/domain/ocr-worker-auth.ts lib/services/ocr-queue.ts app/api/ocr/worker/route.ts && npx vitest run`
Expected: tsc clean, eslint clean, and the full suite passing (about 5,940 tests). Do not cut the test output short. Read the summary line and any `FAIL` lines.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/banking/PdfStatementPreview.tsx" "app/(app)/banking/ImportStatementModal.tsx"
git commit -m "feat(banking): offer Read with OCR for a scanned statement, then review it like any PDF"
```

---

### Task 6: The worker on the OCR machine

**Files:**
- Create: `ocr-worker/worker.py`, `ocr-worker/onebook-ocr.service` and `ocr-worker/README.md`

**Interfaces:**
- Consumes: `POST {ONEBOOK_URL}/api/ocr/worker` (Task 3), and the local vLLM `POST {VLLM_URL}/v1/chat/completions` with model `baidu/Unlimited-OCR`.

- [ ] **Step 1: Write the worker**

`ocr-worker/worker.py`:

```python
#!/usr/bin/env python3
"""OneBook OCR worker (3.02).

Asks OneBook for scanned statements to read, reads each page with the local
Unlimited-OCR server, and sends the text back. Outbound HTTPS only; nothing
listens. Standard library plus poppler (pdftoppm, pdfinfo).

Environment, from /etc/onebook-ocr.env (root-only, never in the repo):
  ONEBOOK_URL        https://<the OneBook deployment>
  OCR_WORKER_SECRET  the same secret as OneBook's OCR_WORKER_SECRET
  VLLM_URL           default http://127.0.0.1:8000
"""
import base64
import json
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.request

VERSION = "onebook-ocr-worker/1"
ONEBOOK = os.environ["ONEBOOK_URL"].rstrip("/")
SECRET = os.environ["OCR_WORKER_SECRET"]
VLLM = os.environ.get("VLLM_URL", "http://127.0.0.1:8000").rstrip("/")
MAX_PAGES = 20
IDLE_SECONDS = 30
BUSY_SECONDS = 5
BUSY_WINDOW = 15 * 60
SUFFIX = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}


class Unreadable(Exception):
    """A reason the person who asked can act on."""


def onebook(action, **fields):
    req = urllib.request.Request(
        f"{ONEBOOK}/api/ocr/worker",
        json.dumps({"action": action, **fields}).encode(),
        {"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return None if resp.status == 204 else json.load(resp)


def page_count(pdf):
    try:
        out = subprocess.run(["pdfinfo", str(pdf)], check=True, capture_output=True, text=True, timeout=60).stdout
    except subprocess.CalledProcessError:
        raise Unreadable("The PDF could not be opened; it may be locked with a password or damaged.")
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise Unreadable("The PDF could not be opened; it may be damaged.")


def images_of(source, mime, workdir):
    if mime != "application/pdf":
        return [source]
    count = page_count(source)
    if count > MAX_PAGES:
        raise Unreadable(f"The file has {count} pages; OCR reads at most {MAX_PAGES}.")
    subprocess.run(["pdftoppm", "-r", "300", "-png", str(source), str(workdir / "page")], check=True, timeout=600)
    return sorted(workdir.glob("page-*.png"))


def read_page(image):
    mime = "image/png" if image.suffix == ".png" else "image/jpeg"
    data = base64.b64encode(image.read_bytes()).decode()
    body = {
        "model": "baidu/Unlimited-OCR",
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}},
            {"type": "text", "text": "<image>document parsing."},
        ]}],
        "temperature": 0,
        "skip_special_tokens": False,
        "vllm_xargs": {"ngram_size": 35, "window_size": 128},
    }
    req = urllib.request.Request(f"{VLLM}/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)["choices"][0]["message"]["content"]


def work(job):
    with tempfile.TemporaryDirectory() as tmp:
        workdir = pathlib.Path(tmp)
        source = workdir / ("source" + SUFFIX.get(job["mimeType"], ".bin"))
        urllib.request.urlretrieve(job["downloadUrl"], source)
        images = images_of(source, job["mimeType"], workdir)
        onebook("progress", id=job["id"], pagesDone=0, pagesTotal=len(images))
        pages = []
        for n, image in enumerate(images, 1):
            pages.append({"page": n, "text": read_page(image)})
            onebook("progress", id=job["id"], pagesDone=n, pagesTotal=len(images))
        onebook("complete", id=job["id"], result={"engine": VERSION + "+unlimited-ocr", "pages": pages})


def main():
    busy_until = 0.0
    print(f"{VERSION} asking {ONEBOOK} for work", flush=True)
    while True:
        try:
            answer = onebook("claim", version=VERSION)
        except Exception as error:  # OneBook unreachable: try again later
            print(f"claim failed: {error}", flush=True)
            time.sleep(IDLE_SECONDS)
            continue
        job = answer and answer.get("job")
        if not job:
            time.sleep(BUSY_SECONDS if time.monotonic() < busy_until else IDLE_SECONDS)
            continue
        busy_until = time.monotonic() + BUSY_WINDOW
        started = time.monotonic()
        try:
            work(job)
            print(f"job {job['id']} read in {time.monotonic() - started:.0f} s", flush=True)
        except Exception as error:
            reason = str(error) if isinstance(error, Unreadable) else "The OCR server could not read this file."
            print(f"job {job['id']} failed: {type(error).__name__}", flush=True)  # never the file's text
            try:
                onebook("fail", id=job["id"], error=reason)
            except Exception:
                pass  # the lease runs out and the job is handed out again


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the systemd unit**

`ocr-worker/onebook-ocr.service`:

```ini
[Unit]
Description=OneBook OCR worker (reads scanned statements with the local Unlimited-OCR server)
After=network-online.target docker.service
Wants=network-online.target

[Service]
EnvironmentFile=/etc/onebook-ocr.env
ExecStart=/usr/bin/python3 /opt/onebook-ocr/worker.py
Restart=always
RestartSec=10
DynamicUser=yes
PrivateTmp=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write the install notes**

`ocr-worker/README.md` (no machine address, no secret):

````markdown
# OneBook OCR worker

Runs on the company's OCR machine next to the vLLM container serving Unlimited-OCR
(model name `baidu/Unlimited-OCR`, listening on 127.0.0.1:8000). It only calls out:
OneBook's `/api/ocr/worker` and the local vLLM server.

Install (as an administrator on the OCR machine):

```bash
sudo apt install -y poppler-utils
sudo mkdir -p /opt/onebook-ocr && sudo cp worker.py /opt/onebook-ocr/
sudo install -m 600 /dev/null /etc/onebook-ocr.env
sudoedit /etc/onebook-ocr.env   # ONEBOOK_URL=..., OCR_WORKER_SECRET=..., VLLM_URL=http://127.0.0.1:8000
sudo cp onebook-ocr.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now onebook-ocr
journalctl -u onebook-ocr -f   # "asking https://... for work"
```

The secret is generated once (`openssl rand -hex 32`) and set in two places only:
this file and the Vercel project's `OCR_WORKER_SECRET`. Rotating it means changing both.
````

- [ ] **Step 4: Check the script compiles**

Run: `python -m py_compile ocr-worker/worker.py && echo ok`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add ocr-worker/worker.py ocr-worker/onebook-ocr.service ocr-worker/README.md
git diff --cached   # no address, no secret
git commit -m "feat(ocr): the worker that reads queued statements on the company's OCR machine"
```

---

### Task 7: Release 3.02, checks, live test

**Files:**
- Modify: `lib/domain/changelog.ts` (new entry at the top of `RELEASES`, line 43)

- [ ] **Step 1: Add the release**

```ts
  {
    version: "3.02",
    date: "2026-11-03",
    headline: "A scanned bank statement can be read by the company's own OCR server and imported like any PDF.",
    changes: [
      {
        kind: "added",
        title: "Import statement reads a scanned PDF with OCR",
        detail:
          "A statement PDF that is only an image used to be refused. Import statement now offers Read with OCR: the file is kept, sent to the company's own OCR server (never to an outside service), read page by page, and its lines come back to the same review and the same check that the opening balance plus the lines comes to the closing balance. A line whose running balance does not follow from the one before is named, so a misread figure is easy to find.",
        route: "/banking",
      },
    ],
  },
```

Use the date the release actually ships if it is not 2026-11-03. If 3.02 is taken on `origin/main` by then, take the next free number (project rule: number upward in merge order).

- [ ] **Step 2: Run the full checks**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all pass. Read the vitest summary line; never trim the output.

- [ ] **Step 3: Set up the live pieces (with the owner)**

The live test runs on production after the owner merges. Preview deployments sit behind Vercel's deployment protection, which the worker cannot pass. Until the secret is set, the feature is hidden and the route answers 404, so merging first changes nothing anyone sees.

1. Generate the secret: `openssl rand -hex 32`. Show it only in the owner's terminal, and do not paste it into chat or files.
2. The owner sets `OCR_WORKER_SECRET` in the Vercel project (Production) and redeploys. The owner also puts the same secret in `/etc/onebook-ocr.env` on the OCR machine, with `ONEBOOK_URL` set to the production URL. Then the worker is installed per `ocr-worker/README.md`.
3. `journalctl -u onebook-ocr -n 5` shows "asking … for work" and no claim errors.

- [ ] **Step 4: Live test on PC-Test (sample company)**

1. Make a scanned PDF of the made-up statement. Put `statement-poor.jpg` in a PDF with PyMuPDF (`fitz.open(); page.insert_image(...)`) so it has no text layer, and save it as `made-up-scanned.pdf` in the scratchpad.
2. On production, open Banking on PC-Test, choose a bank account, then Import statement, and choose `made-up-scanned.pdf`. Expect "This PDF is a scanned image" with **Read with OCR**.
3. Click it. Expect "Sending…", then "Waiting…", then "Reading page 1 of 1…". Within about 45 s the statement preview should appear with the OCR banner, 14 lines, and the proof balancing.
4. Take a screenshot of each state, and blur the bank account name if it is not the sample's. **Cancel. Do not import** into PC-Test.
5. Turn the worker off (`sudo systemctl stop onebook-ocr`), wait 2 minutes, and choose the file again. Expect the offline message and no button. Turn the worker back on.

- [ ] **Step 5: Commit and hand over**

```bash
git add lib/domain/changelog.ts
git commit -m "docs(changelog): 3.02, scanned statements read by the company's OCR server"
```

Then report to the owner in Vietnamese: the screenshots, the test counts and anything that did not work. Open the PR only when the owner asks. Opening it goes through the GitHub API with `git credential fill`, as quocviet-IT, with no Claude attribution.

---

## Self-review notes

- **Spec coverage.**
  - Queue, leases and limits: Task 1. Worker routes and the 404-when-unset rule: Task 3. Worker with adaptive polling: Task 6.
  - Parser reusing `readPdfStatements`: Task 2. Dialog states, banner and per-line breaks: Task 5. The file is kept before reading: Task 4.
  - Words: `OCR_TEXT` in Task 2 and the changelog in Task 7. Testing and rollout: Tasks 1, 2, 3, 4 and 7.
  - The spec's "table-only fallback" is deliberately conditional. Task 2 Step 5 says where to add it if the fixture shows it is needed.
- **Types used across tasks.**
  - `OcrResult`, `ScannedReading`, `OCR_TEXT`, `balanceBreaks` and `glyphsFromOcrPages` come from Task 2.
  - `ClaimedOcrJob` and the service functions come from Task 3.
  - `OcrJobStatus` and `ScannedStatementDeps` come from Task 4.
  - The names are the same everywhere they are used.
