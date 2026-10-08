import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0137_bank_feed_disconnect_undo.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const body = (fn: string) => {
  const start = code.indexOf(`create or replace function ${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

describe("0137_bank_feed_disconnect_undo", () => {
  it("never posts: disconnecting and undoing move no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("closes every function it grants to anon", () => {
    const granted = [...code.matchAll(/grant execute on function (acc_\w+)\(/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThanOrEqual(8);
    for (const fn of granted) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon`));
    }
  });

  it("lets signed-in users read what a sync did, and only the functions write it", () => {
    expect(code).toMatch(/grant select on acc_bank_feed_sync_change to authenticated;/);
    expect(code).not.toMatch(/grant (insert|update|delete|all)[^;]*on acc_bank_feed_sync_change to authenticated/);
  });

  it("asks who may manage bank feeds before undoing or disconnecting", () => {
    for (const fn of ["acc_undo_bank_feed_sync", "acc_disconnect_bank_connection", "acc_apply_bank_feed_page"]) {
      expect(body(fn), fn).toMatch(/if not acc_bank_feed_authorized\(\) then/);
    }
  });

  it("never rewinds the sync cursor when undoing: undone lines stay out", () => {
    expect(body("acc_undo_bank_feed_sync")).not.toMatch(/sync_cursor/);
  });

  it("deletes the token when disconnecting, and keeps the lines", () => {
    const disconnect = body("acc_disconnect_bank_connection");
    expect(disconnect).toMatch(/delete from acc_bank_connection_secret/);
    expect(disconnect).not.toMatch(/delete from acc_bank_transaction/);
  });

  it("replaces the page function rather than leaving the old one callable", () => {
    expect(code).toMatch(/drop function if exists acc_apply_bank_feed_page\(uuid, jsonb, jsonb, jsonb\);/);
  });

  it("decides a sync was cut off in one place, and every reader asks it", () => {
    expect(code.match(/interval '15 minutes'/g)).toHaveLength(1);
    expect(code.match(/The sync stopped before it finished/g)).toHaveLength(3);
    const cutOff = body("acc_bank_feed_sync_cut_off");
    // It reads no table, so the daily sync (service role, nobody signed in) gets the same answer.
    expect(cutOff).not.toMatch(/acc_current_role|\bfrom\b/);
    expect(cutOff).toMatch(/security definer set search_path = public/);
    expect(code).toMatch(/revoke all on function acc_bank_feed_sync_cut_off\(text, timestamptz\) from public, anon/);
    for (const fn of ["acc_begin_bank_feed_sync", "acc_bank_feed_sync_is_newest", "acc_bank_feed_syncs", "acc_undo_bank_feed_sync", "acc_apply_bank_feed_page"]) {
      expect(body(fn), fn).toMatch(/acc_bank_feed_sync_cut_off\(/);
    }
  });

  it("leaves a settled run alone when a late finish arrives", () => {
    expect(body("acc_finish_bank_feed_sync")).toMatch(/where id = p_run_id and status = 'running';\s*if not found then return; end if;/);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
  });
});
