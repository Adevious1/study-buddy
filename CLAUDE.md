# Study Buddy

A voice-led tutor for **K-5 students**, anchored on a friendly mascot named **Pip**.
Students talk to Pip about their assignments; Pip guides them to the answer
**Socratically — it guides, it never just gives the answer** — and adapts to each
student's learning style over time. Targets web, iOS, and Android.

Originated from a Claude Design handoff (HTML/CSS/JS prototypes of six screens).
The design spec lives in `docs/superpowers/specs/`.

## Status

**SP1 (UI), SP2 (backend + database), SP3 (live voice tutor), SP4 (auth), and
SP5 (billing) are all done. SP1–SP4 are merged to `main`; SP5 is on the
`sp5-billing` branch.**

SP3 (live voice tutor): browser ⇄ Hono WS relay ⇄ Gemini Live
(`gemini-3.1-flash-live-preview`), open-mic native-audio Socratic tutoring with
live transcript, and learning-style detection via function calling committing
bounded trait deltas at session end.

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

The screens, the live audio loop, the auth flow, and the billing flow all require
a browser (and, for Google/Stripe, real creds); none is smoke-tested in CI. See
`docs/superpowers/SP1-manual-smoke.md` (the six screens + dashboard),
`docs/superpowers/SP3-manual-smoke.md`, `docs/superpowers/SP4-manual-smoke.md`,
and `docs/superpowers/SP5-manual-smoke.md`. Dev seed login:
`parent@studybuddy.dev` / `studybuddy`, dashboard PIN `1234`.

**Deferred to a later effort:** auto-generated session recap, transcript
persistence, LLM-written profile notes, interactive hint chips, true subjectless
free-talk, and transparent mid-session reconnect across Gemini's ~10-min
connection reset (the soft-cap + abandoned-on-disconnect paths ARE implemented;
the seamless resumption reconnect is the remaining seam).

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
   reachable to pay; seat quantity synced to child count. (On `sp5-billing`.)

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
