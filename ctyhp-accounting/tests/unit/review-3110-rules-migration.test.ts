import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0183_review_3110_rules.sql";
const raw = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8").replace(/\r/g, "");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const strip = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
const sql = strip(raw);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The whole `create or replace function name(...) ... $$;` statement. */
function fn(name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name.replace(".", "\\.")}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const bodyStart = sql.indexOf("$$", start) + 2;
  const end = sql.indexOf(";", sql.indexOf("$$", bodyStart)) + 1;
  return sql.slice(start, end);
}

/** The `create policy name ... ;` statement. */
function policy(name: string): string {
  const start = sql.search(new RegExp(`create policy ${name}\\b`, "i"));
  expect(start, `${name} is created`).toBeGreaterThanOrEqual(0);
  return norm(sql.slice(start, sql.indexOf(";", start) + 1));
}

describe("0183: what reaches every company and what runs once", () => {
  const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
  const company = strip(plan.statements.join("\n"));

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("replays the policies, the permission floor and the company functions into each company", () => {
    expect(company).toMatch(/set search_path = co_example/);
    expect(company).toMatch(/create policy acc_feedback_report_insert/);
    expect(company).toMatch(/create policy acc_feedback_attachment_insert/);
    expect(company).toMatch(/update acc_permission set min_role = 'admin'/);
    expect(company).toMatch(/function acc_retire_work_items\(p_live_keys text\[\], p_prefixes text\[\]\)/);
    expect(company).toMatch(/function acc_record_two_step_off\(p_removed int\)/);
    expect(company).toMatch(/function acc_record_mfa_reset\(p_user_id uuid, p_reason text, p_removed int\)/);
  });

  it("keeps the storage rules and the question count out of company schemas", () => {
    expect(company).not.toMatch(/acc_feedback_screenshot_path_allowed|acc_feedback_attachment_path_allowed/);
    expect(company).not.toMatch(/onebook\./);
    expect(company).not.toMatch(/storage\.objects/);
    const held = plan.skipped.map((s) => s.sql).join("\n");
    expect(held).toMatch(/acc_feedback_screenshot_path_allowed/);
    expect(held).toMatch(/acc_feedback_attachment_path_allowed/);
    expect(held).toMatch(/onebook\.ai_request/);
    expect(held).toMatch(/onebook\.take_ai_turn/);
  });

  it("drops nothing but the two policies it replaces", () => {
    const drops = [...sql.matchAll(/\bdrop\s+(\w+)\s+(?:if exists\s+)?(\w+)/gi)].map((m) => `${m[1]} ${m[2]}`);
    expect(drops).toEqual(["policy acc_feedback_report_insert", "policy acc_feedback_attachment_insert"]);
    expect(sql).not.toMatch(/\bdelete from (?!onebook\.ai_request)/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
  });
});

describe("0183: feedback is filed by members", () => {
  it("a report needs a role here, starts untriaged and without a screenshot, with bounded page fields", () => {
    const p = policy("acc_feedback_report_insert");
    expect(p).toMatch(/for insert to authenticated/);
    expect(p).toMatch(/\(select acc_current_role\(\)\) is not null/);
    expect(p).toMatch(/reporter_id = auth\.uid\(\) and status = 'new'/);
    expect(p).toMatch(/triaged_by is null and triaged_at is null and triage_note is null/);
    expect(p).toMatch(/screenshot_path is null/);
    expect(p).toMatch(/length\(page_url\) <= 2048/);
  });

  it("an attachment row needs a role, its own report, and a file in that report's folder", () => {
    const p = policy("acc_feedback_attachment_insert");
    expect(p).toMatch(/\(select acc_current_role\(\)\) is not null/);
    expect(p).toMatch(/uploaded_by = auth\.uid\(\)/);
    expect(p).toMatch(/starts_with\(storage_path, report_id::text \|\| '\/'\)/);
    expect(p).toMatch(/report\.reporter_id = auth\.uid\(\)/);
  });

  it("a screenshot goes only to the uploader's own report, once", () => {
    const f = norm(fn("acc_feedback_screenshot_path_allowed"));
    expect(f).toMatch(/security definer set search_path = public/);
    expect(f).toMatch(/bucket_id = 'feedback-screenshots' and starts_with\(o\.name, v_parts\[1\] \|\| '\/'\)\) then return false/);
    expect(f).toMatch(/reporter_id = auth\.uid\(\) and screenshot_path is null/);
    expect(f).toMatch(/%I\.acc_feedback_report/);
  });

  it("an attachment goes only to the uploader's own report, five at most", () => {
    const f = norm(fn("acc_feedback_attachment_path_allowed"));
    expect(f).toMatch(/security definer set search_path = public/);
    expect(f).toMatch(/bucket_id = 'feedback-attachments' and starts_with\(o\.name, v_parts\[1\] \|\| '\/'\)\) >= 5 then return false/);
    expect(f).toMatch(/reporter_id = auth\.uid\(\)/);
  });
});

