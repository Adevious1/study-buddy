# Study Buddy

A voice-led tutor for **K-5 students**, anchored on a friendly mascot named **Pip**.
Students talk to Pip about their assignments; Pip guides them to the answer
**Socratically — it guides, it never just gives the answer** — and adapts to each
student's learning style over time. Targets web, iOS, and Android.

Originated from a Claude Design handoff (HTML/CSS/JS prototypes of six screens).
The design spec lives in `docs/superpowers/specs/`.

## Status

**All nine subsystems — SP1 (UI), SP2 (backend + database), SP3 (live voice
tutor), SP4 (auth), SP5 (billing), SP6 (session recap), SP7 (camera vision /
"Show Pip"), SP8 (reconnect / longer sessions), and SP9 (account lifecycle &
compliance) — are done and smoke-verified** (SP7 + SP8 via a human mic run and
SP9 via a browser run, all on 2026-06-12; the only tabled checks are SP5/SP9's
live-Stripe click-throughs and SP8's auto-cap firing, each unit-covered). All
nine are merged to `main`; the feature branches are deleted.

SP7 (camera vision / "Show Pip"): during a live voice session a child taps a camera
button to show Pip a photo of their work (drawing, worksheet/textbook, or
anything they name). The JPEG (downscaled to ≤1024px / q0.85) rides the existing
SP3 voice WebSocket as a `snapshot` control message; the relay forwards it into
the same Gemini Live session via `sendRealtimeInput({ video })` so Pip sees and
reacts in conversation, and persists it to a new `session_snapshots` (Postgres
`bytea`) table. Capture is preview-and-confirm; Pip can *invite* the camera via a
new `offer_camera` function-calling tool (relay → `camera-offered` → the
always-visible camera button pulses), but only the child taps the shutter. The
**Socratic rule extends to vision**: even when a photo shows the answer, Pip
guides rather than reads it out (enforced in the tunable `study-buddy.md`
prompt). Snapshots are viewable by the guardian on `/dashboard` via child-scoped
read endpoints behind the SP4 `childContext` ownership authz; the image-serve
endpoint pins `Content-Type` + `nosniff` + CSP-sandbox against stored-mime XSS.
Key files: `apps/server/src/voice/snapshots.ts`, `routes/snapshots.ts`, the
`session_snapshots` schema/migration, relay `handleSnapshot` + `offer_camera`,
and client `SnapshotCapture.tsx` / `imageEncode.ts` / `useVoiceSession` /
`VoiceRoute` / the dashboard panel. **Single JPEG for both Pip and storage**
(webp storage and child-recap thumbnails are deferred).

SP8 (reconnect / longer sessions): transparent relay↔Gemini reconnect across
Gemini's ~10-min connection reset, using the Gemini session-resumption handle.
When Gemini drops the relay's connection the relay reconnects immediately;
the browser sees a brief `'resuming'` state ("one sec…") then `'live'`, while
the browser↔relay WebSocket stays open throughout. The session soft-cap is
raised from 10 to a 15-min policy (within Gemini's uncompressed audio-session
limit; no context compression). A ~13-min in-band "director cue" nudges Pip
to wrap up the session (tunable via `study-buddy.md`, byte-identical
`BUILTIN_TEMPLATE`, drift-guard test). Bounded reconnect retries fall back to
a graceful completed recap on persistent failure. The browser↔relay
(child-network) reconnect — surviving the child's own WebSocket dropping — is
still deferred. Key files: `apps/server/src/voice/relay.ts`
(`connectGemini`/`reconnect`/`onClose`, nudge scheduling),
`apps/server/src/voice/geminiSession.ts` (resumption handle), the
director-cue rule in `study-buddy.md`, and `test/voice/relay.test.ts` +
`test/voice/systemPrompt.test.ts`. Mic smoke ✅ verified 2026-06-12
(`SP8-manual-smoke.md`; auto-cap firing and reconnect-failure fallback
unit-covered, not observed live).

SP9 (account lifecycle & compliance): guardian settings page at
`/dashboard/settings` behind the PIN gate — edit child (name / grade / birthdate / Pip
color); delete child with a typed-name confirm modal, cascade wipe of all
child data, and Stripe seat decrement; delete account with a typed-`DELETE`
confirm, Stripe cancel-first then auth-user cascade delete, signs the
guardian out everywhere and lands on `/goodbye`; PIN change (with 429
lockout on wrong attempts) and a fresh-session (≤5 min) Forgot-PIN reset
(`/pin-reset`) that restarts sign-in if the session is stale; `POST /pin`
hardened to first-set-only (rejects re-set via the API); parental-consent
checkbox on the add-child form stamping `children.consent_at`; and public
`/privacy` + `/terms` pages with a consent line on the login screen. Key
files: `apps/server/src/routes/me.ts`,
`apps/server/src/lib/accountLifecycle.ts`,
`apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx`,
`apps/web/src/components/ChildForm.tsx` / `ConfirmDangerModal.tsx`,
`apps/web/src/routes/auth/PinResetRoute.tsx` / `GoodbyeRoute.tsx`, and the
legal routes. Browser smoke ✅ verified 2026-06-12 (`SP9-manual-smoke.md`;
live-Stripe cancel check tabled).

SP3 (live voice tutor): browser ⇄ Hono WS relay ⇄ Gemini Live
(`gemini-3.1-flash-live-preview`), open-mic native-audio Socratic tutoring with
live transcript, and learning-style detection via function calling committing
bounded trait deltas at session end.

Pip's behavior (persona, the discover-and-assess opening, the 9-step session
flow, the Socratic rule, tone, language, off-topic handling, the learning-signal
instruction) is **tunable via `apps/server/study-buddy.md`** — an editable,
version-controlled markdown template with `{{token}}` placeholders for live
per-session data (`{{childName}}`, `{{grade}}`, `{{subject}}`, `{{topic}}`,
`{{intro}}`, `{{traitLean}}`). `{{intro}}` gates Pip's one-time self-introduction:
present only on a child's first-ever session (detected by
`countSessionsForChild === 0`), explicitly suppressed thereafter so Pip doesn't
re-introduce itself each subject. The server reads the file fresh at each session
start (hot-reload via the `./apps/server` bind mount — edit + save, next session
uses it, no restart); markdown headings are stripped before sending. The in-code
`BUILTIN_TEMPLATE` is kept **byte-identical** to the file (a test guards against
drift) and is the fallback if the file is missing/unreadable.
`STUDY_BUDDY_PROMPT_PATH` overrides the path. Lives in
`apps/server/src/voice/systemPrompt.ts`. A stray leading `"Text "` artifact from
Gemini's native-audio output transcription is stripped per-turn in
`apps/server/src/voice/transcript.ts`.

