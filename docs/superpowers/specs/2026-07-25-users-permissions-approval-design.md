# Module C — Users, Permissions, Maker-Checker Approval, Audit History

- **Date:** 2026-07-25
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-010..014), and the deferrals that named
  this module: `2026-07-23-manual-journal-gl-design.md` §"Out of scope",
  `2026-07-23-ar-ap-credits-ageing-design.md` (write-off approval),
  `2026-07-24-bank-reconciliation-sessions-design.md` (reopen approval),
  `2026-07-24-company-periods-close-design.md` (reopen approval),
  `2026-07-24-cashflow-dashboard-design.md` (the omitted "pending approvals" card),
  `2026-07-25-purchase-orders-receiving-design.md` (variance exception approval)

## 1. Goal & Scope

Give the application the access-control and segregation-of-duties layer every earlier module
deferred to it: who may do what, who must approve it, and how an auditor reconstructs it.

### In scope
- **Users** (US-FR-010): an admin page listing every user with role, status, MFA status, and last
  sign-in; invite by email; change role; suspend and reactivate; offboard. Suspension and
  offboarding take effect **immediately and globally** — see §3.
- **Permissions** (US-FR-010): a seeded permission catalog and an editable role → permission
  matrix, with `acc_has_permission(key)` as the check. Wired into Module C's own actions and into
  the five controlled financial actions of §4; the coarse `acc_is_staff()` / `acc_is_admin()`
  gates stay in place everywhere else (see the explicit limitation in §8).
- **Maker-checker approval** (US-FR-012): configurable policies per controlled action (enabled,
  amount threshold, segregation of duties), an approval request queue, and an **approve-dispatch**
  execution model — the request stores the intended call and the approval performs it. A requester
  can never approve their own request while segregation is on.
- **Approvals inbox** and a dashboard card for pending approvals (the card
  `2026-07-24-cashflow-dashboard-design.md` deliberately left out).
- **Audit history** (US-FR-014): a filterable view of `acc_audit_log` by table, record, actor,
  action, and date range.
- **MFA visibility** (US-FR-011): each user's enrolled-factor status is surfaced so the privileged
  access policy is *testable*, plus the written policy on the page itself.

### Out of scope (own cycles / later)
- **MFA enrollment and enforcement at sign-in.** Enrollment belongs to the identity provider
  (Supabase Auth); this module reports factor status but cannot force a challenge. Blocking
  sign-in for a privileged user without MFA is an auth-layer change and its own cycle.
- **Retrofitting every existing RPC from role checks to permission checks** — the five controlled
  actions and Module C's own actions are converted here; the rest keep `acc_is_staff()`. §8 records
  this so it is a known gap, not an accident.
- Custom roles beyond `admin` / `accountant` / `viewer` — the matrix is editable per existing role;
  arbitrary role creation is later.
- Approval chains (multi-step, delegation, escalation, out-of-office) — one decision per request.
- Deleting a user's history on offboarding: offboarding revokes access and keeps the audit trail.
  Hard deletion of the auth account is deliberately not offered.
- Request-ID correlation across a whole HTTP request (US-FR-014 mentions "request ID") — the audit
  log records actor/action/entity/time; a correlation id spanning multiple writes is later.

## 2. Enforcement model (how a permission and an approval differ)

- A **permission** answers "may this role attempt the action at all?" — checked at the start of the
  action and in the Server Action guard.
- An **approval policy** answers "must someone else authorize this attempt?" — checked in the same
  place, but instead of refusing outright it directs the caller to submit a request.

Both are server-side. The UI mirrors them only to choose what to show.

## 3. Users and immediate revocation

`acc_app_user` gains `status acc_user_status` (`invited`, `active`, `suspended`, `offboarded`),
plus `invited_at`, `status_changed_at`, `status_reason`.

The single highest-value change: **`acc_current_role()` returns the role only for a user whose
status is `invited` or `active`.** Every RLS policy and every RPC in the application already
derives from that function, so suspending a user revokes read and write access everywhere at once,
with no per-table change and nothing to miss. Offboarding is the same revocation plus intent.

Invitations use the Supabase admin API (`inviteUserByEmail`) from a server-only admin client, then
insert the `acc_app_user` row with the chosen role and status `invited`. The invite, the role
change, the suspension, and the offboarding each write an audit row with actor and reason.

`acc_list_users()` (admin-only, SECURITY DEFINER) joins `acc_app_user` to `auth.users` and
`auth.mfa_factors` to return id, email, full name, role, status, MFA enrolled, and last sign-in —
the only way to read auth data, and it never returns anything else from `auth`.

## 4. Controlled actions (the five wired here)