describe("0183: the permissions that hand out the others", () => {
  it("are admin-only, and a grant below admin is withdrawn for those two alone", () => {
    expect(norm(sql)).toMatch(/update acc_permission set min_role = 'admin' where key in \('users\.manage', 'permissions\.manage'\);/);
    expect(norm(sql)).toMatch(
      /update acc_role_permission rp set allowed = false, updated_at = now\(\) from acc_permission p where p\.key = rp\.permission_key and p\.key in \('users\.manage', 'permissions\.manage'\) and rp\.allowed and not acc_role_meets\(rp\.role, p\.min_role\);/,
    );
  });
});

describe("0183: retiring finished work", () => {
  it("still refuses outsiders, and does nothing unless the caller is staff", () => {
    const f = norm(fn("acc_retire_work_items"));
    expect(f).toMatch(/if acc_current_role\(\) is null then raise exception 'Not authorized';/);
    expect(f).toMatch(/if not acc_is_staff\(\) then return 0; end if;/);
    expect(f.indexOf("acc_is_staff")).toBeLessThan(f.indexOf("update acc_work_item_state"));
    expect(f).toMatch(/length\(p\) > 0 and starts_with\(s\.work_key, p\)/);
    expect(norm(sql)).toMatch(/grant execute on function acc_retire_work_items\(text\[\], text\[\]\) to authenticated, service_role;/);
  });
});

describe("0183: two-step entries in the audit log", () => {
  it("turning it off is logged only once no verified factor is left", () => {
    const f = norm(fn("acc_record_two_step_off"));
    expect(f).toMatch(/if acc_current_role\(\) is null then raise exception/);
    expect(f).toMatch(/if exists \(select 1 from auth\.mfa_factors f where f\.user_id = auth\.uid\(\) and f\.status = 'verified'\) then raise exception/);
    expect(f.indexOf("auth.mfa_factors")).toBeLessThan(f.indexOf("insert into acc_audit_log"));
    expect(f).toMatch(/least\(greatest\(coalesce\(p_removed, 0\), 0\), 10\)/);
  });

  it("a reset is logged only once the person's verified factors are gone", () => {
    const f = norm(fn("acc_record_mfa_reset"));
    expect(f).toMatch(/perform acc_mfa_reset_check\(p_user_id, p_reason\);/);
    expect(f).toMatch(/where f\.user_id = p_user_id and f\.status = 'verified'\) then raise exception/);
    expect(f.indexOf("auth.mfa_factors")).toBeLessThan(f.indexOf("insert into acc_audit_log"));
  });
});

describe("0183: questions to the model are counted", () => {
  it("in a table nobody but the counting function can read or write", () => {
    expect(norm(sql)).toMatch(/alter table onebook\.ai_request enable row level security;/);
    expect(norm(sql)).toMatch(/revoke all on onebook\.ai_request from anon, authenticated;/);
  });

  it("sixty an hour per person, one person's questions taken in turn", () => {
    const f = norm(fn("onebook.take_ai_turn"));
    expect(f).toMatch(/returns boolean language plpgsql security definer set search_path = onebook, public/);
    expect(f).toMatch(/if v_user is null then return false; end if;/);
    expect(f).toMatch(/pg_advisory_xact_lock/);
    expect(f).toMatch(/asked_at < now\(\) - interval '1 hour'/);
    expect(f).toMatch(/if v_used >= 60 then return false; end if;/);
    expect(norm(sql)).toMatch(/revoke all on function onebook\.take_ai_turn\(\) from public, anon;/);
    expect(norm(sql)).toMatch(/grant execute on function onebook\.take_ai_turn\(\) to authenticated;/);
  });

  it("agrees with the number the screens quote", async () => {
    const source = readFileSync(join(process.cwd(), "lib/ai/quota.ts"), "utf8");
    expect(source).toMatch(/AI_TURNS_PER_HOUR = 60;/);
  });
});
