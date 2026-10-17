import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The four ways a statement comes in, on the server (2.04): each works the
 * proof out again from what it is sent, with the dialog's own rule, and
 * refuses a statement that does not add up before the database is asked —
 * unless an administrator's override comes with it, which it passes on for the
 * database to judge again. An override from anyone else is refused before
 * anything is written. Plus the reads the import dialog needs. Invented data
 * throughout.
 */
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  generateSuggestions: vi.fn(),
  tieKeptStatementFile: vi.fn(),
  linkReconciliationStatementFile: vi.fn(),
  setReconciliationStatement: vi.fn(),
  getReconciliationHeader: vi.fn(),
  getReconciliationStatement: vi.fn(),
  getReconciliationDetail: vi.fn(),
  pairAndTick: vi.fn(),
  createReconciliationFromStatement: vi.fn(),
  listReconciliations: vi.fn(),
  completeReconciliation: vi.fn(),
  getBankingContext: vi.fn(),
  matchAfterCompletion: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", async () => ({
  getUserRole: mocks.getUserRole,
  canWrite: mocks.canWrite,
  getSessionUser: vi.fn(),
  isAdmin: (await import("@/lib/domain/roles")).isAdmin,
}));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/db/company", () => ({ resolveActiveCompany: vi.fn() }));
vi.mock("@/lib/services/saved-reports", () => ({ createSavedReportUploadTicket: vi.fn() }));
vi.mock("@/lib/services/banking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/banking")>()),
  generateSuggestions: mocks.generateSuggestions,
}));
vi.mock("@/lib/services/statement-files", () => ({
  tieKeptStatementFile: mocks.tieKeptStatementFile,
  linkReconciliationStatementFile: mocks.linkReconciliationStatementFile,
  findKeptStatementFile: vi.fn(),
  keepStatementFile: vi.fn(),
  removeUnkeptUpload: vi.fn(),
}));
vi.mock("@/lib/services/bankrec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/bankrec")>()),
  setReconciliationStatement: mocks.setReconciliationStatement,
  getReconciliationHeader: mocks.getReconciliationHeader,
  getReconciliationStatement: mocks.getReconciliationStatement,
  getReconciliationDetail: mocks.getReconciliationDetail,
  pairAndTick: mocks.pairAndTick,
  createReconciliationFromStatement: mocks.createReconciliationFromStatement,
  listReconciliations: mocks.listReconciliations,
  completeReconciliation: mocks.completeReconciliation,
}));
vi.mock("@/lib/services/banking-surface/facts", () => ({ getBankingContext: mocks.getBankingContext }));
vi.mock("@/lib/services/statement-bank-lines", () => ({ matchAfterCompletion: mocks.matchAfterCompletion }));

import { bankLinesOnAction, importStatementAction, priorClosingAction } from "@/app/(app)/banking/actions";
import { importStatementIntoReconciliationAction, reconcileRunMonthAction } from "@/app/(app)/banking/reconcile/statement-actions";
import { attachStatementFileAction } from "@/app/(app)/banking/statement-file-actions";
import { PROOF_REFUSAL } from "@/lib/domain/statement-proof";

const BANK = "11111111-1111-4111-8111-111111111111";
const REC = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const DENIED = "You do not have permission to perform this action";

type Row = Record<string, unknown>;

/**
 * A stand-in for PostgREST: the proved import answers as configured; the
 * bank-lines read pages at the row cap; a table read records its filters and
 * answers its first row.
 */