| action_key | Underlying function | Amount used for the threshold |
|---|---|---|
| `manual_journal` | `acc_post_manual_journal` | total debits of the entry |
| `write_off` | `acc_write_off` | the amount written off |
| `inventory_adjustment` | `acc_adjust_inventory` | absolute value change |
| `period_reopen` | `acc_reopen_period` | 0 (policy is on/off) |
| `reconciliation_reopen` | `acc_reopen_reconciliation` | 0 (policy is on/off) |

These are exactly the actions earlier specs flagged as needing independent approval. Each gains a
guard at the top:

```
if acc_approval_required('<key>', <amount>) and not acc_in_approval_dispatch() then
  raise exception 'This action requires approval; submit it for approval instead';
end if;
```

`acc_in_approval_dispatch()` reads a **transaction-local** setting that only
`acc_approve_request` sets. So the underlying function cannot be called directly to bypass the
policy, and the approver's execution path is the only way through. This is why enforcement is
airtight rather than advisory.

## 5. Data model (migration `0036`)

New enums: `acc_user_status`, `acc_approval_status` (`pending`, `approved`, `rejected`,
`cancelled`).

- **`acc_permission`** — `key text primary key`, `label text`, `category text`, `description text`.
  Seeded catalog (e.g. `journal.post`, `journal.void`, `bill.post`, `bill.void`,
  `period.close`, `period.reopen`, `reconciliation.complete`, `reconciliation.reopen`,
  `writeoff.create`, `inventory.adjust`, `po.approve`, `po.variance_approve`, `approval.decide`,
  `users.manage`, `permissions.manage`, `settings.manage`, `audit.read`).
- **`acc_role_permission`** — `role acc_app_role`, `permission_key → acc_permission`,
  `allowed boolean not null`, primary key `(role, permission_key)`. Seeded to reproduce today's
  behaviour exactly: admin all true; accountant every operational key but not
  `users.manage` / `permissions.manage` / `period.reopen` / `reconciliation.reopen`; viewer only
  `audit.read`. **Seeding it to match current behaviour is deliberate** — turning this module on
  must not silently change what anyone can already do.
- **`acc_approval_policy`** — `action_key text primary key`, `label`, `enabled boolean default false`,
  `threshold_minor bigint default 0`, `require_segregation boolean default true`, `updated_by`,
  `updated_at`. Seeded with the five keys, **disabled** — again, no behaviour change on deploy
  until an admin turns a policy on.
- **`acc_approval_request`** — `id`, `action_key → acc_approval_policy`, `title text`,
  `amount_minor bigint`, `payload jsonb not null` (the intended call), `reason text not null`,
  `status acc_approval_status default 'pending'`, `requested_by`, `requested_at`, `decided_by`,
  `decided_at`, `decision_note text`, `result_id uuid` (what the approval produced),
  `error_message text` (a dispatch that failed, so the approver sees why). Insert/update only via
  the functions below; no delete policy.

RLS: `acc_permission` and `acc_approval_policy` readable by any role, writable by admin;
`acc_role_permission` readable by any role, writable by admin; `acc_approval_request` readable by
any role (an auditor must see the queue), no client write policy at all.

## 6. Functions (migration `0037`)

- `acc_current_role()` — redefined per §3 (status gate).
- `acc_has_permission(p_key text) returns boolean` — `coalesce(...allowed, false)` for the caller's
  role; fail-closed for an unknown key or an unauthenticated caller.
- `acc_approval_required(p_action_key text, p_amount_minor bigint) returns boolean` — policy
  enabled and `abs(amount) >= threshold`.
- `acc_in_approval_dispatch() returns boolean` — reads the transaction-local dispatch flag.
- `acc_submit_for_approval(p_action_key, p_title, p_amount_minor, p_payload jsonb, p_reason) returns uuid` —
  staff-gated, reason required, refuses an unknown or disabled action key.
- `acc_approve_request(p_request_id uuid, p_note text) returns uuid` — requires
  `approval.decide`; refuses a non-pending request; refuses `requested_by = auth.uid()` when the
  policy requires segregation; sets the dispatch flag; dispatches on `action_key` to the underlying
  function with the payload; records `result_id`; marks approved. A dispatch error is recorded in
  `error_message` and re-raised so nothing half-commits.
- `acc_reject_request(p_request_id, p_note)` — requires `approval.decide` and a note.
- `acc_cancel_request(p_request_id)` — the requester, or an admin.
- `acc_list_users()` / `acc_set_user_role(p_user_id, p_role, p_reason)` /
  `acc_set_user_status(p_user_id, p_status, p_reason)` — require `users.manage`; an admin may not
  suspend, offboard, or demote **themselves** (that is how an installation locks itself out), and
  the last remaining active admin may not be demoted or suspended at all.