SP4 (auth): better-auth (pinned `~1.2.12` — see [[docker-node-modules-sync]]),
guardian **Google OAuth** + a **dev-only email/password** path; `guardians` linked
1:1 to better-auth's `user` via `userId`; a runtime child-profile switcher
(`ChildProfileContext`) replacing the old build-time `VITE_CURRENT_CHILD_ID`;
login / onboarding (PIN → add child) / profile-picker / PIN-gated-dashboard
screens; and **guardian-ownership authz in `childContext`** (the IDOR fix —
unowned child → 404, no session → 401), which also protects the voice WS route.

SP5 (billing): per-child seat-based **Stripe** subscription with a no-card trial
on sign-up. The raw Stripe SDK is isolated in `lib/stripe.ts`; a `subscriptions`
table is 1:1 with `guardians` (trial row created in the guardian-create auth
hook); pure entitlement + a webhook reducer live in `lib/entitlement.ts`
(unit-tested). A public signature-verified webhook (`routes/stripeWebhook.ts`,
mounted before the authed `/api` tree) drives state. Entitlement is enforced
**client-side** (`/app` → `/subscribe` via an entitlement-first
`nextOnboardingDest`) and **server-side** (voice relay + add-child → 402 via
`requireEntitled` / the `me.ts` gate); `/dashboard` stays reachable so a guardian
can pay. Seat quantity = child count, synced to Stripe on add. No better-auth
version change. Accepted limitations (webhook event ordering/dedup; seat-sync
partial state) are documented in the smoke doc.

