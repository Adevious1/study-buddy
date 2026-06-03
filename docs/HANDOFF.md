# Study Buddy — Session Handoff

> Living doc. Update at the end of each working session so the next context can
> resume fast. Keep it short; link to specs/plans/smoke docs for detail.

## Current state (2026-05-31)

**SP1–SP5 all built and on `main`.** SP6 (session recap) is implemented on the
`sp6-session-recap` branch — awaiting the live mic smoke (`SP6-manual-smoke.md`)
before merge. pnpm monorepo; everything runs in Docker. HEAD: `4a7e24b`.

(See `CLAUDE.md` for the authoritative status block and architecture.)

## What's done

- **SP1 UI** — six screens + dashboard, design system, Pip. ✅ verified (Playwright).
- **SP2 backend/DB** — Hono server, Postgres + Drizzle, repository seam. ✅ verified.
- **SP3 live voice** — mic capture/playback, WS relay to Gemini Live, Socratic
  prompt, live transcript, learning-style function-calling. ✅ **verified via a
  human mic run (2026-05-31)** — full audio loop confirmed end to end; End/Back are
  responsive while "Connecting…".
- **SP4 auth** — better-auth (Google OAuth + dev email/password), guardian login,
  child-profile switcher, onboarding/PIN screens, IDOR fix. ✅ verified (dev path);
  real Google OAuth completion still uncovered.
- **SP5 billing** — Stripe seat-based subs, trial, webhook, entitlement gating.
  Code on `main`. 🟡 partial (live Stripe payment click-through tabled — needs test
  creds + Stripe CLI).
- **SP6 session recap** — post-session Gemini summary (`gemini-3-flash-preview`)
  into the existing recap UI; transcript persistence (`sessions.transcript` jsonb);
  tunable `study-buddy-recap.md` prompt (hot-reload + drift-guard, mirrors SP3
  pattern); generate-then-reveal UX (wrapping-up screen → `/app/recap`); timeout-
  bounded generation with graceful fallback; abandoned sessions persist transcript
  but get no recap. Code on `sp6-session-recap`. 🟡 pending human mic smoke
  (`SP6-manual-smoke.md`).
- **SP7 camera vision ("Show Pip")** — snapshot-on-demand over the SP3 voice WS →
  `sendRealtimeInput({ video })` into the same Gemini Live session; `session_snapshots`
  bytea storage; `offer_camera` invite tool (→ `camera-offered` button pulse);
  preview+confirm `SnapshotCapture` overlay; single JPEG (≤1024px/q0.85) for both Pip
  and storage; Socratic-on-vision prompt rule; child-scoped read endpoints behind
  `childContext` authz with a hardened image-serve (pinned mime + nosniff + CSP); a
  guardian `/dashboard` "What {child} showed Pip" panel. Server 122 tests pass; web
  typecheck/build/units pass. Code on `worktree-sp7-camera-vision`. 🟡 pending human
  mic smoke (`SP7-manual-smoke.md`). Spec + plan under
  `docs/superpowers/specs/2026-06-02-study-buddy-camera-vision-design.md` and
  `docs/superpowers/plans/2026-06-02-camera-vision.md`.

## Pip's voice behavior is now tunable (SP3)

Pip's voice system prompt lives in **`apps/server/study-buddy.md`** — an editable,
hot-reloaded markdown template with `{{token}}` placeholders (`{{childName}}`,
`{{grade}}`, `{{subject}}`, `{{topic}}`, `{{intro}}`, `{{traitLean}}`). Edit + save
→ next session uses it, no restart (server bind-mounts `./apps/server`). The
in-code `BUILTIN_TEMPLATE` in `apps/server/src/voice/systemPrompt.ts` is the
**byte-identical** fallback (a drift-guard test enforces lockstep — update BOTH
together). `{{intro}}` is gated to a child's first-ever session
(`countSessionsForChild`). A stray `"Text "` Gemini transcription artifact is
stripped in `apps/server/src/voice/transcript.ts`.

## Environment quirks (carry forward)

- `docker` is at `/usr/local/bin` — `export PATH="/usr/local/bin:$PATH"`. macOS, no `timeout`.
- Server tests run on the host vs a throwaway Postgres on **5433**
  (`PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test` in `apps/server`; start
  `sb-test-pg` if stopped). Full suite is ~83 tests.
- Server typecheck: `cd apps/server && bun run typecheck`. Web:
  `pnpm --filter @study-buddy/web typecheck|build`.
- Studybuddy stack Postgres collides with a local PG on 5432; reach the stack DB
  via `docker compose exec -T postgres psql -U studybuddy -d studybuddy`.
- After web/prompt changes, `docker compose restart server` (or `web`) and confirm
  the served file inside the container; the dev container can serve stale modules.
- Dev seed login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN `1234`.
  Seeded child: Maya (`00000000-0000-0000-0000-000000000001`, has ~33 sessions →
  the returning-child path; for the first-session intro path use a new child).
- **Browser automation: use Playwright, never Claude-in-Chrome.** A real mic
  session needs a human — Playwright can't produce real microphone audio.

## Suggested next steps

- **SP6 live mic smoke** — run `SP6-manual-smoke.md` (happy path, DB check, tunable
  prompt, fallback, abandoned path), then merge `sp6-session-recap` to `main`.
- Live Stripe payment smoke (needs Stripe test creds + Stripe CLI).
- Full Google OAuth completion + fresh-guardian onboarding (needs real creds).
- Remaining deferred items: LLM-written profile notes, hint chips, subjectless
  free-talk, mid-session seamless reconnect.

## Latest session recap

`docs/superpowers/sessions/2026-05-31-tunable-pip-and-sp3-live-verify.md`