- `acc_set_role_permission(p_role, p_key, p_allowed)` — requires `permissions.manage`; refuses to
  remove `permissions.manage` or `users.manage` from `admin` (same lock-out reasoning).
- `acc_set_approval_policy(p_action_key, p_enabled, p_threshold_minor, p_require_segregation)` —
  requires `settings.manage`.
- Guards added to the five controlled functions of §4.

## 7. Pure domain (`lib/domain/access.ts`, unit-tested)

- `PERMISSION_KEYS` and `CONTROLLED_ACTIONS` as typed constants shared by UI and validation.
- `approvalRequired({enabled, thresholdMinor}, amountMinor): boolean` — the same rule as the SQL.
- `canDecide({requestedBy, requireSegregation}, approverId): {ok: boolean; reason?: string}` — the
  segregation rule, so the UI can disable the button with the real reason.
- `isLastActiveAdmin(users, userId): boolean` — the lock-out guard, mirrored in SQL.
- `describeStatusChange(from, to)` — the audit sentence, one definition.
- Zod: `userInviteSchema`, `userRoleSchema`, `userStatusSchema`, `rolePermissionSchema`,
  `approvalPolicySchema`, `approvalDecisionSchema`, `approvalSubmitSchema`, `auditFilterSchema`.

## 8. Known limitation (recorded, not hidden)

Only the five controlled actions and Module C's own actions consult `acc_has_permission`. Every
other RPC still gates on `acc_is_staff()` / `acc_is_admin()`, so turning off, say, `bill.post` for
`accountant` does **not** yet stop an accountant posting a bill. The matrix is therefore
authoritative for the wired keys and advisory for the rest; the UI labels unwired keys as such, and
converting the remaining RPCs is a follow-up cycle. Claiming otherwise in the UI would be worse
than the gap itself.

## 9. Services / Actions / UI

- `lib/services/access.ts` — users (list, invite, set role, set status), permissions (list matrix,
  set), approval policies (list, set), approval requests (list pending/mine, submit, approve,
  reject, cancel), audit search.
- `lib/db/admin.ts` — a `server-only` Supabase client on the service-role key, used **only** for
  `inviteUserByEmail`. Never imported by a client component.
- UI:
  - `/settings/users` — the user table with role select, Suspend / Reactivate / Offboard, an Invite
    dialog, and the MFA column plus the written privileged-access policy.
  - `/settings/permissions` — the role × permission matrix, grouped by category, switches, with
    wired keys marked "enforced" and the rest "advisory" per §8.
  - `/settings/approvals` — the five policies: enable, threshold (in currency), segregation.
  - `/approvals` — the inbox: pending requests with Approve / Reject (disabled with the reason when
    segregation blocks the viewer), and "My requests" with Cancel.
  - `/settings/audit` — audit history with filters (table, record id, actor, action, date range).
  - Dashboard: a "Pending approvals" card linking to `/approvals`.
  - Sidebar: Approvals near the top; Users, Permissions, Approval Policies, Audit History under
    Settings.

## 10. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit** (`tests/unit/access.test.ts`): `approvalRequired` at, below, and above the threshold and
  when disabled; `canDecide` refusing the requester under segregation and allowing them without it;
  `isLastActiveAdmin`; every Zod schema's rejection path (empty reason, unknown role, bad
  threshold).
- **E2E verify** (`scripts/verify-access.mjs`, over the pooler, self-cleaning): seed a second
  accountant user; assert a suspended user's `acc_current_role()` is null and their reads are
  blocked; enable the `manual_journal` policy with a threshold; assert a below-threshold journal
  still posts directly and an above-threshold one is **rejected** with the approval message;
  submit it for approval; assert the requester cannot approve it (segregation) and that the
  underlying function still refuses a direct call; approve as the admin and assert the journal is
  posted, `result_id` is set, and the ledger is balanced; reject another request and assert nothing
  posted; turn segregation off and assert self-approval then works; assert an admin cannot suspend
  themselves and cannot demote the last active admin; assert `users.manage` denied to accountant;
  assert the audit log has a row for each access change.
- Full `npm run build && npm test && npm run typecheck && npm run lint` clean, real output pasted.

## 11. Build sequence
1. Migration `0036` (enums, `acc_app_user` columns, permission catalog + matrix seed, policies seed,
   request table, RLS).
2. Migration `0037` (`acc_current_role` status gate, permission/approval functions, dispatcher, the
   five guards, user admin functions).
3. Domain `access.ts` + Zod + unit tests (tests first).
4. `lib/db/types.ts`, `lib/db/admin.ts`, `lib/services/access.ts`.
5. Server actions.
6. UI: users → permissions → approval policies → approvals inbox → audit history → dashboard card →
   sidebar.
7. `scripts/verify-access.mjs`; apply migrations; full gate clean.
