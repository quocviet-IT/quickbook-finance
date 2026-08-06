# Who may see a settings screen — design

Date: 2026-08-06

## Where this came from

A screenshot of the settings hub, and one sentence: *"Bạn nên phân quyền lại, phần
này chỉ có admin thấy. Các người dùng khác không xem được."* The card in question:

> **Feedback triage** — Bug reports and suggestions filed by staff, with screenshots.

The card is real, and so is the problem behind it — but the card is the smallest
part of it.

### What is actually true today

`SettingsHubItem` carries `href`, `title` and `description` and nothing else
(`lib/domain/navigation.ts`). There is no gate on it, and `SettingsHubClient`
renders the whole catalog. So **all ten cards** show to every role: Users,
Permissions, Approval policies, Audit history, Companies, the lot.

`NavPage` — the sidebar's item type in the same file — already has `roles` and
`anyPermissions`, and `canShowNavItem` already filters on them. The hub was
simply never given the same treatment.

No `/settings/*` page refuses entry either. Typing the URL lands you on the
screen; what protects the data is RLS and the server actions behind it. That is
a defensible design, and this spec keeps it as the *last* line rather than the
only one.

Then the part that is not cosmetic. Migration 0061 grants `feedback.read` to
every role, on purpose, with the reason written down:

```sql
when 'feedback.read' then true            -- test period: everyone reads
```

Live grants confirm it:

| Permission | admin | accountant | viewer | sales |
|---|:--:|:--:|:--:|:--:|
| `feedback.read` | yes | **yes** | **yes** | no |
| `feedback.triage` | yes | no | no | no |

An accountant or a viewer can read every bug report anyone has filed, with the
screenshots attached, and — through `acc_feedback_queue` — the reporter's email
address as well. Not by finding a hole: by holding the permission the system
granted them. Hiding the card would leave all of that reachable through the API,
which is worse than the current state because it would look fixed.

The test period is over. This spec ends it.

## Goal

A settings card appears only for someone who may use the screen behind it; that
screen refuses anyone else at the door; and the feedback queue in particular is
closed at the data layer, so closing it does not depend on either.

## What this is not

- **Not a change to who may triage.** `feedback.triage` is already admin-only in
  the permission table and re-checked inside the RPC. Untouched.
- **Not a new permission scheme.** Every gate below names a key that already
  exists in `acc_permission`. Where no suitable key exists the gate is
  `roles: ["admin"]` rather than an invented one.
- **Not a rewrite of the sidebar.** `NAV` and `navigationForAccess` already work;
  the hub borrows them.
- **Not a redesign of the feedback screen.** It gains a second, narrower face for
  the person who filed a report. The triage view an administrator sees is
  unchanged.

## Architecture

### One catalog entry decides both the card and the door

`lib/domain/navigation.ts`:

```ts
export interface SettingsHubItem {
  href: string;
  title: string;
  description: string;
  roles?: AppRole[];
  anyPermissions?: string[];
  /** Shown instead when the viewer fails the gate but the route still has
   *  something for them. Absent means the card simply disappears. */
  fallback?: { title: string; description: string };
}
```

`settingsHubForAccess(access: NavigationAccess, groups = SETTINGS_HUB)` — pure,
same signature shape as `navigationForAccess`, reusing `canShowNavItem` so there
is one definition of "does this person pass a gate". An item that fails its gate
is dropped, unless it carries `fallback`, in which case its `title` and
`description` are swapped and it stays. A group left with no items is dropped.

The gate is read from the same entry by the server guard below. A card and its
door cannot disagree, because there is only one of them.

### The gates

| Card | Gate | Why this key |
|---|---|---|
| Company profile | `settings.manage` | admin-only, already the key for configuration |
| Companies | `roles: ["admin"]` | no permission key covers the register |
| Accounting periods | `roles: ["admin"]` | every control calls `adminGuard`; see below |
| Import from QuickBooks or Wave | `roles: ["admin", "accountant"]` | matches `canWrite` in its actions; see below |
| Users | `users.manage` | exact match |
| Permissions | `permissions.manage` | exact match |
| Approval policies | `settings.manage` | configuring a policy is not deciding one |
| Audit history | `audit.read` | admin + accountant + viewer, unchanged on purpose |
| Feedback triage | `feedback.read` + `fallback` | see below |
| Purchasing tolerances | `settings.manage` | no purchasing-configuration key exists |

