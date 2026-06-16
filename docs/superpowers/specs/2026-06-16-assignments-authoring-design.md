# SP12 — Assignments authoring — design

**Date:** 2026-06-16
**Audit/backlog item:** #12 ("assignments authoring — fresh accounts have nothing
real to study, the biggest product gap").
**Status:** design approved, pending spec review.

## Problem

`assignments` is read-only and seeded. The only endpoint is
`GET /api/children/:childId/assignments/today`; there is no create/edit/delete
anywhere. A real guardian who signs up sees "Nothing scheduled today" and has no
way to tell Pip what their child should work on. This is the largest product gap:
without authoring, the tutor has no real, specific material to anchor on.

## Goal

Let a guardian author assignments for each child from the dashboard (behind the
PIN gate), surface them to the child, and feed an optional per-assignment "focus"
note into Pip's system prompt so tutoring targets the specific work. Tapping an
assignment in the child app launches a Pip session on that topic.

Non-goals (deferred): photo/worksheet attachments, structured problem lists,
recurring/due-date scheduling, auto-generated assignments, responsive dashboard
(audit #16b).

## Decisions (from brainstorm)

1. Authoring fields: subject + topic/title + **optional free-text notes for Pip**.
2. Scheduling: keep the existing **`scheduledDate`**, authoring defaults to today.
3. Authoring surface: **inline on the main `/dashboard`** (where today's
   assignments already render), behind the PIN gate.
4. **Tap-to-start** wired in v1: the child's assignment card launches the voice
   session on that subject/topic/notes.

## Current shape (for reference)

- `assignments` table: `id`, `childId`, `subjectKind` (check-constrained to
  `math|reading|science|writing|spanish|social`), `title`, `scheduledDate`
  (date), `minutes`, `stars` (default 0), `totalStars` (notNull, no default),
  timestamps. Index `(childId, scheduledDate)`.
- Read: `GET .../assignments/today` filters `scheduledDate = todayUtc`.
- Voice start message (`packages/shared/src/voice.ts:11`):
  `{ type: 'start'; subjectKind; topic; title }`. `topic` currently = the title.
- `relay.start(subjectKind, topic, title)` → `buildPrompt(subjectKind, topic)` →
  `SystemPromptInput { childName, grade, subject, topic, intro, traitLean }`,
  rendered from `study-buddy.md` (and byte-identical `BUILTIN_TEMPLATE`, drift-
  guarded).
- Child app: `AssignmentCard` is display-only (not tappable). Dashboard shows
  today's assignments via `repository.getTodayAssignments()`.
- All `/api/children/:childId/*` routes sit behind `childContext` (guardian-
  ownership authz — the IDOR fix; unowned child → 404, no session → 401).

## Architecture

### 1. Data model — migration 0008

```sql
ALTER TABLE assignments ADD COLUMN notes text;            -- optional Pip focus
ALTER TABLE assignments ALTER COLUMN total_stars SET DEFAULT 3;
```

Drizzle schema: add `notes: text('notes')` (nullable) and `.default(3)` on
`totalStars`. `stars` already defaults to 0. The guardian never sets
`stars`/`totalStars` — they are session/recap-driven; create defaults to
`stars=0`, `totalStars=3`.

### 2. Server API — `apps/server/src/routes/assignments.ts`

All under the existing `childContext`-guarded `/api/children/:childId/...` tree,
so ownership authz is automatic. Zod-validated bodies (the 64KB body cap already
applies). Not separately entitlement-gated — the entitlement gate stays at voice-
session start; `/dashboard` stays reachable to pay.

- **`POST .../assignments`** — create. Body:
  - `subjectKind`: enum of the six subjects.
  - `title`: string, trimmed, 1–80 chars.
  - `scheduledDate`: ISO `YYYY-MM-DD`; default = today UTC; must be ≥ today UTC.
  - `minutes`: integer 1–120.
  - `notes`: optional string, ≤ 500 chars (trimmed; empty → stored null).
  Inserts with `stars=0`, `totalStars=3`. Returns the created row (domain shape).
- **`PATCH .../assignments/:assignmentId`** — edit. Same field validation, all
  optional; 404 if the assignment's `childId` ≠ the authorized child (defense
  beyond childContext, since the assignmentId is a separate identifier).
- **`DELETE .../assignments/:assignmentId`** — delete; 404 on non-match.
- **`GET .../assignments`** — *new* management list: `scheduledDate ≥ todayUtc`,
  ordered by `scheduledDate`, then `createdAt`. Returns domain rows incl. `notes`
  + `scheduledDate`.
- **`GET .../assignments/today`** — additively extended to also return `notes`
  (and keep its existing fields) so the child tap-to-start can pass it through
  (see §5). Same today-UTC filter as before.

`assignmentId` is validated as a uuid (mirror the existing `childId` validation
in `childContext`); malformed → 400.

### 3. Shared types — `packages/shared/src`

- Extend the voice `start` message: `{ type: 'start'; subjectKind; topic; title; notes?: string }`.
- `domain.ts Assignment`: add `notes?: string | null` and `scheduledDate?: string`
  — both optional so the child-facing shape stays backward compatible (the
  management list populates `scheduledDate`; `assignments/today` may omit it).
- A `NewAssignmentInput` / `AssignmentPatch` contract type shared by client and
  server (subjectKind, title, scheduledDate, minutes, notes) so the Repository and
  route agree.

