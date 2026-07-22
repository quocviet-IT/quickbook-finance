# HOLY GRAIL CODING GUIDEBOOK
### Rules of engagement for working with an AI coding agent (Claude Code / Cowork / equivalent)

**Purpose:** This is the rulebook you load into an AI agent (paste into each project's `CLAUDE.md`) so it self-enforces, self-verifies, and doesn't quietly break what already works. The AI can't read your intent — it only reads this file. If a rule isn't written down here, it doesn't exist as far as the AI is concerned.

**Core principle running through everything:** *"Deployed is not the same as working. Looks finished is not the same as finished."* Every section below exists to close one of two holes: (1) the AI is overconfident — it says "done" without ever verifying, or (2) the AI silently rebuilds — it writes a new copy of logic instead of reusing what exists, creating two sources of truth that drift apart.

---

## PART 01–02 · Plan & Doctrine

**Principle:** Write the spec before writing the code. AI codes faster than a human can think — without a spec, it "thinks in code," and you pay for that later by reading every line just to figure out what it decided to do.

**Mandatory rules:**
1. Any task expected to take >30 minutes needs a short spec first (goal, input/output, constraints, definition of "done").
2. The AI must paraphrase the spec back in its own words before starting — if the paraphrase is wrong, the spec wasn't clear enough.
3. For changes touching money or customer data: the spec must state **the single source of truth** for every figure (e.g. "the invoice total is computed in exactly one place").
4. The AI is not allowed to make business-rule decisions unilaterally — it can propose, but the human decides.

---

## PART 03–04 · Setup & Foundation

**Principle:** A clean stack from day one is cheaper than cleanup later. A messy foundation compounds every mistake on every subsequent task.

**Project setup checklist:**
- [ ] TypeScript `strict: true` turned on from the first commit (never "temporarily" off — it will never get turned back on)
- [ ] A `shared/` folder for business logic used by both frontend and backend
- [ ] `.env.example` lists every required environment variable, with no real values
- [ ] Test runner installed and configured from day one (not "added after the first bug")
- [ ] `.gitignore` excludes `.env`, `node_modules`, build artifacts

---

## PART 05 · CLAUDE.md — the mandatory rulebook

**Principle:** If the AI reads only one file, it must be this one. Without it, the AI has to guess — and guessing wrong is the root cause of most avoidable bugs.

**CLAUDE.md must contain all 5 sections** (missing any one means the file doesn't meet the bar):

```markdown
## 1. Run commands (exact, copy-pasteable)
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Typecheck: `tsc --noEmit`

## 2. How to verify (mandatory before claiming "done")
- Run build + test + lint, zero errors
- For UI changes: capture a screenshot and compare
- For money logic: run the specific test case and paste the output

## 3. Architecture & where logic lives
- Business rules live in: [backend/src/lib/]
- DO NOT re-implement a rule anywhere else (see Part 14)

## 4. Gotchas / past mistakes (updated continuously)
- Timezone bug: toISOString() shifts dates back one day at UTC+7 — format from local parts instead
- Never trust a client-sent deposit flag — always recompute server-side

## 5. Things NOT to do
- Never force-push to main
- Never disable RLS "just to test faster"
- Never duplicate business logic on the frontend
```

**Rule:** Every time an AI fixes a bug that has occurred before, it must add a line to the "Gotchas" section itself — this is a mandatory accumulation mechanism, not an optional courtesy.

---

## PART 06 · Skills — reusable playbooks

**Principle:** Anything repeated more than twice should become a "skill" (a packaged procedure) rather than something the AI reinvents from scratch each time.

**Minimum required skills:**
- **verify-build**: one command that runs build + test + screenshot and returns pass/fail with evidence
- **security-check**: runs the DB advisor (e.g. Supabase `get_advisors`) and lists tables missing RLS
- **monthly-architecture-review**: a recurring prompt that audits for duplicated logic (see Part 14)

**Rule:** A skill must have a clear input/output and its own test — a skill that can't verify itself isn't trustworthy.

---

## PART 07 · Enforcement — don't just remind, block

**Principle:** There are three levels of forcing AI compliance, weakest to strongest:

| Level | Mechanism | Reliability |
|---|---|---|
| 1. Advisory | Written in CLAUDE.md: "please run tests" | Low — can be skipped |
| 2. CI Pipeline | GitHub Actions runs test/lint on every push | Medium — catches issues after the push |
| 3. Pre-commit hook | Blocks the commit if test/typecheck fails | High — cannot be "forgotten" |

**Mandatory rule:** Any project touching money or customer data must have at least Level 2 (CI). No exception for "we're on a deadline" — the deadline is exactly why CI exists, not a reason to skip it.

---

## PART 08 · Daily working loop

**Standard cycle for every task:**
1. Read CLAUDE.md → paraphrase the spec → confirm with the user if anything is ambiguous
2. Code on its own branch, never directly on `main`
3. Self-verify (build/test/lint) — paste the actual results, don't just claim "done"
4. Commit with a message describing *why*, not just *what*
5. If a past bug recurs, update the "Gotchas" section in CLAUDE.md

---

## PART 09 · Context ceiling / file size

**Principle:** The longer a file, the more likely the AI "forgets" the top while editing the bottom — producing internally contradictory logic in the same file.

**Hard thresholds:**
- Any component/file over 400 lines → must be split
- Any component holding more than 10 separate state variables → separate the data layer from the view layer
- No single file should simultaneously fetch data, compute business logic, and render UI — one responsibility per file

---

## PART 10 · Verification — no blind confidence

**Core principle:** *"If you don't give the AI the ability to verify its own results, you lose most of the value of AI — because you become the test suite."*

**Mandatory rules:**
1. The AI must not report "done" unless it has actually run the verification command and pasted real output — not a predicted result.
2. Any money-calculation logic needs at least one test with a concrete input/output — never verified by "looks right in the UI."
3. Tests must run against the **real code path** (the real server), not a separate mock — mocks may fake *data*, never *rules*.
4. Swallowed errors (a try/catch that silently discards the error, or code that reads `{count}` while ignoring `{error}`) are a serious violation — every error must surface; nothing should render a fake "0" as if everything is fine.

---

## PART 11 · Automation — safe by default

**Principle:** Unsupervised automation (cron jobs, webhooks, scheduled tasks) is where silent failures do the most damage — nobody is watching it fail.

**Mandatory rules:**
1. Every automated job must log: when it ran, success/failure, how many records it touched.
2. The endpoint that triggers a job must require a secret — and if that secret isn't configured, it must **default to refusing the request** (fail closed), never default to allowing it (fail open).
3. Before enabling a live automation, run it in "dry-run" mode at least once and review the log.

---

## PART 12 · Security

**The question every new feature must be able to answer "no" to:** *"Can user A see or modify data belonging to user B?"*

**Hard rules:**
1. Every database table must have an access policy (RLS or equivalent) — no table is open by default. No policy = not shippable.
2. If the backend uses a service-role/master key that bypasses RLS, **the backend itself must check ownership** before every mutation — never assume "RLS already handled it" when the server is the thing routing around RLS.
3. Payment, login, and customer-data routes **require human review before go-live** — the AI does not merge these on its own.
4. Never log PII (email, phone, message content) in plaintext to console/server logs.
5. Errors returned to anonymous users must be generic ("something went wrong") — never leak internal table/column names or stack details.
6. Any key or password that has ever appeared in a chat, log, or commit must be treated as **already compromised** and rotated immediately — no exception for "probably nobody saw it."

---

## PART 13 · Spending & Caveman — simplicity as discipline

**Principle:** A more complex solution isn't a better one — it's technical debt paid on an installment plan. "Caveman" means: pick the simplest thing that correctly solves the actual problem, not the one with extra layers "in case we need it later."

**Rules:**
1. Don't add a new dependency if the problem can be solved with 20 lines of existing code.
2. Track API cost (tokens, requests) per task — if a task costs unusually much, stop and ask why before blindly optimizing.
3. Prefer a solution that's easy to delete over one that's "flexible" but hard to remove.

---

## PART 14 · Rot & AI Slop — preventing decay

**This is the most important section.** Symptom #1 of rot: **the same logic implemented twice, in two different places, quietly drifting apart.**

**Why it happens:** AI codes very fast, and when asked to build a "demo/mock mode," it often re-implements the entire business rule by hand instead of reading and reusing the original — because writing it fresh is faster than understanding existing code. The result: two "brains" taught the same business logic, with nobody keeping them in sync.

**Hard rules — non-negotiable:**
1. **One business rule = one implementation.** If it needs to run on both frontend and backend, put the logic in `shared/` and have both sides import it — never hand-write a second copy.
2. Demo/mock mode may only fake **data** (return canned records), never fake **rules** (never re-implement a state machine, a pricing formula, or validation logic).
3. Before writing a new function, the AI must search for an equivalent that already exists (grep/search by business term) — if one exists, reuse or refactor it, don't create a parallel copy.
4. Run a **monthly architecture review prompt**: ask the AI to list every pair of files that might implement the same business logic, compare the logic, and report where they've drifted.
5. A control (button, setting) with no real effect (e.g. a policy field that's edited but the code still hardcodes the old value) is a serious form of rot — either make it real or remove it; never let it stand as a lie.

---

## PART 15–16 · Judgement & Process — git and docs as the safety net

**Principle:** *"A commit is a save point."* Uncommitted work is an unsaved game session — one crash away from zero.

**Mandatory rules:**
1. Don't work for long stretches without committing — commit frequently, at the boundary of each complete unit of work.
2. **Never `git push --force` to `main`** without first viewing the diff between local and remote, and confirming which branch holds the version actually running in production.
3. Any branch untouched for more than 10–14 days without being merged or deleted → treat as clutter, prune weekly.
4. The master spec doc must be refreshed after any major audit or review — a spec that's staler than the code is worse than no spec, because it misleads the next session (including the AI's own).
5. Before cleaning up any worktree or branch, confirm every important file has actually been `git add`ed, committed, and pushed to remote.

---

## BONUS · Mobile & Accessibility

**Minimum bar (not "nice to have" once real users exist):**
- Every data table must scroll horizontally on narrow screens — no clipped columns
- Every drag-and-drop action must have a button/keyboard alternative
- Layouts must not be fixed-width — use a responsive shell

---

## Severity ladder (for audits)

| Level | Meaning | Action |
|---|---|---|
| 🔴 Blocker | Affects money, customer data, or risks losing work | Fix before any real customer touches it |
| 🟠 High | Causes visible breakage, erodes trust | Fix this month |
| 🟡 Medium | Technical debt, not yet actively harmful | Plan for it |
| ⚪ Low | Cleanup, cosmetic | Do when time allows |

---

## How to use this file

1. Copy all or the relevant parts into `CLAUDE.md` at the root of each project.
2. New project: Parts 01–10 plus Part 16 are enough for a safe start.
3. Any project touching real money or real customers: Part 12 (Security) and Part 14 (Rot) must be applied in full.
4. Schedule the "monthly architecture review" (Part 14, item 4) — it's the one mechanism that catches duplicated logic *before* it becomes a blocker, like the tax/pricing drift found in the CRM audit.
