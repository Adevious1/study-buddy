# Tunable Pip behavior via `study-buddy.md`

**Date:** 2026-05-31
**Status:** Design approved, pending implementation plan
**Scope:** Small, self-contained refactor of the SP3 voice subsystem. No schema,
API, or UI changes; no new dependencies.

## Goal

Move Pip's personality and tutoring rules out of hardcoded TypeScript into a
human-editable, version-controlled markdown file. Editing the file changes Pip's
behavior on the **next voice session** — no rebuild, no container restart, no
redeploy. The point is to let a non-developer (or the developer, quickly) tune
*how inquisitive Pip is* and how it talks, by editing prose instead of code.

## Background

Today all of Pip's behavior is a single function,
`apps/server/src/voice/systemPrompt.ts` → `buildSystemInstruction()`. It returns
a hardcoded array of eight sentences (persona, the Socratic rule, learning-style
lean, language, tone, off-topic handling, and the learning-signal tool
instruction), joined with newlines. `apps/server/src/voice/relay.ts:76` calls it
once at session start (`buildPrompt`), interpolating live values pulled from the
DB: child name, grade, subject, topic, and learned traits.

So "Pip's personality" is lines 22–30 of one file. Externalizing it means
replacing that array with a template loaded from a markdown file, while the
dynamic DB-sourced values continue to be injected at runtime.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Edit + load model | **Checked-in file, hot-reloaded** — read fresh at each session start |
| File content | **Faithful port, reorganized into labeled, tunable sections** — no behavior change |
| Templating | **Placeholder tokens in the file** (`{{childName}}` etc.), substituted at session start |
| Markdown headings | **Stripped before sending** — headings are for human readability; prompt text stays byte-identical to today's |
| Failure mode | **Fall back to a built-in default** — missing/unreadable file logs a warning and uses the in-code template |

## File location

**`apps/server/study-buddy.md`**

This location is required for hot-reload: `docker-compose.yml:42` bind-mounts
`./apps/server` into the server container, so the file edited on the host *is* the
file the running server reads. A repo-root file would **not** hot-reload because
the root is not mounted. The path is resolved relative to the server's working
directory / module, and is overridable via the `STUDY_BUDDY_PROMPT_PATH`
environment variable (useful for tests and alternative deployments).

## File structure

Every instruction that exists today is preserved verbatim, regrouped under
headings so it is obvious where to edit. Placeholder tokens mark where live data
lands.

```markdown
# Pip — Study Buddy Behavior

## Persona
You are Pip, a warm, patient, encouraging tutor for {{childName}}, a grade {{grade}} student.
You are helping with {{subject}} — specifically "{{topic}}".

## Socratic Rules (most important)
Guide with questions and small hints. NEVER state the final answer.
If {{childName}} is stuck, break the problem into one smaller step and ask again.

## Learning Style
{{traitLean}}

## Tone
Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.

## Language
Always speak and listen in English (US). If {{childName}} uses another language or you
mishear, gently continue in simple English.

## Staying on track
If {{childName}} goes off-topic or seems upset, gently steer back. Do not lecture.

## Learning-signal tool (do not mention to the child)
When you notice {{childName}} responding well to a way of learning — drawing/pictures =
visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it
through = auditory — call the note_learning_signal tool. Keep talking naturally and never
mention the tool.
```

### Tokens

The only content that must not be deleted. Substituted at session start:

| Token | Source | Notes |
|---|---|---|
| `{{childName}}` | `children.name` (fallback `"friend"`) | appears several times |
| `{{grade}}` | `children.grade` (fallback `3`) | |
| `{{subject}}` | display name from `SubjectKind` (e.g. `math` → `Math`) | |
| `{{topic}}` | the session topic string | |
| `{{traitLean}}` | computed sentence from the child's top trait, or empty string | see below |

`{{traitLean}}` reproduces today's logic exactly: take the highest-scoring trait,
emit `"{{childName}} tends to learn best through {label}; lean into that when it
helps."`; if the child has no traits yet, it expands to an empty string and the
line is removed (matching the current `.filter(Boolean)` behavior).

### Headings are stripped before sending

