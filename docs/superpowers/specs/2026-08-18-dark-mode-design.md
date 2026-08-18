# Light and dark theme — design

Date: 2026-08-18

## What was asked

A light/dark switch for the whole system. Professional, and it must not break
the layout.

## What the codebase already says about this

The second half of that sentence is the whole problem, and the repository has
already written down why. `tests/unit/no-hardcoded-color.test.ts` allows
exactly two files to hold colour, and says why they were left:

> Converting 3,300 lines of stylesheet is its own piece of work with real
> visual regression risk, so it was left whole rather than done by halves.

Measured today:

| | |
|---|---|
| `.tsx` and components | **0** hard-coded hex — the token wave cleared them |
| `app/globals.css` | 3,408 lines, **257 hex, 93 distinct**, plus 17 `rgba()` |
| `components/work-areas/WorkAreaOverview.module.css` | 84 hex |
| Lines of CSS reading `var(--ob-*)` | **0** — the variables are emitted and nothing consumes them |
| `PALETTE` | 15 colours, so roughly 78 of the 93 are outside the system |

Ant Design ships `theme.darkAlgorithm`, and flipping it in `app/providers.tsx`
turns every Ant component dark in one line. That is not a shortcut here: the
stylesheet paints over those components with 257 fixed light colours — page
background, card, filter bar, table chrome, sider. The result is a dark Ant
Design shell under a light stylesheet: white text on white, borders gone.
Exactly the failure the request rules out.

**So dark mode is the globals.css conversion that was deliberately deferred.**
There is no honest short version.

## Decisions

| Question | Decision |
|---|---|
| Scope | The whole app. A half-dark app is worse than a light one |
| Default | Follow the operating system (`prefers-color-scheme`) |
| Control | Three states — Light / Dark / System — in the top bar |
| Brand teal on a dark background | A lighter teal for dark. `#0f766e` on a dark surface is about 2.3:1, well under AA's 4.5:1 |
| Light mode | **Must not move by a pixel.** This is both the goal and the gate |

## The governing principle

The light theme works today. A token conversion that shifts it has traded a
feature for a defect. So "light is unchanged" is not a hope — it is a
screenshot comparison run after every tranche.

## Order of work

Dark is switched on **last**, so `main` is never half-converted.

| Step | Work | Gate |
|---|---|---|
| 1 | Verification harness: baseline screenshots of all 56 routes in light, and the dark leftover detector below | No product code changes |
| 2 | `tokens.ts` grows a light **and** dark value per semantic token; emit `:root` and `:root[data-theme="dark"]` | Existing token tests stay green |
| 3 | Convert `globals.css` in tranches — shell, tables, filter bar, cards, forms | After each tranche: 56 light screenshots against the baseline |
| 4 | `WorkAreaOverview.module.css`, and chart series colours for a dark canvas | As above |
| 5 | Plumbing: `data-theme` on `<html>`, an inline no-flash script, stored preference, the toggle, Ant's algorithm | |
| 6 | Full sweep in both themes; delete both allowlist entries | Leftover detector clean |

## The leftover detector

Fifty-six routes in two themes cannot be checked by eye, and eyes are exactly
what miss one forgotten hex on a screen nobody opened. A Playwright script
walks the DOM of every route in dark mode and reports:

- any element whose computed background is still light — the mechanical
  signature of a hex the conversion missed
- any text/background pair below WCAG AA
- any element that sets a background without setting a colour, which is where
  "white on white" comes from

It is re-runnable, so it guards the conversion afterwards rather than only
during it.

## Known risk, and how it is handled

Ninety-three colours collapsing onto a smaller semantic set will merge shades
that differ by bytes and not by sight — `#f8fafc` against `#f6f7f9`, for
instance. Step 3's screenshot comparison finds exactly those, because they are
the only places light can move. Each one is reported and decided, never merged
silently.

The plumbing in step 5 touches `providers.tsx` and `layout.tsx`, which every
page renders through. That is why it is late: colour is settled first, and the
switch is the last thing added.

## Out of scope

Per-company or per-user theme storage on the server. The preference lives in
this browser, like the column widths shipped in 1.29 and 1.31.
