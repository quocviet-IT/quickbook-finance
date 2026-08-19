import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const actionMocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: actionMocks.createClient }));

import { downloadBackupAction, listBackupsAction } from "@/app/(app)/settings/backups/actions";

const dir = join(process.cwd(), "app", "(app)", "settings", "backups");
const client = readFileSync(join(dir, "BackupsClient.tsx"), "utf8");
const actions = readFileSync(join(dir, "actions.ts"), "utf8");

/**
 * Pulls the rendered text out of the one Alert this screen shows, rather than
 * searching the whole file. Searching the whole file is what let the earlier
 * version of these tests pass on the word "attachment" showing up in an
 * unrelated import line, and on "are not" showing up in an unrelated
 * sentence — neither of those proves the screen actually says the thing.
 */
function alertDescription(source: string): string {
  const match = source.match(/message="What a snapshot holds"[\s\S]*?description="([^"]*)"/);
  if (!match) throw new Error("could not find the snapshot-holds Alert's description prop");
  return match[1];
}

describe("what the backups screen tells a reader", () => {
  const description = alertDescription(client);

  it("ties the attachments disclosure to a plain 'not included', in the same sentence, not just both words anywhere in the file", () => {
    // The escape this closes: dropping the disclosure sentence entirely — say,
    // replacing it with an unrelated claim like "Snapshots are not editable"
    // — used to still pass, because "attachment" survived in the untouched
    // `import { formatBytes } from "@/lib/domain/feedback-attachment"` line
    // and "are not" survived in the unrelated replacement sentence. Scoping
    // to the rendered description and requiring both phrases to share a
    // sentence closes that: removing the disclosure sentence from the Alert
    // (production edit) makes this fail.
    expect(description).toMatch(
      /attachments?[^.]{0,200}(are not included|is not included|does not include)/i,
    );
  });

  it("explains a Skipped row specifically, not 'a night with no new file' in general", () => {
    // Removing "Skipped row" from the sentence (e.g. reverting to the old
    // "A night with no new file... is expected, not a failure", which reads
    // as true of a missing date too) makes this fail.
    expect(description).toMatch(/skipped row[^.]{0,150}(have not changed|had not changed)/i);
  });

  it("says plainly that a missing date is not proof a snapshot happened, and names where to check", () => {
    // Deleting the second sentence added for this review, or folding it back
    // into the single old reassurance sentence, makes this fail: a missing
    // date can also mean a failed run (takeCompanyBackup throws before any
    // row is written) or an ordinary night the batch never reached.
    expect(description).toMatch(/missing date[^.]{0,200}not proof/i);
    expect(description.toLowerCase()).toContain("administrator");
  });
});