SP6 (session recap): at the end of a completed voice session, the server persists
the full transcript into a new `sessions.transcript` jsonb column (delivering the
previously-deferred transcript-persistence item), then makes one non-streaming
Gemini call (`gemini-3-flash-preview`) to summarize the transcript into the
existing recap columns (`stars_earned`/`stars_max`, `solved_self`/`solved_total`,
`figured_out`, `insight_title`/`insight_body`/`insight_badge`), then emits `ended`. The client shows a "Putting together what you learned…"
wrapping-up screen and navigates to the already-built `/app/recap` once the server
confirms (generate-then-reveal UX, gated on a went-live session). Generation is
timeout-bounded with a graceful fallback recap (1 star, encouraging copy) so the
screen never breaks. Abandoned sessions persist the transcript but generate no
recap. The summarizer prompt is externalized in
**`apps/server/study-buddy-recap.md`** — hot-reloaded from the bind mount, with a
byte-identical in-code `BUILTIN_RECAP_TEMPLATE` as the fallback and a drift-guard
test, exactly mirroring the `study-buddy.md` / `BUILTIN_TEMPLATE` pattern from
SP3. Key server files: `apps/server/src/recap/` (summarizer, prompt loader,
fallback), `apps/server/src/voice/transcript.ts` (`TranscriptAccumulator`),
`finalizeLiveSession`, and relay `finish()`; client changes span `VoiceRoute`,
`useVoiceSession`, and `voiceReducer`.

CI (`.github/workflows/ci.yml`, added 2026-06-10) runs on every push/PR to `main`:
a **build** job (`pnpm -r typecheck` + `pnpm -r build`) and a **test** job (`bun test`
in `apps/server`, 152 tests, against a `postgres:16` service — the suite
self-provisions `studybuddy_test`, no secrets needed). The screens, the live audio
loop, the auth flow, and the billing flow still require a browser (and, for
Google/Stripe, real creds) and are **not** covered by CI — each has a manual-smoke
doc under `docs/superpowers/`; status as of 2026-06-10:

- `SP1-manual-smoke.md` (six screens + dashboard) — ✅ **verified** via Playwright.
- `SP2-manual-smoke.md` (backend/DB infra: health, schema, migrations, seed, API
  auth-gating — `curl` + `psql`, not a browser) — ✅ **verified** against the live stack.
- `SP3-manual-smoke.md` (live voice loop) — ✅ **verified** via a human mic run
  (2026-05-31). The full audio loop works end to end (browser ⇄ Hono WS ⇄ Gemini
  Live, real speech in/out, live transcript). Confirmed in that run: Pip no longer
  re-introduces itself each subject (first-session-gated `{{intro}}`); the stray
  `"Text "` transcript artifact is stripped; Pip follows the discover-and-assess
  session flow; and **End/Back are responsive while still "Connecting…"** (the
  previously open question — resolved, not a bug). The earlier transcript/layout
  fixes (delta-accumulation, Pip shrinks/transcript fills, phone-frame viewport
  cap) also held up visually.
- `SP4-manual-smoke.md` (auth) — ✅ **verified (dev path)**: IDOR, add-child, PIN
  lockout, sign-out/re-gate. Google OAuth completion + fresh-guardian onboarding
  still uncovered (need real OAuth creds / a new guardian).
- `SP5-manual-smoke.md` (billing) — 🟡 **partial**: trial/banner/gates (402 + client
  `/app`→`/subscribe`) verified; the live Stripe Checkout/Portal payment flow is
  tabled (needs Stripe test creds + the Stripe CLI — see [[sp5-stripe-live-smoke-pending]]).
- `SP6-manual-smoke.md` (live recap loop) — ✅ **verified** via a human mic run
  (2026-06-01): full loop end to end (mic → Pip → persisted transcript →
  `gemini-3.5-flash` summary → populated `/app/recap`), real session-specific
  recap generated. Required the recap model fix (`gemini-3.5-flash`) and a 30s
  generation timeout; the graceful fallback path is also confirmed.
- `SP7-manual-smoke.md` (camera vision) — ✅ **verified** via a human mic run
  (2026-06-12, phone via tunnel): happy path + retake, printed-answer
  Socratic-on-vision, `offer_camera` pulse, permission-denied (audio
  unaffected), dashboard viewer + image-serve headers, and authz 404s for a
  non-owner guardian.
