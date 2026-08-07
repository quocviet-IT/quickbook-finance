# Telling people what changed

Date: 2026-08-07

## Where this came from

> Cập nhật xong không ai biết đã đổi gì. Nhân viên tưởng app hỏng khi giao diện đổi.
>
> (*After an update nobody knows what changed. Staff think the app is broken
> when the interface changes.*)

That is not a request for documentation. Somebody opened a screen they use every
day, found a control in a different place, and concluded the software was
faulty. The fix has to reach them where they are, not wait in a page they would
have to think to visit.

## What exists today

The only version marker anywhere in the product is `GUIDE_VERSION = "1.0"` in
`lib/domain/system-guide.ts`, rendered as a tag in the guide drawer. It names the
*guide*, not the release. `package.json` says `0.1.0` and is never displayed.
There is no changelog.

Meanwhile the last eighteen commits shipped four slices of import work, Saved
Reports, screenshots in the guide, a feedback screenshot fix and a company name
fix. None of it was announced to anyone.

## Goal

A person who signs in after a release sees, without looking for it, a short list
of what changed and where. A person who wants the whole history can read it in
the same place. Nothing blocks their work.

## Not in scope

- **No release automation.** Entries are written by hand, in the language of the
  screen, when the work ships. A generated list of commit subjects would be
  engineering noise.
- **No email or notification centre.** One badge, one panel.
- **No database.** See *Remembering what was read*.

## Architecture

### The record — `lib/domain/changelog.ts`

Typed data, like `GUIDE_FLOWS`, so a test can hold it to account:

```ts
export type ChangeKind = "added" | "changed" | "fixed";

export interface ChangeEntry {
  kind: ChangeKind;
  /** What a user notices, in the words they would use. */
  title: string;
  /** Why it changed, or what to do differently. */
  detail?: string;
  /** The screen it happened on. Proven to exist by a test. */
  route?: string;
}

export interface Release {
  version: string;   // "1.1"
  date: string;      // "2026-08-07"
  /** One line: what this release is about. */
  headline: string;
  changes: ChangeEntry[];
}

export const RELEASES: Release[]        // newest first
export const APP_VERSION: string        // RELEASES[0].version
export function compareVersions(a: string, b: string): number
export function releasesSince(seen: string | null): Release[]
```

`GUIDE_VERSION` is replaced by `APP_VERSION`. One number for the product, shown
where the guide's number used to be — a person saying "I'm on 1.1" should mean
the whole application, not one drawer.

**Version comparison is by part, not by string.** `"1.10" < "1.9"` is true of
strings and false of releases, and this is the kind of bug that surfaces a year
later when nobody remembers why the panel stopped appearing. A test names that
exact pair.

### Remembering what was read — `lib/client/release-notes.ts`

The browser remembers, in `localStorage`, exactly as
`lib/client/launcher-preferences.ts` remembers whether the help cluster is
collapsed. No table, no migration, no accounting data.

The cost is that the panel appears once per browser. For an internal team that
is a second of reading, not a defect, and it buys the feature with no schema
change at all.

**The server snapshot says "everything has been seen".** The server cannot know
what this browser has read, and a badge rendered into the server HTML would
appear on every page load and then vanish — a flicker that trains people to
ignore it. `useSyncExternalStore` renders no badge on the server and lets the
client correct it, which is the same shape `launcherCollapsedServerSnapshot`
already uses.

A browser with nothing stored has read nothing, so it sees every release. Today
that is two short entries.

### Telling them — the badge and the panel

- The **Guide** button in the floating help cluster carries a dot while any
  release is unread. It does not block anything.
- Opening the drawer shows **What's new** above the notices and the flows,
  listing the unread releases with their changes; each change that names a route
  links to it.
- Reading marks them read: the dot clears when the panel has actually been
  shown, not when the button was merely hovered.
- Below it, **Show every release** reveals the full history in the same drawer.
  One place to look, whether the question is "what changed yesterday" or "when
  did that tab appear".

### Files

| File | Responsibility |
| --- | --- |
| `lib/domain/changelog.ts` | Create. The releases, the version, and the two functions over them. Pure. |
| `lib/client/release-notes.ts` | Create. What this browser has read, as an external store. |
| `components/guide/WhatsNewPanel.tsx` | Create. Renders releases; used for both the unread list and the full history. |
| `components/guide/SystemGuideDrawer.tsx` | Modify. Show the panel, mark read, and use `APP_VERSION`. |
| `components/assistant/AssistantLauncher.tsx` | Modify. The dot on the Guide button. |
| `lib/domain/system-guide.ts` | Modify. `GUIDE_VERSION` re-exported from `APP_VERSION`. |

### What 1.1 says

Written from what a person sees, not from commit subjects, and grouped:

- **Added** — the General ledger tab that reads a Wave export whole; the
  Transactions tab; Saved Reports; creating a company from inside the
  application; a free-text category on bank transactions.
- **Changed** — the guide now shows a picture of each import step; the Companies
  list no longer shows the key and the schema.
- **Fixed** — a feedback screenshot filed from any company but the first is
  stored instead of silently dropped; a corrected company name now reaches the
  company switcher.

A short **1.0** entry records the first release, so the history does not begin
with a blank.

### Error handling

`localStorage` throws in a private-mode browser. Reading falls back to "has seen
everything" — a dot that cannot be cleared would be worse than no dot — and
writing is allowed to fail silently, because the panel has already served its
purpose by being read.

### Testing

**Unit — `tests/unit/changelog.test.ts`:**

1. `releasesSince(null)` returns every release, newest first.
2. `releasesSince` of an older version returns only what came after it.
3. `releasesSince(APP_VERSION)` returns nothing.
4. `releasesSince` of a version not in the list returns everything — an unknown
   marker means we cannot prove they read anything.
5. `compareVersions("1.10", "1.9")` is positive.
6. Versions are unique and strictly descending.
7. Every `date` is `YYYY-MM-DD`, and every `route` is a page the app serves —
   checked against the route folders, the way `tests/unit/system-guide.test.ts`
   already checks the guide.
8. Every release has a headline and at least one change; every change has a
   non-empty title.

**Gates.** `npm test`, `npm run typecheck`, `npm run lint`,
`npm run security:check-source`, `npm run build`, and `scripts/smoke-pages.mjs`
against the built server.
