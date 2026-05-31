# Session recap — 2026-05-31: tunable Pip behavior + SP3 live verification

**Branch:** `main` (all work committed and pushed to origin)
**HEAD at start:** `604738e` · **HEAD at end:** `1ef6a72`
**14 commits.** All five subsystems already built; this session added a new
tuning capability to SP3, tuned Pip's tutoring behavior, fixed two live bugs, and
finally verified the SP3 voice loop with a real human mic run.

## What we set out to do

The opening ask was to make Pip more inquisitive / make its behavior easy to
tailor. Through brainstorming this resolved to: **externalize Pip's voice system
prompt into an editable, hot-reloaded file** so behavior can be tuned by editing
prose, not TypeScript.

## What shipped

### 1. Tunable `study-buddy.md` (brainstorm → spec → plan → build)

Pip's entire voice system prompt moved out of a hardcoded TS array into
**`apps/server/study-buddy.md`** — an editable markdown template with `{{token}}`
placeholders for live per-session data. Key design decisions:

- **Hot-reloaded:** the server reads the file fresh at each session start. Because
  `docker-compose.yml` bind-mounts `./apps/server`, editing the file on the host
  changes the next session with **no rebuild / restart** (proven live with a
  PROBE-MARKER edit: `NO-MARKER → HAS-MARKER` in the running container).
- **Tokens:** `{{childName}}`, `{{grade}}`, `{{subject}}`, `{{topic}}`,
  `{{intro}}`, `{{traitLean}}`. Substituted at session start; unknown tokens left
  literal.
- **Headings stripped** before sending to Gemini (markdown `##` are for human
  readability; ATX-heading regex requires a space, so `#1 rule` survives).
- **Fallback:** an in-code `BUILTIN_TEMPLATE` is used if the file is
  missing/unreadable, and is kept **byte-identical** to the file (a drift-guard
  test fails loudly otherwise).

Implementation lives in `apps/server/src/voice/systemPrompt.ts`
(`BUILTIN_TEMPLATE`, `renderTemplate`, `loadTemplate`, async
`buildSystemInstruction`); the relay `await`s the now-async builder. Spec +
plan under `docs/superpowers/{specs,plans}/`. Built via subagent-driven
development (implementer + spec-review + quality-review per task).

### 2. Pip behavior tuning (initially an experiment, then promoted to baseline)

Edited `study-buddy.md` to make Pip discover-and-assess before guiding:
- A **discover-and-assess opening** — ask what the child is learning (class
  lesson / homework / project), probe what they already know.
- A **9-step session flow** — gather what they know → offer to let them read
  material → guide with questions → ask for more → (if stuck) research and report
  → child attempts an answer → Pip summarizes with corrections → closing question
  asks the child to **summarize what they understand**.

This started as a file-only experiment (in-code `BUILTIN_TEMPLATE` left as the old
baseline, tests loosened to tolerate divergence), then on request was **promoted
to baseline**: `BUILTIN_TEMPLATE` brought back byte-identical to the file, the
drift-guard restored, and the brittle full-prompt byte fixtures replaced with
behavioral-invariant tests.

### 3. Two live bugs fixed (`dc01c55`)

Observed in the running app and fixed:
- **Pip re-introduced itself every subject** ("Hello! I'm Pip…"). Root cause:
  each session is memoryless. Fix: `countSessionsForChild` (counted before the new
  session row is inserted) drives a `firstSession` flag and the `{{intro}}` token —
  self-intro only on a child's first-ever session, explicitly suppressed after.
- **Stray `"Text "` prefix** on Pip's transcript bubbles ("Text That's it!"). This
  was an upstream Gemini native-audio transcription artifact our pipeline forwarded
  verbatim (confirmed by tracing the pipeline — our code was clean). Fix: a pure
  `stripTextArtifact()` in the new `apps/server/src/voice/transcript.ts`, applied
  only to the first delta of each Pip turn (re-armed on interrupt) so a genuine
  later "Text" survives.

### 4. SP3 live mic run — VERIFIED (`1ef6a72`)

A human mic run against the live stack confirmed the full audio loop end to end
(browser ⇄ Hono WS ⇄ Gemini Live, real speech in/out, live transcript). All four
checks passed:
- ✅ No re-introduction (greets by name)
- ✅ No "Text " prefix
- ✅ Discover-and-assess flow followed
- ✅ **End/Back responsive while "Connecting…"** — resolves the long-open SP3
  question (the earlier inertness was a Playwright mic-hang artifact, not a bug)

Docs flipped from 🟡 partial → ✅ verified in `CLAUDE.md` and
`SP3-manual-smoke.md`.

## Verification posture

- Full server suite green throughout (ended at **83 pass / 0 fail**); typecheck
  clean; byte-identity of file ↔ `BUILTIN_TEMPLATE` checked.
- Every behavior edit confirmed live in the running container (hot-reload).
- Browser automation done via Playwright (per a standing preference recorded this
  session — never Claude-in-Chrome).

## Process notes / lessons

- Diagnose the **layer** before fixing: the "Text" bug looked like a prompt issue
  but was a transcript-pipeline artifact; the fix belonged in the relay, not the
  prompt.
- "Promote experiment → baseline" is a **test-philosophy switch**, not just a
  content copy: diverge-tolerant tests had to be flipped back to drift-intolerant.
- A speculative unprompted reword of `intro()` was made and then reverted once the
  live run confirmed the existing wording already worked — keep confirmed-good
  baselines unless asked.

## Where things stand

Every subsystem's core path is now verified: SP1 ✅, SP2 ✅, **SP3 ✅ (live)**,
SP4 ✅ (dev path), SP5 🟡 (only the live Stripe payment click-through tabled).
Remaining gaps are all external-credential-gated or explicitly deferred
(mid-session reconnect, soft cap, recap/transcript persistence).

### Natural next steps (not started)

- The deferred **Pip session-recap** product feature (auto-generated child-facing
  recap after a session) — would need its own brainstorm → spec → plan → build.
- Transcript persistence (currently transcripts are not stored).
- The tabled SP5 live Stripe payment smoke and SP4 Google OAuth completion (both
  need real external creds).