- `SP8-manual-smoke.md` (reconnect / longer sessions) — ✅ **verified** via a
  human mic run (2026-06-12): one continuous 14.1-min / 114-turn session
  crossed the ~10-min Gemini reset (brief "one sec…" → live, context kept),
  ~13-min wrap-up nudge fired without leaking the director cue, manual End →
  full recap. The 15-min auto-cap firing and the reconnect-failure fallback
  were not observed live (unit-covered).
- `SP9-manual-smoke.md` (account lifecycle & compliance) — ✅ **verified** via a
  Playwright run (2026-06-12) on a throwaway guardian: consent gating + `consent_at`
  stamp, settings (edit/delete child incl. last-child → onboarding PIN-skip), PIN
  change + 429 lockout, forgot-PIN loop, stale-session 403 restart, account delete →
  `/goodbye` with full cascade verified in psql + all-session 401. Only the
  live-Stripe cancel check is tabled (needs test creds, like SP5). Run surfaced an
  ops step: **after merging a migration, run `db:migrate` against the dev stack**
  (`docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'`).

Dev seed login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN `1234`.

A whole-app gap audit (2026-06-11) lives in
`docs/superpowers/audit-2026-06-11.md` — the prioritized list of remaining
holes (account/data deletion, compliance pages, observability, Stripe webhook
dedup, prod docker, etc.). Consult it before planning new work.

**Deferred to a later effort:** LLM-written profile notes, interactive hint chips,
true subjectless free-talk, and the browser↔relay (child-network) reconnect —
surviving the child's own WebSocket dropping (relay session persistence +
browser re-attach).

## Architecture (committed decisions)

| Area | Decision |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict) |
| Styling | Tailwind CSS — the design tokens ARE the theme |
| Routing | react-router; two trees: `/app/*` (phone) and `/dashboard` (desktop) |
| Fonts | self-hosted via `@fontsource` (Bricolage Grotesque / Nunito / JetBrains Mono) |
| Backend | **Hono** (TypeScript) — HTTP/API + the WebSocket relay |
| Voice / AI | **Gemini Live API** (`gemini-3.1-flash-live-preview`), real-time audio |
| Live API auth | full backend relay: browser ⇄ our Hono WS server ⇄ Gemini (API key stays server-side) |
| Database | Postgres + Drizzle ORM |
| Accounts | guardian account (**Google sign-in**) → multiple child profiles |
| Auth method | **Google OAuth** for the guardian via `better-auth`'s Google provider (SP4 ✓); dev-only email/password for the seed login. Dashboard behind a guardian PIN. |
| Billing | per-child-profile (seat-based) subscription |
| Repo | pnpm monorepo |
| Deployment | **everything in Docker** — `docker-compose` runs web + Hono server + Postgres |

## Subsystem roadmap

Built in order; each is independently demoable and gets its own spec → plan →
implementation cycle. **Do not collapse these into one effort.**

1. **UI foundation** ✓ _done_ — design system, Pip, atoms, all six screens, two
   route trees, navigation, on mock data. No backend.
2. **Backend + database** ✓ _done_ — TS relay/API server, Postgres + Drizzle schema
   (guardians, children, sessions, learning_profiles, plans); web app swaps mock
   data for real queries.
3. **Live voice tutor** ✓ _implemented_ — mic capture + playback, WS relay to Gemini
   Live (`gemini-3.1-flash-live-preview`), Socratic system prompt, live transcript,
   learning-style detection via function calling writing bounded trait deltas.
   Deferred items: session recap, transcript persistence, LLM profile notes,
   hint chips, subjectless free-talk, and mid-session seamless reconnect.
4. **Auth** ✓ _done_ — `better-auth` (Google OAuth + dev email/password), guardian
   login, runtime child-profile switcher (replaced `VITE_CURRENT_CHILD_ID`),
   onboarding/login/picker/PIN-gate screens, and guardian-ownership authz in
   `childContext` (IDOR fix). Gates `/app/*` and `/dashboard`.
5. **Billing** ✓ _done_ — Stripe seat-based subscription, no-card trial on sign-up,
   public signature-verified webhook, entitlement gating (`/app` → `/subscribe`
   client-side; voice + add-child → 402 server-side) with `/dashboard` kept
   reachable to pay; seat quantity synced to child count.
