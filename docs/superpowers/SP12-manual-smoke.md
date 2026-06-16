# SP12 (Assignments Authoring) — Manual Smoke Checklist

Assignments authoring requires a browser and a running stack; the dashboard CRUD
flows are NOT exercised by CI. Server-side validation and authz ARE covered by
`bun test` (see the automated-coverage block below); this checklist covers the
end-to-end browser and API flow — guardian authoring on the dashboard, child
tap-to-start on the home screen, and Pip receiving the focus note.

> **⬜ NOT YET RUN** — run this after merging SP12 and applying migration 0008
> to the dev stack:
> ```
> docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'
> ```

## Prerequisites

1. Stack up on the **localhost** env (`.env.localhost.bak` swapped in,
   `BETTER_AUTH_URL=http://localhost:5173`, no `TUNNEL_BASIC_AUTH`;
   `docker compose up -d --force-recreate server web`).
   See the env-gotcha note in `SP4-manual-smoke.md`.
2. Dev login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN **`1234`**.
3. The seed guardian already has a child (`Alex`) and seeded assignments —
   those seeded rows can coexist with the ones you create here.

## Checklist

### Setup

- [ ] Sign in as `parent@studybuddy.dev` / `studybuddy`. Confirm the dashboard
  loads at `/dashboard`.
- [ ] Enter PIN **`1234`** when prompted. Dashboard home renders (child list,
  week activity, assignments section).

### Authoring — add an assignment

- [ ] In the **Assignments** section, click **+ Add assignment**.
- [ ] The "New assignment" modal opens with `AssignmentForm`.
- [ ] Select a subject (e.g. **Reading**).
- [ ] Set Title to **"Chapter 5 – The Rainforest"** (or any title).
- [ ] Date defaults to today — leave it as-is.
- [ ] Set Minutes to **20**.
- [ ] In the Notes field, enter a focus note (e.g. `Focus on the water cycle`).
- [ ] Click **Save assignment** → modal closes; the new assignment appears in
  the dashboard list.
- [ ] **API check (optional):**
  ```
  curl -s -b <cookie> http://localhost:4000/api/children/<childId>/assignments | jq .
  ```
  Confirm the new row has `notes: "Focus on the water cycle"`.

### Authoring — edit an assignment

- [ ] Click the **edit** (pencil) icon on the assignment just created.
- [ ] The "Edit assignment" modal opens pre-filled with the existing values.
- [ ] Change the Title to **"Chapter 5 – Water Cycle"** and update the Notes to
  **"Emphasize evaporation and condensation"**.
- [ ] Click **Save assignment** → modal closes; the updated title and note are
  reflected in the list.

### Authoring — validation (empty title)

- [ ] Open the **+ Add assignment** modal again.
- [ ] Leave the Title field empty. Confirm the **Save assignment** button is
  **disabled** (not clickable).
- [ ] Type a space in Title — button remains disabled (title must be non-blank
  after trim).

### Authoring — validation (server-side, optional)

- [ ] Via `curl`, POST an assignment with `scheduledDate` set to yesterday's
  date (e.g. `"scheduledDate": "2026-06-15"`). Confirm the server returns
  **HTTP 400** `{ error: { code: "invalid_assignment", message: "scheduledDate is in the past" } }`.
- [ ] Via `curl`, POST an assignment with `minutes: 200`. Confirm **HTTP 400**
  (>120 rejected by Zod).
- [ ] Via `curl`, POST with an empty `title` after trim. Confirm **HTTP 400**.

### Authoring — delete an assignment

- [ ] Click the **delete** (trash) icon on any assignment.
- [ ] A one-tap confirm dialog appears ("Delete [title]?") with **Cancel** and
  **Delete** buttons.
- [ ] Click **Cancel** — dialog closes, assignment is still in the list.
- [ ] Open the delete dialog again and click **Delete** — dialog closes;
  assignment is gone from the list.
- [ ] **API check (optional):** confirm the row is absent from
  `GET /api/children/:childId/assignments`.

### Child surface — home screen

- [ ] Navigate to the **child app** at `/app` (or switch to the child's home
  screen via the profile picker).
- [ ] The home screen shows today's assignments. The new assignment **"Chapter 5
  – Water Cycle"** (or whatever you named it, scheduled for today) appears as
  an `AssignmentCard`.
- [ ] Assignments scheduled for future dates do **not** appear (the
  `/today` endpoint filters by UTC date).

### Child surface — tap to start

- [ ] Tap (or click) the assignment card → the app navigates to
  `/app/voice` with the assignment's subject and title pre-filled.
- [ ] The "What would you like to study today?" picker does **not** appear;
  Pip's session starts with the subject and topic from the assignment.

### Focus note reaches Pip (live mic check — human run required)

- [ ] Ensure the assignment has a focus note (e.g. `Emphasize evaporation`).
- [ ] Start a voice session by tapping the assignment card. Once Pip speaks,
  confirm via the **live transcript** or **server logs** that Pip's opening
  reflects the focus note (e.g. steers toward evaporation/condensation) rather
  than a generic opening.
- [ ] Confirm Pip still **guides Socratically** — it prompts and questions
  rather than directly stating the answer, even when the focus note hints at it.
  The prompt rule: `"Use it to choose where you begin — but you still guide
  [childName] Socratically and never just give the answer."` (see
  `study-buddy.md` `{{focus}}` section and `systemPrompt.ts`).
- [ ] Confirm no raw focus-note text is leaked verbatim into Pip's speech
  (the note is an internal instruction to Pip, not a message read aloud).

### Authz — unowned child gets 404

- [ ] Using a second guardian account (create a throwaway or use `curl` with
  a different session), attempt to access
  `GET /api/children/<seed-child-id>/assignments`.
- [ ] Confirm the response is **HTTP 404** (the `childContext` middleware rejects
  unowned access). This is the same authz that protects all child-scoped
  endpoints (SP4 IDOR fix).

## Accepted limitations / known gaps

- **Web UI has no automated tests** for the assignment authoring modals —
  verified only by typecheck + build (CI) and this manual smoke. The server-side
  route is covered by `bun test`.
- **Live mic focus-note check requires a human mic run.** CI only covers build
  + typecheck; the focus-note injection into Pip's system prompt is unit-covered
  in `test/voice/systemPrompt.test.ts` (drift-guard style), but whether Pip
  *behaves* on the focus note requires a real session.
- **No client-side past-date guard:** the form sets `min={today()}` on the date
  input, which browsers enforce visually but not server-side (a manual past-date
  entry is caught by the API 400). The server is the authoritative gate.
- **Assignment star counts are seed-only for now:** `stars` and `totalStars` are
  returned by the API but not updated by SP12 authoring flows (they come from
  session recaps — future work).
- **No `>120 min` client validation:** the form has `max={120}` on the number
  input (browsers enforce), but a crafted request is rejected by the server (400).
  Client-side enforcement deferred.

## Automated coverage (run anytime)

```
/usr/local/bin/docker exec sb-test-pg psql -U studybuddy -d postgres \
  -c 'DROP DATABASE IF EXISTS studybuddy_test;'
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

Web:

```
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