Audit history stays visible to a viewer because `audit.read` says so today. That
is an existing decision about a different screen; this spec reflects it rather
than quietly reversing it.

Two gates were corrected during the final review, because the first draft named
a key that read well and enforced the wrong thing:

- **Accounting periods** was `period.close`, which an accountant holds. But every
  action on that screen calls `adminGuard()`, `PeriodsClient` gets
  `canEdit={isAdmin(role)}`, and `period.close` is seeded `is_enforced = false`.
  The gate would have opened a door onto controls that all refuse. Nobody but an
  administrator closes a period in this codebase, so the gate says so.
- **Import** was `settings.manage`, which is admin-only. Its actions guard with
  `isAdmin` for `chart_of_accounts` and `canWrite` — admin *or accountant* — for
  everything else, deliberately: "the chart of accounts is an administrator's to
  change; the rest is ordinary bookkeeping." An admin-only card would have hidden
  a screen an accountant may legitimately use, and left the door stricter than
  the mutation behind it, which is a false statement about the system.

The rule the corrections follow: **a gate must name what the server actually
enforces.** A gate looser than the mutation is a hole; a gate tighter than it is
a lie, and invites someone to loosen the mutation to match.

### The door

`lib/db/settings-access.ts` (new):

```ts
export async function requireSettingsAccess(href: string): Promise<void>
```

It looks the gate up in `SETTINGS_HUB` by `href` and on failure
`redirect("/settings?denied=<href>")`.

Role and permission keys come from a single resolver, `currentAccess()`, which
this module exports and `app/(app)/layout.tsx` is changed to call instead of
building `NavigationAccess` inline. Two copies of "what may this person do"
would be the same drift the catalog gate exists to prevent. It is wrapped in
React's `cache()`, so the layout and the page it renders share one query per
request rather than two. An `href` with no
catalog entry is a programming error and throws — a settings page that forgot to
register itself must fail loudly, not open quietly.

Each of the ten pages calls it as its first statement. `/settings/feedback` is
the one exception: it is open to everyone, because a reporter goes there to see
their own reports. Its narrowing happens inside the screen and in RLS.

`/settings` reads `denied` and shows one Alert naming the screen and the reason.
Redirecting someone with no explanation invites them to conclude the app is
broken.

### The data layer, which is what actually closes this

One migration:

```sql
update acc_role_permission
   set allowed = false
 where permission_key = 'feedback.read'
   and role <> 'admin';
```

No policy is edited, because every read path already has the right shape:

| Path | Predicate |
|---|---|
| `acc_feedback_report` select | `acc_has_permission('feedback.read') or reporter_id = auth.uid()` |
| `acc_feedback_attachment` select | `feedback.read` or the parent report is the viewer's |
| `storage.objects` / `feedback-screenshots` | `feedback.read` or the report naming that path is the viewer's |
| `storage.objects` / `feedback-attachments` | same |

Revoking the permission collapses all four to "your own", in one statement,
which is the strongest evidence that 0061 built them correctly and only the
grant was provisional.

One caveat, found in review and **not fixed here**: the two storage policies are
global objects held back from company schemas by `scopeOf()`, and they are pinned
to `public.` — `public.acc_has_permission(...)`, falling back to a lookup in
`public.acc_feedback_report`. So in a company whose schema is not `public`, that
fallback consults the wrong table and a reporter cannot open their own file.
That arrived with multi-company (0081) and this change neither causes nor worsens
it; `MyReportsClient` shows a file count and no download control, so nothing is
visibly broken today. It belongs in a separate multi-company storage fix. The
"all four collapse to your own" claim above is exact in `public` and, for the two
storage paths, only in `public`.