6. **Session recap** ✓ _done_ — post-session Gemini summary (`gemini-3-flash-preview`)
   into the existing recap UI; transcript persistence (new `sessions.transcript`
   jsonb); tunable recap prompt (`study-buddy-recap.md`); generate-then-reveal UX
   (wrapping-up screen → `/app/recap`).
7. **Camera vision ("Show Pip")** ✓ _implemented_ — snapshot-on-demand: a child
   shows Pip a photo during a live session; the JPEG rides the SP3 voice WS and is
   forwarded into the same Gemini Live session (`sendRealtimeInput({ video })`),
   persisted as `session_snapshots` (Postgres `bytea`); preview+confirm capture;
   `offer_camera` tool lets Pip invite the camera; Socratic-on-vision prompt rule;
   guardian dashboard viewer behind `childContext` authz. Mic smoke ✅ verified
   2026-06-12 (`SP7-manual-smoke.md`).
8. **Reconnect / longer sessions** ✓ _implemented_ — transparent relay↔Gemini
   reconnect via the Gemini session-resumption handle across Gemini's ~10-min
   connection reset (browser↔relay WS stays open; browser sees a brief
   `'resuming'` then `'live'`); session soft-cap raised to 15 min; a ~13-min
   in-band director-cue nudge (tunable via `study-buddy.md`) prompts Pip to
   wrap up; bounded retries fall back to a graceful completed recap. The
   browser↔relay (child-network) reconnect remains deferred. Mic smoke ✅
   verified 2026-06-12 (`SP8-manual-smoke.md`).
9. **Account lifecycle & compliance** ✓ _implemented_ — guardian settings page
   (`/dashboard/settings`) behind the PIN gate: edit child (name / grade / birthdate / Pip color),
   delete child (typed-name confirm + cascade wipe + Stripe seat decrement),
   delete account (typed-`DELETE` confirm, Stripe cancel then auth-user cascade,
   signs out everywhere, `/goodbye`); PIN change with lockout; Forgot-PIN
   (`/pin-reset`) with stale-session restart; `POST /pin` first-set-only; parental
   consent checkbox stamping `children.consent_at`; public `/privacy` + `/terms`
   with login consent line. Browser smoke ✅ verified 2026-06-12
   (`SP9-manual-smoke.md`; live-Stripe cancel check tabled).

## Planned layout (pnpm monorepo)

```
apps/web/            React + Vite + TS + Tailwind (the client)
apps/server/         (SP2) Hono server — HTTP/API + Gemini Live WebSocket relay
packages/shared/     domain types + contracts shared by client and server
docker-compose.yml   (SP2) full stack: web + Hono server + Postgres
Dockerfile(s)        (SP2) per-app images (apps/web, apps/server)
docs/superpowers/specs/   design specs
```

> **Hono WS note (SP2/SP3):** the Gemini Live relay is a WebSocket bridge, so the
> server runtime + WS adapter (`@hono/node-ws` on Node, native on Bun) is a real
> design decision for the SP2 brainstorm — Hono covers the HTTP/API + token surface
> cleanly either way.

## Conventions

- **Shared types live in `packages/shared`** — client and server import the same
  domain/contract types; do not duplicate them.
- **Screens read data through the async `Repository` seam** (`apps/web/src/data`),
  never directly from fixtures or fetch. SP1 ships a mock impl; later subsystems
  swap the implementation without touching screen code.
- **Tokens are the design system** — use Tailwind theme utilities (`bg-coral`,
  `font-display`, the `0 4px 0` hard shadow, the `pip-*` animations); avoid
  ad-hoc hex values that drift from the design.
- **Pip's color** is user-customizable via `PipColorContext`; the **brand accent
  (coral) stays fixed** for CTAs/nav.
- The original prototype's design canvas, tweaks panel, and device frames are
  **not** part of the product — do not recreate them.

## Working agreements

- This is a multi-subsystem product: **brainstorm → spec → plan → build**, one
  subsystem at a time. Do not start a new subsystem without its own spec.
- For the Gemini Live work (SP3), use the `gemini-live-api-dev` skill to get
  current model specs and config right. For auth (SP4), the `better-auth-engineer`
  agent. Verify library APIs against current docs (context7) — don't assume.
- Verify before claiming done: run the build + typecheck and click through the
  app; report real output, not assumptions.