### 4. Feeding Pip — the focus note

- `relay.start` gains an optional `notes`; threads it into `buildPrompt`.
- `SystemPromptInput` gains `notes?: string`. A new conditional token **`{{focus}}`**
  is added to `study-buddy.md` (and the byte-identical `BUILTIN_TEMPLATE`), gated
  exactly like `{{intro}}`:
  - notes present → render one line, e.g.:
    *"The grown-up shared what to focus on today: «{notes}». Use this to choose
    where you begin — but you still guide {{childName}} Socratically and never
    just give the answer."*
  - notes absent → empty string.
- The drift-guard test (`test/voice/systemPrompt.test.ts`) is updated so
  `BUILTIN_TEMPLATE` stays byte-identical to the file, and a new case asserts
  `{{focus}}` renders the line when notes are present and nothing when absent.

**Security note:** `notes` is guardian-authored free text injected into the system
prompt. The guardian is a trusted party (their own child), so injection risk is
low. The template keeps the **Socratic rule absolute** regardless of notes
content; the focus line is explicitly framed as *where to start*, not *how to
behave*, so a note like "just give her the answers" cannot subvert Pip.

### 5. Web — guardian authoring (`apps/web`, main dashboard)

- **`AssignmentForm`** modal component (reusing SP9 `ChildForm` / modal patterns):
  subject picker (the six subjects, with `SubjectIcon`), title input, date input
  (default today), minutes input, notes textarea. Used for both create and edit.
- **Dashboard assignments section** (`DashboardRoute`): the existing today list
  becomes a manageable list driven by `repository.getAssignments()` (upcoming),
  with an **"+ Add assignment"** button (opens `AssignmentForm`), and per-row
  **edit** (opens `AssignmentForm` prefilled) and **delete** (a
  `ConfirmDangerModal`-style confirm). React-Query invalidation on mutate.
- **Repository seam** (`apps/web/src/data`): add to the `Repository` interface and
  both impls (mock + `apiRepository`):
  - `getAssignments(): Promise<Assignment[]>` (upcoming, for the dashboard).
  - `createAssignment(input: NewAssignmentInput): Promise<Assignment>`.
  - `updateAssignment(id: string, patch: AssignmentPatch): Promise<Assignment>`.
  - `deleteAssignment(id: string): Promise<void>`.
  `getTodayAssignments()` stays for the child app.

### 6. Web — child tap-to-start (`apps/web`)

- `AssignmentCard` becomes a button/tappable card (keyboard-accessible) that
  navigates to `/app/voice` with
  `state: { subjectKind, topic: a.title, title: a.title, notes: a.notes }`.
- `VoiceRoute` / `useVoiceSession` thread the optional `notes` into the `start`
  message; `relay.start` passes it to `buildPrompt`. Ad-hoc / continue-session
  paths simply omit `notes` (optional throughout).

## Data flow

```
Guardian (dashboard, PIN) ──POST/PATCH/DELETE /api/children/:id/assignments──▶ assignments table
Child home ──GET .../assignments/today (incl. notes)──▶ AssignmentCard (tappable)
   └─ tap ──▶ /app/voice (state: subject/topic/notes) ──ws 'start' {notes}──▶ relay.start
                 └─ buildPrompt(subject, topic, notes) ──▶ {{focus}} line ──▶ Gemini system prompt
```

## Error handling

- Validation failures → 400 (Zod; per the SP11 convention, `.issues` are logged
  via `reportError`, not leaked to the client).
- Unowned child → 404 (childContext). Assignment id not belonging to the child →
  404. Malformed ids → 400.
- Web mutations surface a friendly inline error and keep the modal open on failure;
  optimistic-free (await + invalidate) to stay simple.

## Testing

- **Server** (`bun test`, against the test Postgres):
  - `test/assignments/*.test.ts`: create (happy + each validation bound:
    title length, minutes range, bad subject, past date, notes length), the
    ownership/404 paths for PATCH/DELETE, and the new `GET .../assignments`
    ordering + `assignments/today` notes passthrough.
  - `test/voice/systemPrompt.test.ts`: `{{focus}}` rendered/omitted + the
    `BUILTIN_TEMPLATE` byte-identical drift guard.
- **Web:** follows the repo's light approach — a `docs/superpowers/SP12-manual-smoke.md`
  browser click-through: author on the dashboard → child home shows it → tap →
  Pip opens a session and the focus note steers the opening (still Socratic).

## Files

**New:** migration 0008; `apps/web/src/components/AssignmentForm.tsx`;
`docs/superpowers/SP12-manual-smoke.md`; server assignment route tests.
**Modify:** `apps/server/src/db/schema.ts`, `routes/assignments.ts`,
`voice/relay.ts`, `voice/systemPrompt.ts`, `study-buddy.md`;
`packages/shared/src/voice.ts` + `domain.ts`; `apps/web/src/data/*` (Repository +
mock + api), `components/AssignmentCard.tsx`, `routes/dashboard/DashboardRoute.tsx`,
`routes/app/VoiceRoute.tsx` + `useVoiceSession`; `CLAUDE.md` + roadmap (SP12 entry).

## Out of scope

Photo/worksheet attachments, structured problem lists, recurring/due scheduling,
auto-generation, responsive dashboard (#16b).
