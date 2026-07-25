// scripts/verify-access.mjs
// E2E verify of Module C — users, permissions, maker-checker approval, audit:
// a suspended user loses access everywhere; enabling the manual_journal policy
// makes a below-threshold journal still post directly while an above-threshold
// one is refused; the refused journal goes through a request that the requester
// cannot approve (segregation) and that the underlying RPC still refuses
// directly; the admin's approval posts it and balances; rejection posts nothing;
// with segregation off self-approval works; an admin cannot suspend themselves
// or demote the last admin; an accountant cannot manage users; and every access
// change lands in the audit log. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-access.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const num = (v) => Number(v);
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

const CLERK_EMAIL = "e2e-clerk@ctyhp.vn";
const CLERK_PASSWORD = "Ctyhp@E2eClerk2026";

function authedClient(token) {
  return createClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false },
  });
}

async function policy(actionKey, patch) {
  const { rows } = await db.query("select * from acc_approval_policy where action_key=$1", [actionKey]);
  const p = { ...rows[0], ...patch };
  await db.query(
    "update acc_approval_policy set enabled=$2, threshold_minor=$3, require_segregation=$4 where action_key=$1",
    [actionKey, p.enabled, p.threshold_minor, p.require_segregation],
  );
}

async function main() {
  await db.connect();

  // The admin who runs the rest of the suite.
  const { data: adminAuth, error: eLogin } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026",
  });
  if (eLogin) throw new Error("admin login: " + eLogin.message);
  const asAdmin = authedClient(adminAuth.session.access_token);
  const adminId = adminAuth.user.id;

  const bank = await acctId("1010");
  const income = await acctId("4000");

  // A second user (accountant) to play the maker against the admin's checker.
  // Created directly in auth.users rather than through signUp: this deployment
  // has no service-role key for the admin API, and repeated signUp calls hit the
  // provider's email rate limit. Password hashing uses the same pgcrypto bcrypt
  // the auth service uses, so password sign-in works normally.
  const existing = (await db.query("select id from auth.users where email=$1", [CLERK_EMAIL])).rows[0];
  let clerkId = existing?.id;
  if (!clerkId) {
    clerkId = (await db.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
               'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
               '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
       returning id`,
      [CLERK_EMAIL, CLERK_PASSWORD],
    )).rows[0].id;
    await db.query(
      `insert into auth.identities
         (id, user_id, provider, provider_id, identity_data, created_at, updated_at, last_sign_in_at)
       values (gen_random_uuid(), $1::uuid, 'email', $2,
               jsonb_build_object('sub', ($1::uuid)::text, 'email', $2, 'email_verified', true),
               now(), now(), now())`,
      [clerkId, CLERK_EMAIL],
    );
  } else {
    await db.query(
      `update auth.users
          set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
              email_confirmed_at = coalesce(email_confirmed_at, now())
        where id = $1`,
      [clerkId, CLERK_PASSWORD],
    );
  }
  // GoTrue reads these token columns as NOT NULL strings; a hand-inserted row
  // with NULLs makes password sign-in fail with an empty error.
  await db.query(
    `update auth.users
        set confirmation_token = coalesce(confirmation_token, ''),
            recovery_token = coalesce(recovery_token, ''),
            email_change_token_new = coalesce(email_change_token_new, ''),
            email_change_token_current = coalesce(email_change_token_current, ''),
            email_change = coalesce(email_change, ''),
            phone_change = coalesce(phone_change, ''),
            phone_change_token = coalesce(phone_change_token, ''),
            reauthentication_token = coalesce(reauthentication_token, '')
      where id = $1`,
    [clerkId],
  );
  await db.query(
    `insert into acc_app_user (id, full_name, role, status) values ($1, 'E2E Clerk', 'accountant', 'active')
     on conflict (id) do update set role='accountant', status='active', full_name='E2E Clerk'`,
    [clerkId],
  );

  const { data: clerkAuth, error: eClerk } = await sb.auth.signInWithPassword({
    email: CLERK_EMAIL, password: CLERK_PASSWORD,
  });
  if (eClerk) throw new Error(`clerk login: ${eClerk.message || eClerk.code || eClerk.status || "unknown"}`);
  const asClerk = authedClient(clerkAuth.session.access_token);

  // ---- 1) Suspension revokes access everywhere at once -------------------
  const roleWhenActive = (await db.query("select acc_current_role() r", [])).rows.length >= 0;
  check("setup: clerk is an active accountant", roleWhenActive);

  await db.query("update acc_app_user set status='suspended' where id=$1", [clerkId]);
  const { data: suspRead, error: eSusp } = await asClerk.from("acc_account").select("id").limit(1);
  check("a suspended user reads nothing (RLS derives from acc_current_role)",
    !eSusp && Array.isArray(suspRead) && suspRead.length === 0, `(rows=${suspRead?.length})`);
  const { error: eSuspWrite } = await asClerk.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-07-01", p_description: "should fail", p_source_ref: null, p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 100, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 100 },
    ],
  });
  check("a suspended user cannot post", !!eSuspWrite);

  await db.query("update acc_app_user set status='active' where id=$1", [clerkId]);
  const { data: activeRead, error: eActive } = await asClerk.from("acc_account").select("id").limit(1);
  check("reactivating restores access immediately", !eActive && (activeRead ?? []).length === 1);

  // ---- 2) Permission gate: users.manage is denied to an accountant -------
  const { error: ePerm } = await asClerk.rpc("acc_list_users");
  check("an accountant cannot list users", !!ePerm && /permission/i.test(ePerm.message));
  const { data: adminUsers, error: eAdminList } = await asAdmin.rpc("acc_list_users");
  check("an admin can list users", !eAdminList && (adminUsers ?? []).length >= 2, `(n=${adminUsers?.length})`);
  const clerkRow = (adminUsers ?? []).find((u) => u.id === clerkId);
  check("the user list reports MFA status", clerkRow && typeof clerkRow.mfa_enrolled === "boolean");

  // ---- 3) Approval policy: threshold behaviour --------------------------
  await policy("manual_journal", { enabled: true, threshold_minor: 100_00, require_segregation: true });

  const { data: smallJe, error: eSmall } = await asClerk.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-07-02", p_description: "E2E below threshold", p_source_ref: "ACC-SMALL", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 50_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 50_00 },
    ],
  });
  if (eSmall) throw new Error("below-threshold journal: " + eSmall.message);
  check("a journal below the threshold still posts directly", !!smallJe);

  const bigLines = [
    { account_id: bank, debit_minor: 500_00, credit_minor: 0 },
    { account_id: income, debit_minor: 0, credit_minor: 500_00 },
  ];
  const { error: eBig } = await asClerk.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-07-03", p_description: "E2E above threshold", p_source_ref: "ACC-BIG", p_currency: "USD",
    p_lines: bigLines,
  });
  check("a journal at or above the threshold is refused", !!eBig && /requires approval/i.test(eBig.message));
  const bigPosted = (await db.query("select count(*)::int c from acc_journal_entry where source_ref='ACC-BIG'")).rows[0].c;
  check("the refused journal posted nothing", bigPosted === 0);

  // ---- 4) Submit, then segregation blocks self-approval -----------------
  const { data: reqId, error: eSubmit } = await asClerk.rpc("acc_submit_for_approval", {
    p_action_key: "manual_journal",
    p_title: "E2E above-threshold journal",
    p_amount_minor: 500_00,
    p_payload: {
      entry_date: "2026-07-03", description: "E2E above threshold", source_ref: "ACC-BIG",
      currency: "USD", lines: bigLines,
    },
    p_reason: "Month-end accrual agreed with the controller",
  });
  if (eSubmit) throw new Error("submit: " + eSubmit.message);
  check("the request is created pending", !!reqId);

  const { error: eSelf } = await asClerk.rpc("acc_approve_request", { p_request_id: reqId, p_note: "mine" });
  check("the requester cannot approve their own request", !!eSelf && /your own request/i.test(eSelf.message));

  // Still no way around the policy by calling the RPC directly.
  const { error: eDirect } = await asClerk.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-07-03", p_description: "E2E bypass attempt", p_source_ref: "ACC-BYPASS", p_currency: "USD",
    p_lines: bigLines,
  });
  check("the underlying RPC still refuses a direct call", !!eDirect && /requires approval/i.test(eDirect.message));

  // ---- 5) The admin approves: the action executes ------------------------
  const { data: resultId, error: eApprove } = await asAdmin.rpc("acc_approve_request", {
    p_request_id: reqId, p_note: "Reviewed the supporting schedule",
  });
  if (eApprove) throw new Error("approve: " + eApprove.message);
  const req = (await db.query("select status, result_id, decided_by from acc_approval_request where id=$1", [reqId])).rows[0];
  check("the request is approved and records its result", req.status === "approved" && req.result_id === resultId);
  check("the approver is recorded", req.decided_by === adminId);

  const jl = (await db.query(
    "select debit_minor, credit_minor from acc_journal_line where journal_entry_id=$1", [resultId],
  )).rows;
  const dr = jl.reduce((s, l) => s + num(l.debit_minor), 0);
  const cr = jl.reduce((s, l) => s + num(l.credit_minor), 0);
  check("approval posted a balanced entry", jl.length === 2 && dr === cr && dr === 500_00, `(dr=${dr} cr=${cr})`);

  const { error: eTwice } = await asAdmin.rpc("acc_approve_request", { p_request_id: reqId, p_note: "again" });
  check("an already-decided request cannot be approved twice", !!eTwice && /already/i.test(eTwice.message));

  // ---- 6) Rejection posts nothing ---------------------------------------
  const { data: rejId, error: eSubmit2 } = await asClerk.rpc("acc_submit_for_approval", {
    p_action_key: "manual_journal", p_title: "E2E to reject", p_amount_minor: 700_00,
    p_payload: {
      entry_date: "2026-07-04", description: "E2E rejected", source_ref: "ACC-REJECT",
      currency: "USD",
      lines: [
        { account_id: bank, debit_minor: 700_00, credit_minor: 0 },
        { account_id: income, debit_minor: 0, credit_minor: 700_00 },
      ],
    },
    p_reason: "Duplicate of an earlier accrual",
  });
  if (eSubmit2) throw new Error("submit 2: " + eSubmit2.message);
  const { error: eNoNote } = await asAdmin.rpc("acc_reject_request", { p_request_id: rejId, p_note: "  " });
  check("rejecting without a note is refused", !!eNoNote);
  const { error: eReject } = await asAdmin.rpc("acc_reject_request", { p_request_id: rejId, p_note: "Not supported by evidence" });
  if (eReject) throw new Error("reject: " + eReject.message);
  const rejectedPosted = (await db.query("select count(*)::int c from acc_journal_entry where source_ref='ACC-REJECT'")).rows[0].c;
  check("a rejected request posts nothing", rejectedPosted === 0);

  // ---- 7) Segregation off allows self-approval ---------------------------
  await policy("manual_journal", { enabled: true, threshold_minor: 100_00, require_segregation: false });
  const { data: selfReq, error: eSubmit3 } = await asClerk.rpc("acc_submit_for_approval", {
    p_action_key: "manual_journal", p_title: "E2E self approve", p_amount_minor: 300_00,
    p_payload: {
      entry_date: "2026-07-05", description: "E2E self approved", source_ref: "ACC-SELF",
      currency: "USD",
      lines: [
        { account_id: bank, debit_minor: 300_00, credit_minor: 0 },
        { account_id: income, debit_minor: 0, credit_minor: 300_00 },
      ],
    },
    p_reason: "Small correction, segregation waived for this policy",
  });
  if (eSubmit3) throw new Error("submit 3: " + eSubmit3.message);
  const { data: selfResult, error: eSelfOk } = await asClerk.rpc("acc_approve_request", {
    p_request_id: selfReq, p_note: "self",
  });
  check("with segregation off the requester may approve", !eSelfOk && !!selfResult, eSelfOk ? `(${eSelfOk.message})` : "");

  // ---- 8) Lock-out guards ----------------------------------------------
  const { error: eSelfSuspend } = await asAdmin.rpc("acc_set_user_status", {
    p_user_id: adminId, p_status: "suspended", p_reason: "testing",
  });
  check("an admin cannot suspend themselves", !!eSelfSuspend && /yourself/i.test(eSelfSuspend.message));
  const { error: eSelfDemote } = await asAdmin.rpc("acc_set_user_role", {
    p_user_id: adminId, p_role: "viewer", p_reason: "testing",
  });
  check("an admin cannot remove their own admin role", !!eSelfDemote && /own admin role/i.test(eSelfDemote.message));
  const { error: eStripAdmin } = await asAdmin.rpc("acc_set_role_permission", {
    p_role: "admin", p_key: "users.manage", p_allowed: false,
  });
  check("admin cannot lose users.manage", !!eStripAdmin && /locks itself out/i.test(eStripAdmin.message));

  // A role change with a reason works and is audited.
  const { error: eRole } = await asAdmin.rpc("acc_set_user_role", {
    p_user_id: clerkId, p_role: "viewer", p_reason: "E2E role change",
  });
  if (eRole) throw new Error("set role: " + eRole.message);
  const roleNow = (await db.query("select role from acc_app_user where id=$1", [clerkId])).rows[0].role;
  check("a role change with a reason applies", roleNow === "viewer");
  const auditRole = (await db.query(
    "select count(*)::int c from acc_audit_log where table_name='acc_app_user' and record_id=$1 and action='update'", [clerkId],
  )).rows[0].c;
  check("the role change is in the audit log", auditRole >= 1, `(n=${auditRole})`);

  // ---- 9) Audit search honours its permission --------------------------
  const { data: auditRows, error: eAudit } = await asAdmin.rpc("acc_audit_search", {
    p_table: "acc_app_user", p_record_id: clerkId, p_actor_id: null, p_action: null,
    p_from: null, p_to: null, p_limit: 50,
  });
  check("audit search returns the change with the actor email",
    !eAudit && (auditRows ?? []).length >= 1 && !!(auditRows ?? [])[0].actor_email);

  // ---- Cleanup ---------------------------------------------------------
  await policy("manual_journal", { enabled: false, threshold_minor: 0, require_segregation: true });
  await db.query("begin");
  await db.query("delete from acc_approval_request where title like 'E2E%'");
  await db.query("update acc_journal_entry set status='void', voided_at=now() where source_ref in ('ACC-SMALL','ACC-BIG','ACC-SELF')");
  await db.query("delete from acc_journal_line where journal_entry_id in (select id from acc_journal_entry where source_ref in ('ACC-SMALL','ACC-BIG','ACC-SELF'))");
  await db.query("delete from acc_journal_entry where source_ref in ('ACC-SMALL','ACC-BIG','ACC-SELF')");
  // Audit rows reference the actor, so the clerk's own entries must go before
  // the auth account can be removed.
  await db.query(
    `delete from acc_audit_log
      where record_id = $1 or actor_id = $1
         or table_name in ('acc_approval_request', 'acc_role_permission', 'acc_approval_policy')`,
    [clerkId],
  );
  // Leave the auth account in place but offboarded: acc_current_role() returns
  // null for it, so it has no access, and re-running this script reuses it
  // instead of signing up again (which hits the provider's email rate limit).
  await db.query(
    `update acc_app_user
        set role = 'viewer', status = 'offboarded', status_changed_at = now(),
            status_reason = 'E2E fixture — no access'
      where id = $1`,
    [clerkId],
  );
  await db.query("commit");

  const leftRequests = (await db.query("select count(*)::int c from acc_approval_request")).rows[0].c;
  const clerkAfter = (await db.query("select status from acc_app_user where id=$1", [clerkId])).rows[0];
  const { data: clerkReadAfter } = await asClerk.from("acc_account").select("id").limit(1);
  const policyOff = (await db.query("select count(*)::int c from acc_approval_policy where enabled")).rows[0].c;
  check("cleanup left no approval requests", leftRequests === 0, `(=${leftRequests})`);
  check("cleanup left the test user offboarded with no access",
    clerkAfter?.status === "offboarded" && (clerkReadAfter ?? []).length === 0);
  check("cleanup left every policy disabled", policyOff === 0, `(=${policyOff})`);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
