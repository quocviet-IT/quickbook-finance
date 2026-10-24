import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEED_TWIN_DAYS,
  NO_SKIPS,
  connectedMessage,
  defaultFeedStart,
  feedStartNote,
  skippedPhrase,
  syncedMessage,
  validFeedStart,
} from "@/lib/domain/bank-feed-start";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0161_bank_feed_skips_lines_already_here.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Line comments removed, so naming a thing in prose never reads as doing it. */
function strip(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** The text of one `create [or replace] function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

describe("where a bank feed starts", () => {
  it("is offered as the date of the account's last line in OneBook, or none", () => {
    expect(defaultFeedStart("2026-09-28")).toBe("2026-09-28");
    expect(defaultFeedStart(null)).toBeNull();
    expect(defaultFeedStart(undefined)).toBeNull();
  });

  it("is explained under the date, for each case", () => {
    expect(feedStartNote("2026-09-28", "2026-09-28")).toBe(
      "Lines dated before 09/28/2026 are skipped. A line already in OneBook (the same amount, dated within 2 days) is skipped too. This account's last line in OneBook is dated 09/28/2026.",
    );
    expect(feedStartNote(null, "2026-09-28")).toBe(
      "All the history the bank sends is brought in, about the last 6 months. A line already in OneBook (the same amount, dated within 2 days) is skipped. This account's last line in OneBook is dated 09/28/2026.",
    );
    expect(feedStartNote(null, null)).toBe(
      "Nothing is in OneBook for this account yet, so all the history the bank sends is brought in, about the last 6 months.",
    );
  });

  it("must be a calendar date when one is given", () => {
    expect(validFeedStart("2026-09-28")).toBe("2026-09-28");
    expect(validFeedStart(null)).toBeNull();
    expect(validFeedStart("")).toBeNull();
    expect(() => validFeedStart("2026-02-30")).toThrow(/calendar date/);
    expect(() => validFeedStart("09/28/2026")).toThrow(/calendar date/);
    expect(() => validFeedStart(20260928)).toThrow(/calendar date/);
  });
});

describe("what a sync says it skipped", () => {
  it("names both reasons, and says nothing when nothing was skipped", () => {
    expect(skippedPhrase(NO_SKIPS)).toBeNull();
    expect(skippedPhrase({ beforeStart: 0, alreadyHere: 1 })).toBe("1 line already in OneBook");
    expect(skippedPhrase({ beforeStart: 40, alreadyHere: 0 })).toBe("40 lines dated before the feed's start");
    expect(skippedPhrase({ beforeStart: 40, alreadyHere: 12 })).toBe("12 lines already in OneBook and 40 dated before the feed's start");
  });

  it("after Connect and synchronize", () => {
    expect(connectedMessage({ added: 36, suggestions: 3, ...NO_SKIPS })).toBe(
      "Bank connected. Imported 36 transactions and created 3 match suggestions.",
    );
    expect(connectedMessage({ added: 36, suggestions: 3, beforeStart: 0, alreadyHere: 12 })).toBe(
      "Bank connected. Imported 36 transactions, skipped 12 lines already in OneBook, and created 3 match suggestions.",
    );
  });

  it("after Sync now", () => {
    expect(syncedMessage({ added: 2, modified: 0, removed: 1, suggestions: 1, ...NO_SKIPS })).toBe(
      "Synchronized: 2 new, 0 updated, 1 removed, 1 match suggestion.",
    );
    expect(syncedMessage({ added: 2, modified: 0, removed: 0, suggestions: 0, beforeStart: 0, alreadyHere: 5 })).toBe(
      "Synchronized: 2 new, 0 updated, 0 removed, skipped 5 lines already in OneBook, 0 match suggestions.",
    );
  });
});

describe("migration 0161", () => {
  const raw = read(`supabase/migrations/${FILE}`);
  const sql = strip(raw);

  it("lands in every company's schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });

  it("deletes nothing that exists", () => {
    expect(sql).not.toMatch(/\bdelete from\b/i);
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop column\b/i);
  });

  it("skips a line before the start, and a posted line already here, one for one", () => {
    const fn = functionText(sql, "acc_bank_feed_try_skip");
    expect(fn).toMatch(/v_date < p_starts_on/);
    expect(fn).toMatch(/elsif not v_pending then/);
    expect(fn).toMatch(/t\.amount_minor = v_amount/);
    // The SQL's window and the screen's words agree.
    expect(fn).toContain(`t.txn_date between v_date - ${FEED_TWIN_DAYS} and v_date + ${FEED_TWIN_DAYS}`);
    expect(fn).toMatch(/t\.provider_removed_at is null/);
    expect(fn).toMatch(/t\.source <> 'bank_feed'/);
    expect(fn).toMatch(/r\.connection_id = p_connection_id/);
    expect(fn).toMatch(/r\.status <> 'undone'/);
    expect(fn).toMatch(/order by abs\(t\.txn_date - v_date\)/);
  });

  it("puts both guards in front of every line a sync page would insert", () => {
    const fn = functionText(sql, "acc_apply_bank_feed_page");
    expect(fn.match(/acc_bank_feed_try_skip\(/g)).toHaveLength(2);
    expect(fn).toMatch(/'skipped_before_start', v_before_start, 'skipped_already_here', v_already_here/);
    expect(fn.match(/select bank_account_id, feed_starts_on into v_bank_account_id, v_starts_on/g)).toHaveLength(2);
  });

  it("keeps where each mapped account's feed starts", () => {
    const fn = functionText(sql, "acc_save_bank_connection");
    expect(fn).toMatch(/nullif\(v_mapping->>'feed_starts_on', ''\)::date/);
    expect(fn).toMatch(/feed_starts_on = excluded\.feed_starts_on/);
  });

  it("lists a sync's skips, and a sync that only skipped", () => {
    expect(sql).toMatch(/drop function if exists acc_bank_feed_syncs\(uuid\);\s*create function acc_bank_feed_syncs/);
    const fn = functionText(sql, "acc_bank_feed_syncs");
    expect(fn).toMatch(/skipped_count int/);
    expect(fn).toMatch(/or exists \(select 1 from acc_bank_feed_skip s where s\.run_id = r\.id\)/);
    expect(sql).toContain("grant execute on function acc_bank_feed_syncs(uuid) to authenticated, service_role;");
  });

  it("reads each account's last line for the screen, and lets nobody but the sync skip", () => {
    expect(sql).toContain("grant execute on function acc_bank_feed_start_defaults() to authenticated, service_role;");
    expect(sql).toContain("grant execute on function acc_bank_feed_try_skip(uuid, uuid, uuid, date, jsonb) to service_role;");
    expect(sql).toContain("grant select on acc_bank_feed_skip to authenticated;");
  });
});

describe("Connect bank", () => {
  const client = read("app/(app)/banking/BankingClient.tsx");

  it("sends each account's start date, and waits for the last lines before connecting", () => {
    expect(client).toMatch(/feed_starts_on: mappingStarts\[account\.id\] \?\? null/);
    expect(client).toMatch(/disabled: lastLines === null/);
    expect(client).toMatch(/bankFeedStartDefaultsAction\(\)/);
    expect(client).toContain("Start the feed on");
  });

  it("says what was skipped after connecting and after Sync now", () => {
    expect(client).toMatch(/message\.success\(connectedMessage\(result\.data\), 8\)/);
    expect(client).toMatch(/message\.success\(syncedMessage\(result\.data\), 8\)/);
  });
});

describe("the 2.48 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.48")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.48);
    expect(release.date).toBe("2026-10-24");
  });

  it("says where the feed starts, what counts as already here, and that nothing posts by itself", () => {
    for (const words of [
      "the date of its last line already in OneBook",
      "the same amount dated within 2 days",
      "from an earlier connection to the same bank",
      "two identical charges are still two lines",
      "Nothing from a bank feed is ever posted to the books without someone coding or matching it",
      "Skipped column",
    ]) {
      expect(said).toContain(words);
    }
  });
});