describe("what the screen actually reads from acc_backup", () => {
  it("selects taken_at, the column the table has, not taken_on", () => {
    // supabase/migrations/0114_backups.sql declares `taken_at date not null` —
    // there is no taken_on column. A select naming the wrong column fails at
    // the database, not at compile time, so this is the regression a plain
    // read of the migration would not catch on its own.
    expect(actions).toContain("taken_at");
    expect(actions).not.toMatch(/\btaken_on\b/);
  });

  it("never writes to acc_backup", () => {
    // acc_backup grants `select` to authenticated and `all` to service_role
    // (migration 0114). This screen reads through the signed-in person's own
    // client, which only ever has select — so no insert/update/delete/upsert
    // belongs anywhere in this action file.
    expect(actions).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("size formatting stays away from the money helpers", () => {
  it("never reaches for fromMinor or formatMoney to render a byte count", () => {
    // fromMinor asserts its input is an integer and throws otherwise
    // (lib/domain/money.ts). Byte-to-MB conversion is ordinary division that
    // produces a fraction on purpose, so handing that fraction to a money
    // helper is exactly the mistake that took the dashboard down: money and
    // display arithmetic must never share a code path. Matches a call, not
    // just the word, so this still passes a comment that explains the rule.
    expect(client).not.toMatch(/\bfromMinor\(|\bformatMoney\(/);
  });
});

describe("a download in flight tracks its own row", () => {
  it("keys the spinner off a set of ids, not a single shared id", () => {
    // Reverting to `useState<string | null>(null)` with `loading={busy ===
    // row.id}` is the bug this pins: downloading row A, then row B while A is
    // still in flight, would clear A's spinner the moment B's own `finally`
    // runs, because both rows would be sharing the one `busy` value.
    expect(client).toMatch(/useState<Set<string>>\(new Set\(\)\)/);
    expect(client).not.toMatch(/busy\s*===\s*row\.id/);
    expect(client).toMatch(/busyIds\.has\(row\.id\)/);
  });
});

describe("a signed-out caller gets told that, not 'you do not have permission'", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("listBackupsAction checks the session before it ever queries acc_backup", async () => {
    const from = vi.fn(() => {
      throw new Error("must not query acc_backup before the session check");
    });
    actionMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      rpc: vi.fn(async () => {
        throw new Error("must not check permission before the session check");
      }),
      from,
    });

    // Matches the wording exportCompanyDataAction already uses in
    // app/(app)/settings/company/actions.ts for the same situation. Checking
    // permission first (production edit: swap the order of the two guards
    // back) makes this fail, since a signed-out caller fails that RPC too and
    // would get the generic permission-denied message instead.
    await expect(listBackupsAction()).resolves.toEqual({
      ok: false,
      error: "Your session has expired. Sign in again.",
    });
  });

  it("downloadBackupAction checks the session before it checks permission", async () => {
    actionMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      rpc: vi.fn(async () => {
        throw new Error("must not check permission before the session check");
      }),
    });

    await expect(
      downloadBackupAction("11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual({
      ok: false,
      error: "Your session has expired. Sign in again.",
    });
  });
});

describe("listBackupsAction keeps every stored row reachable", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns every stored row even when more than 60 newer non-stored rows exist", async () => {
    const storedRows = [
      { id: "s1", taken_at: "2026-05-01", status: "stored", skip_reason: null, size_bytes: "100", control_totals: {} },
      { id: "s2", taken_at: "2026-05-02", status: "stored", skip_reason: null, size_bytes: "200", control_totals: {} },
      { id: "s3", taken_at: "2026-05-03", status: "stored", skip_reason: null, size_bytes: "300", control_totals: {} },
    ];
    // Retention (BACKUP_KEEP) only ever prunes `stored` rows — a `skipped`
    // row is written and kept forever for every covered night the books
    // don't change. This is the shape that pile takes after a season of
    // quiet books: 70 skipped nights, every one dated after the three
    // snapshots actually worth downloading.
    const skippedRows = Array.from({ length: 70 }, (_, i) => ({
      id: `k${i}`,
      taken_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
      status: "skipped",
      skip_reason: "The books have not changed since the last snapshot",
      size_bytes: null,
      control_totals: {},
    }));

    const from = vi.fn(() => {
      // Scoped inside this call, not shared across the two parallel queries
      // listBackupsAction fires with Promise.all — a `mode` shared between
      // them would let the second chain's neq() overwrite the first chain's
      // eq() before its `.then` ever reads it back.
      let mode: "stored" | "non-stored" | null = null;
      const builder: {
        select: () => typeof builder;
        eq: (col: string, val: string) => typeof builder;
        neq: (col: string, val: string) => typeof builder;
        order: () => typeof builder;
        limit: (n: number) => Promise<{ data: unknown[]; error: null }>;
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
      } = {
        select: () => builder,
        eq: (col, val) => {
          if (col === "status" && val === "stored") mode = "stored";
          return builder;
        },
        neq: (col, val) => {
          if (col === "status" && val === "stored") mode = "non-stored";
          return builder;
        },
        order: () => builder,
        limit: (n) =>
          Promise.resolve({ data: (mode === "stored" ? storedRows : skippedRows).slice(0, n), error: null }),
        then: (resolve) => resolve({ data: mode === "stored" ? storedRows : skippedRows, error: null }),
      };
      return builder;
    });
    actionMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from,
    });

    const result = await listBackupsAction();
    expect(result.ok).toBe(true);
    const ids = (result.data ?? []).map((row) => row.id);
    // Reverting to a single `.order(...).limit(60)` query over both kinds of
    // row together (the shape this review flagged) would return only the 60
    // newest rows overall — every skipped row here is dated after every
    // stored row, so that single query would return none of s1/s2/s3.
    expect(ids).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
  });
});