The comment at 0061 is superseded by the new migration's own comment explaining
why the test period ended. The old file is not edited — it is history.

**`acc_feedback_queue` is the exception and must be treated as one.** It is
`security definer` and its only filter is `where acc_has_permission('feedback.read')`,
so for a non-administrator it returns **zero rows**, not "their own". It also
returns `reporter_email`. Therefore the reporter's view must not be built on it.
Nothing about the function changes; the screen stops calling it for people who
cannot use it.

## The feedback screen, for two audiences

`page.tsx` already resolves `feedback.triage`. It gains `feedback.read` from the
same source and passes both down:

- **With `feedback.read`** (administrator): exactly today's screen. Queue from
  `acc_feedback_queue`, every report, priority order, triage controls live or
  inert according to `canTriage`.
- **Without it**: the header reads *"My reports"*, described as the reports you
  filed and where each one stands. `listFeedbackReports` and
  `listFeedbackAttachments` return only that person's rows because RLS says so —
  no client-side filtering, which would be a second definition of the rule.
  `listFeedbackImprovements` is not called at all. Triage controls are absent,
  not disabled: a control that exists only to be refused is noise.

The hub card follows the same split through `fallback`:

| Viewer | Title | Description |
|---|---|---|
| holds `feedback.read` | Feedback triage | Bug reports and suggestions filed by staff, with screenshots. |
| does not | My reports | The bug reports and suggestions you filed, and where each one stands. |

Filing a report is unchanged. `ReportDialog` is reachable from everywhere and
insert is governed by its own policy, which this spec does not touch.

## Error handling

The hub filter is presentation. If `permissionKeys` is `null` — the layout could
not read `acc_role_permission` — `canShowNavItem` already treats permission gates
as passed, so a database hiccup shows too many cards rather than locking an
administrator out of their own settings. `roles` gates still apply. This matches
what the sidebar does today and is deliberate: the door and RLS are behind it.

`requireSettingsAccess` is the opposite and must fail closed. If it cannot
resolve a role, it redirects. A guard that opens when it is confused is not a
guard.

A reporter who has filed nothing sees an empty state that says so, not an error.

## Testing

Unit, in `tests/unit/`:

- `settingsHubForAccess` for each role over the whole catalog: an administrator
  sees ten cards; a viewer sees Audit history and *My reports* and no others;
  a sales user sees *My reports* only.
- `fallback` swaps title and description rather than dropping the card, and an
  item with no `fallback` that fails its gate is gone.
- A group whose every item is hidden does not render as an empty heading.
- `permissionKeys: null` hides nothing that is gated by permission, and still
  hides what is gated by role.
- Every `href` in `SETTINGS_HUB` names a permission key that exists in the
  permission catalog, or uses `roles` — this is the test that stops a future
  gate from being a typo that silently hides a screen from everyone.
- The existing test asserting every `/settings/*` route appears in the catalog
  keeps passing, and gains a companion: every such route calls
  `requireSettingsAccess`, except `/settings` itself and `/settings/feedback`.
  Both exceptions are named in the test, so adding a third is a deliberate edit
  someone has to justify rather than an omission nobody notices.

Behavioural, over HTTPS as real signed-in users — a rollback-only harness in
`scripts/`, following `verify-settle-from-bank.mjs`:

- As an accountant, after the migration: reading `acc_feedback_report` returns
  only rows they filed; `acc_feedback_queue` returns zero rows; a screenshot
  belonging to someone else's report is not readable from storage.
- As an accountant, their **own** report and its attachment remain readable —
  the clause that makes *My reports* work is proven, not assumed.
- As an administrator: every report still readable, `acc_feedback_queue` still
  returns the priority-ordered queue, triage still moves a report.
- Requesting `/settings/users` as a viewer redirects to `/settings?denied=…`.

`scripts/smoke-pages.mjs` over the built server, because ten pages change.

The migration must reach every company schema — `scripts/migrate.mjs` loops the
register, and `acc_role_permission` is per-company, so the revocation applies in
each set of books rather than only in `public`.