function fakeClient(options: { imported?: Row; importError?: string; bankLines?: Row[]; tables?: Record<string, Row[]> } = {}) {
  const rpcs: { fn: string; args: Row }[] = [];
  const pages: { orders: string[]; range: [number, number] | null }[] = [];
  const queries: { table: string; calls: string[] }[] = [];
  const sb = {
    rpc(fn: string, args: Row) {
      rpcs.push({ fn, args });
      if (fn === "acc_import_bank_statement_proved") {
        return Promise.resolve(
          options.importError
            ? { data: null, error: { message: options.importError } }
            : { data: [options.imported ?? { inserted: 2, skipped: 0, batch_id: "batch-1" }], error: null },
        );
      }
      if (fn === "acc_bank_lines_on") {
        const page = { orders: [] as string[], range: null as [number, number] | null };
        pages.push(page);
        const rows = options.bankLines ?? [];
        const chain = {
          order(column: string) {
            page.orders.push(column);
            return chain;
          },
          range(from: number, to: number) {
            page.range = [from, to];
            return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
          },
        };
        return chain;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from(table: string) {
      const query = { table, calls: [] as string[] };
      queries.push(query);
      const rows = options.tables?.[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "order", "limit"]) {
        chain[name] = (...args: unknown[]) => {
          query.calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      return chain;
    },
  };
  return { sb, rpcs, pages, queries };
}

const line = (txn_date: string, amount_minor: number, extra: Row = {}) => ({
  txn_date,
  description: "EXAMPLE LINE",
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${amount_minor}`,
  ...extra,
});
/** Opens at 1,000.00, two lines take 20.00 out, closes at 980.00: it adds up. */
const PLAIN = [line("2026-03-05", -1500), line("2026-03-09", -500)];
/** The same, the second line already in Bank Transactions from another source. */
const ROWS = [PLAIN[0], { ...PLAIN[1], skip: true }];
const PROOF = { opening_minor: 100000, closing_minor: 98000, opening_basis: "printed", closing_basis: "printed", set_aside: 0, override: null };
const OUT = { ...PROOF, closing_minor: 99000 };
const OUT_REFUSAL =
  "Out by $10.00. The opening $1,000.00 and the 2 lines come to $980.00; the statement closes at $990.00. " +
  "Import is blocked until the statement adds up.";
/** The same statement that does not add up, sent with "Import anyway…"'s reason. */
const OVERRIDDEN = { ...OUT, override: { reason: "The bank misprinted the closing" } };
const NOT_ADMIN = "Only an administrator can import a statement that does not add up";

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.canWrite.mockReturnValue(true);
  client = fakeClient();
  mocks.createClient.mockImplementation(async () => client.sb);
  mocks.generateSuggestions.mockResolvedValue(undefined);
  mocks.tieKeptStatementFile.mockResolvedValue(null);
  mocks.linkReconciliationStatementFile.mockResolvedValue(undefined);
  mocks.setReconciliationStatement.mockResolvedValue(2);
  mocks.getReconciliationHeader.mockResolvedValue({ bankAccountId: BANK });
  mocks.pairAndTick.mockResolvedValue({ lines: 2, paired: 2, ticked: 2, missing: 0, after: 0, flipped: false });
  mocks.createReconciliationFromStatement.mockResolvedValue(REC);
  mocks.listReconciliations.mockResolvedValue([]);
  mocks.getReconciliationDetail.mockResolvedValue({ differenceMinor: 0, statementEndingMinor: 98000 });
  mocks.completeReconciliation.mockResolvedValue(undefined);
  mocks.getBankingContext.mockResolvedValue({ asOf: "2026-10-14" });
  mocks.matchAfterCompletion.mockResolvedValue({ matched: null, matchError: null });
});

const proved = () => client.rpcs.filter((c) => c.fn === "acc_import_bank_statement_proved");

describe("Banking › Import statement", () => {
  it("refuses someone who cannot write, and asks nothing", async () => {
    mocks.canWrite.mockReturnValue(false);
    expect(await importStatementAction(BANK, "march.csv", ROWS, null, PROOF)).toEqual({ ok: false, error: DENIED });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses a statement that does not add up, in the dialog's words, before the database is asked", async () => {
    expect(await importStatementAction(BANK, "march.csv", ROWS, null, OUT)).toEqual({ ok: false, error: OUT_REFUSAL });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(proved()).toEqual([]);
  });

  it("refuses a missing balance, and a statement sent without its proof by a screen from before 2.04", async () => {
    expect(await importStatementAction(BANK, "march.csv", ROWS, null, { ...PROOF, opening_minor: null, opening_basis: null })).toEqual({
      ok: false,
      error: PROOF_REFUSAL.noOpening,
    });
    expect(await importStatementAction(BANK, "march.csv", ROWS)).toEqual({ ok: false, error: PROOF_REFUSAL.noProof });
    expect(await importStatementAction(BANK, "march.csv", ROWS, null, { ...PROOF, opening_basis: "books" })).toMatchObject({ ok: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses lines that are not statement lines", async () => {
    expect(await importStatementAction(BANK, "march.csv", [], null, PROOF)).toEqual({ ok: false, error: "No rows to import" });
    expect((await importStatementAction(BANK, "march.csv", [line("2026-03-05", 1.5)], null, PROOF)).ok).toBe(false);
    expect((await importStatementAction(BANK, "march.csv", [line("2026-02-30", -1500)], null, PROOF)).ok).toBe(false);
    expect(proved()).toEqual([]);
  });

  it("imports a statement that adds up through the proved import, the line already here from another source marked skip", async () => {
    client = fakeClient({ imported: { inserted: 1, skipped: 0, batch_id: "batch-7" } });
    const result = await importStatementAction(BANK, "march.csv", ROWS, null, PROOF);
    expect(result).toEqual({ ok: true, data: { inserted: 1, skipped: 0, otherSource: 1, batchId: "batch-7", fileWarning: null } });
    const [call] = proved();
    expect(call.args).toMatchObject({ p_bank_account_id: BANK, p_filename: "march.csv", p_proof: PROOF });
    const sent = call.args.p_rows as Row[];
    expect(sent.map((r) => [r.amount_minor, r.skip, r.source])).toEqual([
      [-1500, undefined, "file_upload"],
      [-500, true, "file_upload"],
    ]);
    expect(sent.every((r) => /^[0-9a-f]{64}$/.test(r.raw_hash as string))).toBe(true);
    expect(mocks.generateSuggestions).toHaveBeenCalledWith(client.sb, BANK);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking");
  });

  it("refuses an override from anyone but an administrator, in the database's words, before the database is asked", async () => {
    expect(PROOF_REFUSAL.notAdmin).toBe(NOT_ADMIN);
    expect(await importStatementAction(BANK, "march.csv", ROWS, FILE, OVERRIDDEN)).toEqual({ ok: false, error: NOT_ADMIN });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(client.rpcs).toEqual([]);
    expect(mocks.tieKeptStatementFile).not.toHaveBeenCalled();
  });

  it("imports an administrator's override through the proved import, the reason trimmed", async () => {
    mocks.getUserRole.mockResolvedValue("admin");
    const result = await importStatementAction(BANK, "march.csv", ROWS, null, { ...OUT, override: { reason: "  The bank misprinted the closing  " } });
    expect(result).toMatchObject({ ok: true, data: { inserted: 2, batchId: "batch-1" } });
    expect(proved()[0].args.p_proof).toEqual(OVERRIDDEN);
  });

  it("leaves the database the last word on an administrator's override", async () => {
    mocks.getUserRole.mockResolvedValue("admin");
    client = fakeClient({ importError: NOT_ADMIN });
    expect(await importStatementAction(BANK, "march.csv", ROWS, null, OVERRIDDEN)).toEqual({ ok: false, error: NOT_ADMIN });
    expect(proved()).toHaveLength(1);
  });

  it("lets a statement that adds up through, whoever sent an override with it", async () => {
    const result = await importStatementAction(BANK, "march.csv", ROWS, null, { ...PROOF, override: { reason: "Not needed" } });
    expect(result.ok).toBe(true);
    expect(proved()).toHaveLength(1);
  });

  it("ties the kept file to the batch, as before", async () => {
    mocks.tieKeptStatementFile.mockResolvedValue("could not be tied");
    const result = await importStatementAction(BANK, "march.csv", ROWS, FILE, PROOF);
    expect(mocks.tieKeptStatementFile).toHaveBeenCalledWith(client.sb, "import", "batch-1", FILE);
    expect(result.data?.fileWarning).toBe("could not be tied");
  });
});

describe("the reads Import statement needs", () => {
  it("reads the prior statement's closing: the newest completed reconciliation", async () => {
    client = fakeClient({ tables: { acc_statement_reconciliation: [{ statement_ending_date: "2026-02-28", statement_ending_balance_minor: "2000000" }] } });
    expect(await priorClosingAction(BANK)).toEqual({ ok: true, data: { date: "2026-02-28", endingMinor: 2000000 } });
    expect(client.queries[0]).toEqual({
      table: "acc_statement_reconciliation",
      calls: [
        'select("statement_ending_date,statement_ending_balance_minor")',
        `eq("bank_account_id","${BANK}")`,
        'eq("status","completed")',
        'order("statement_ending_date",{"ascending":false})',
        "limit(1)",
      ],
    });
  });

  it("reads no prior closing for an account never reconciled, and refuses an id that is not one", async () => {
    expect(await priorClosingAction(BANK)).toEqual({ ok: true, data: null });
    expect(await priorClosingAction("not-an-id")).toEqual({ ok: false, error: "Select a bank account" });
  });

  it("reads every bank line of the account over the days asked, past the row cap, in a total order", async () => {
    const bankLines = Array.from({ length: 2500 }, (_, i) => ({
      id: `line-${String(i).padStart(5, "0")}`,
      txn_date: "2026-03-15",
      amount_minor: -i,
      raw_hash: `ledger:${i}`,
      source_kind: i % 2 ? "books" : "mystery",
      import_batch_id: null,
    }));
    client = fakeClient({ bankLines });
    const result = await bankLinesOnAction(BANK, "2026-03-01", "2026-03-31");
    expect(result.data).toHaveLength(2500);
    expect(result.data?.[1]).toEqual({ id: "line-00001", txnDate: "2026-03-15", amountMinor: -1, rawHash: "ledger:1", sourceKind: "books", importBatchId: null });
    // A kind this release does not know is read as "other".
    expect(result.data?.[0].sourceKind).toBe("other");
    expect(client.rpcs[0].args).toEqual({ p_bank_account_id: BANK, p_from: "2026-03-01", p_to: "2026-03-31" });
    expect(client.pages.map((p) => p.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(client.pages.every((p) => p.orders.join(",") === "txn_date,id")).toBe(true);
  });

  it("refuses dates that are not days", async () => {
    expect(await bankLinesOnAction(BANK, "03/01/2026", "2026-03-31")).toEqual({ ok: false, error: "Use a YYYY-MM-DD date" });
    expect(client.rpcs).toEqual([]);
  });
});

describe("a screen from before 2.04, still open after the update", () => {
  it("is told to reload, wherever it sends a statement without its proof", async () => {
    const old = { file_name: "march.pdf", opening_minor: 100000, closing_minor: 98000, lines: PLAIN, statement_file_id: null };
    expect(await importStatementIntoReconciliationAction(REC, old)).toEqual({ ok: false, error: PROOF_REFUSAL.noProof });
    expect(
      await reconcileRunMonthAction({ ...old, kind: "month", bank_account_id: BANK, statement_date: "2026-03-31", sign: true }),
    ).toEqual({ ok: false, error: PROOF_REFUSAL.noProof });
    expect(
      await attachStatementFileAction({ reconciliation_id: REC, file_id: FILE, to: "2026-03-31", closing_minor: 98000, lines: [] }),
    ).toEqual({ ok: false, error: PROOF_REFUSAL.noProof });
    expect(mocks.setReconciliationStatement).not.toHaveBeenCalled();
    expect(mocks.createReconciliationFromStatement).not.toHaveBeenCalled();
    expect(mocks.linkReconciliationStatementFile).not.toHaveBeenCalled();
  });
});

describe("importing into a reconciliation", () => {
  const statement = (proof: Row) => ({ file_name: "march.pdf", lines: ROWS, proof, statement_file_id: null });

  it("refuses a statement that does not add up before keeping anything", async () => {
    expect(await importStatementIntoReconciliationAction(REC, statement(OUT))).toEqual({ ok: false, error: OUT_REFUSAL });
    expect(mocks.setReconciliationStatement).not.toHaveBeenCalled();
    expect(proved()).toEqual([]);
  });

  it("keeps the proved opening and closing, every line on the statement, and imports with the proof", async () => {
    const typed = { ...PROOF, opening_basis: "prior", closing_basis: "typed" };
    const result = await importStatementIntoReconciliationAction(REC, statement(typed));
    expect(result).toMatchObject({ ok: true, data: { inserted: 2, duplicates: 0, otherSource: 1 } });
    expect(mocks.setReconciliationStatement).toHaveBeenCalledWith(client.sb, REC, {
      fileName: "march.pdf",
      openingMinor: 100000,
      closingMinor: 98000,
      lines: ROWS,
      statementFileId: null,
    });
    expect(proved()[0].args.p_proof).toEqual(typed);
  });

  it("refuses an override from anyone but an administrator before keeping anything", async () => {
    expect(await importStatementIntoReconciliationAction(REC, statement(OVERRIDDEN))).toEqual({ ok: false, error: NOT_ADMIN });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setReconciliationStatement).not.toHaveBeenCalled();
    expect(mocks.getReconciliationHeader).not.toHaveBeenCalled();
    expect(mocks.pairAndTick).not.toHaveBeenCalled();
    expect(client.rpcs).toEqual([]);
  });

  it("passes an administrator's override on with a statement that does not add up", async () => {
    mocks.getUserRole.mockResolvedValue("admin");
    expect((await importStatementIntoReconciliationAction(REC, statement(OVERRIDDEN))).ok).toBe(true);
    expect(mocks.setReconciliationStatement).toHaveBeenCalledTimes(1);
    expect(proved()[0].args.p_proof).toEqual(OVERRIDDEN);
  });
});

describe("a month of a statement-files run", () => {
  const month = (proof: Row) => ({
    kind: "month",
    bank_account_id: BANK,
    file_name: "march.pdf",
    statement_date: "2026-03-31",
    lines: PLAIN,
    proof,
    statement_file_id: null,
    sign: true,
  });

  it("is refused before anything is read or written when its statement does not add up", async () => {
    const result = await reconcileRunMonthAction(month(OUT));
    expect(result).toEqual({ ok: false, error: OUT_REFUSAL });
    expect(mocks.listReconciliations).not.toHaveBeenCalled();
    expect(mocks.createReconciliationFromStatement).not.toHaveBeenCalled();
  });

  it("is refused before anything is read or written when an override comes with it from anyone but an administrator", async () => {
    expect(await reconcileRunMonthAction(month(OVERRIDDEN))).toEqual({ ok: false, error: NOT_ADMIN });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.listReconciliations).not.toHaveBeenCalled();
    expect(mocks.createReconciliationFromStatement).not.toHaveBeenCalled();
    expect(mocks.pairAndTick).not.toHaveBeenCalled();
    expect(mocks.completeReconciliation).not.toHaveBeenCalled();
    expect(client.rpcs).toEqual([]);
  });

  it("starts the month on an administrator's override, and imports with it", async () => {
    mocks.getUserRole.mockResolvedValue("admin");
    const result = await reconcileRunMonthAction(month(OVERRIDDEN));
    expect(result).toMatchObject({ ok: true, data: { id: REC } });
    expect(mocks.createReconciliationFromStatement).toHaveBeenCalledWith(client.sb, BANK, "2026-03-31", 99000, expect.anything());
    expect(proved()[0].args.p_proof).toEqual(OVERRIDDEN);
  });

  it("is refused when its statement prints no closing balance", async () => {
    expect(await reconcileRunMonthAction(month({ ...PROOF, closing_minor: null, closing_basis: null }))).toEqual({
      ok: false,
      error: PROOF_REFUSAL.noClosing,
    });
  });

  it("starts the reconciliation at the proof's closing, keeps its opening, and imports with the proof", async () => {
    const result = await reconcileRunMonthAction(month(PROOF));
    expect(result).toMatchObject({ ok: true, data: { id: REC, signed: true } });
    expect(mocks.createReconciliationFromStatement).toHaveBeenCalledWith(
      client.sb,
      BANK,
      "2026-03-31",
      98000,
      expect.objectContaining({ fileName: "march.pdf", openingMinor: 100000, closingMinor: 98000 }),
    );
    expect(proved()[0].args.p_proof).toEqual(PROOF);
  });

  it("leaves bringing the earlier lines forward as it was", async () => {
    mocks.createClient.mockImplementation(async () => ({
      ...client.sb,
      rpc: (fn: string) => Promise.resolve(fn === "acc_bring_forward_reconciliation" ? { data: "rec-bf", error: null } : { data: null, error: null }),
    }));
    const result = await reconcileRunMonthAction({
      kind: "bring_forward",
      bank_account_id: BANK,
      period_from: "2026-03-01",
      statement_date: "2026-03-31",
      opening_minor: 100000,
    });
    expect(result).toMatchObject({ ok: true, data: { id: "rec-bf", signed: true } });
  });
});

describe("attaching the statement", () => {
  const read = (proof: Row, aside: number[] = []) => ({
    reconciliation_id: REC,
    file_id: FILE,
    to: "2026-03-31",
    closing_minor: 98000,
    lines: [
      { txn_date: "2026-03-05", amount_minor: -1500 },
      { txn_date: "2026-03-07", amount_minor: -36000 },
      { txn_date: "2026-03-09", amount_minor: -500 },
    ],
    aside,
    proof,
  });
  const kept = (lines: { txnDate: string; amountMinor: number; setAside: boolean }[]) => ({
    statementFileId: null,
    endingDate: "2026-03-31",
    lines,
  });

  it("refuses a file that does not add up, override or not, before reading the reconciliation", async () => {
    const result = await attachStatementFileAction(read(PROOF));
    expect(result).toEqual({
      ok: false,
      error:
        "Out by $360.00. The opening $1,000.00 and the 3 lines come to $620.00; the statement closes at $980.00. " +
        "Attaching is blocked until the statement adds up.",
    });
    expect((await attachStatementFileAction(read({ ...PROOF, override: { reason: "Bank error" } }))).ok).toBe(false);
    expect(mocks.getReconciliationStatement).not.toHaveBeenCalled();
    expect(mocks.linkReconciliationStatementFile).not.toHaveBeenCalled();
  });

  it("attaches the file once its misread line is marked Not a transaction, against the lines the reconciliation counts", async () => {
    mocks.getReconciliationStatement.mockResolvedValue(
      kept([
        { txnDate: "2026-03-05", amountMinor: -1500, setAside: false },
        { txnDate: "2026-03-07", amountMinor: -36000, setAside: true },
        { txnDate: "2026-03-09", amountMinor: -500, setAside: false },
      ]),
    );
    expect(await attachStatementFileAction(read({ ...PROOF, set_aside: 1 }, [1]))).toEqual({ ok: true });
    expect(mocks.linkReconciliationStatementFile).toHaveBeenCalledWith(client.sb, REC, FILE);
  });

  it("still refuses a file whose lines are not the reconciliation's", async () => {
    mocks.getReconciliationStatement.mockResolvedValue(kept([{ txnDate: "2026-03-05", amountMinor: -1500, setAside: false }]));
    const result = await attachStatementFileAction(read({ ...PROOF, set_aside: 1 }, [1]));
    expect(result).toEqual({
      ok: false,
      error: "This reconciliation kept 1 line from 03/05/2026 to 03/31/2026; this file has 2 lines in those days.",
    });
    expect(mocks.linkReconciliationStatementFile).not.toHaveBeenCalled();
  });
});