Headings (`# Pip — Study Buddy Behavior`, `## Persona`, etc.) exist in the file
**for human readability only**. `renderTemplate` removes markdown heading lines
(lines whose first non-space character is `#`) before the instruction is sent to
Gemini. After stripping headings and collapsing the resulting blank lines, the
prompt text is **byte-identical** to today's newline-joined output. This makes the
file-vs-prompt distinction explicit: you read structure, Pip reads the same plain
instruction it gets today.

## Code changes

A single file is rewritten: `apps/server/src/voice/systemPrompt.ts`. The public
API (`buildSystemInstruction`, `SystemPromptInput`) is preserved, so `relay.ts`
changes by one keyword.

- **`BUILTIN_TEMPLATE`** — a module constant holding the markdown template above
  (the same text shipped in `study-buddy.md`). Serves as both the fallback and the
  canonical reference for what the file should contain.
- **`loadTemplate(): Promise<string>`** — reads `study-buddy.md` fresh on each
  call (this is the hot-reload). Path from `STUDY_BUDDY_PROMPT_PATH` or the default
  relative location. On any read error: `console.warn(...)` and return
  `BUILTIN_TEMPLATE`. Reading fresh every session is intentional and cheap (a few
  KB once per session start).
- **`renderTemplate(tpl: string, values: Record<string, string>): string`** —
  replaces each `{{token}}` with its value, strips markdown heading lines (first
  non-space char `#`), and collapses the blank lines left by stripped headings and
  an empty `{{traitLean}}`. Unknown/misspelled tokens are left literal (per the
  chosen fall-back-not-strict failure mode). The result is plain newline-joined
  instruction text, byte-identical to today's output for the built-in template.
- **`buildSystemInstruction(input): Promise<string>`** — computes derived values
  (subject display name, `traitLean`), loads the template, renders it, trims. Now
  `async`. `relay.ts:76` already does `const systemInstruction = await
  buildPrompt(...)` and `buildPrompt` already `return`s the call, so the only
  change in `relay.ts` is adding `await`/making the helper return the awaited
  value — effectively one keyword.

`SystemPromptInput` (childName, grade, subjectKind, topic, traits) is unchanged.

## Failure mode

Missing, unreadable, or permission-denied file → log a warning and use
`BUILTIN_TEMPLATE`. A bad edit (or a deploy that forgot to ship the file) never
breaks voice sessions. Unknown tokens from a typo (e.g. `{{grdae}}`) pass through
to Gemini literally rather than failing the session; the operator notices the
stray token in the transcript/behavior and fixes the file.

## Testing

`apps/server` unit tests (run via `cd apps/server && bun test`):

1. **Faithful-port test** — `buildSystemInstruction` over a known input (with
   traits), rendering the built-in template, produces output **exactly equal** to
   the previous hardcoded `buildSystemInstruction` result (headings stripped, all
   tokens resolved, documented order). Locks in "behavior unchanged" by byte
   equality, not just content presence.
2. **Token substitution test** — all five tokens resolve from a sample input;
   `{{traitLean}}` is non-empty with traits and the line is absent with no traits.
3. **Unknown-token passthrough test** — `renderTemplate` leaves an unrecognized
   `{{token}}` literal (documents the non-strict choice).
4. **Fallback test** — an unreadable `STUDY_BUDDY_PROMPT_PATH` causes
   `buildSystemInstruction` to fall back to `BUILTIN_TEMPLATE` (assert a known
   sentence still appears) and does not throw.

## Verification before "done"

- `cd apps/server && bun run typecheck` — clean.
- `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test` — green
  (DB-touching suites need the throwaway Postgres on 5433; the prompt tests
  themselves do not touch the DB).
- `docker compose restart server`, then confirm a voice session still starts
  (SP3 connection scaffolding / `ready` + `status: live`).
- Edit one line of `apps/server/study-buddy.md`, start a fresh session, and
  confirm the change takes effect with no restart — the actual proof of
  hot-reload.

## Out of scope (YAGNI)

- DB-stored, dashboard-edited behavior (a much larger subsystem; explicitly
  deferred).
- Per-child or per-guardian behavior files (single global file only).
- Meaningful changes to the *content* of Pip's questioning (faithful port only;
  the user tunes inquisitiveness afterward by editing the file).
- Strict token validation / failing the session on a bad token.
