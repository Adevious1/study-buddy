# Study Buddy

A voice-led tutor for **K-5 students**, anchored on a friendly mascot named **Pip**.
Students talk to Pip about their assignments; Pip guides them to the answer
**Socratically — it guides, it never just gives the answer** — and adapts to each
student's learning style over time. Targets web, iOS, and Android.

Originated from a Claude Design handoff (HTML/CSS/JS prototypes of six screens).
The design spec lives in `docs/superpowers/specs/`.

## Status

**Early build.** Sub-project 1 (UI foundation) is specced and approved; other
subsystems are not built yet. Keep this file honest — only document what is
actually true in the repo.

## Architecture (committed decisions)

| Area | Decision |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict) |
| Styling | Tailwind CSS — the design tokens ARE the theme |
| Routing | react-router; two trees: `/app/*` (phone) and `/dashboard` (desktop) |
| Fonts | self-hosted via `@fontsource` (Bricolage Grotesque / Nunito / JetBrains Mono) |
| Voice / AI | **Gemini Live API** (`gemini-3.1-flash-live-preview`), real-time audio |
| Live API auth | full backend relay: browser ⇄ our WS server ⇄ Gemini (API key stays server-side) |
| Database | Postgres in Docker, Drizzle ORM |
| Accounts | guardian account → multiple child profiles |
| Billing | per-child-profile (seat-based) subscription |
| Repo | pnpm monorepo |

## Subsystem roadmap

Built in order; each is independently demoable and gets its own spec → plan →
implementation cycle. **Do not collapse these into one effort.**

1. **UI foundation** ← _current_ — design system, Pip, atoms, all six screens, two
   route trees, navigation, on mock data. No backend.
2. **Backend + database** — TS relay/API server, Postgres + Drizzle schema
   (guardians, children, sessions, learning_profiles, plans); web app swaps mock
   data for real queries.
3. **Live voice tutor** (the hero) — mic capture + playback, WS relay to Gemini
   Live, Socratic system prompt, live transcript, learning-style detection via
   function calling writing profile deltas.
4. **Auth** — `better-auth`, guardian sign-up/login, child-profile switcher, new
   onboarding screens; gates the app.
5. **Billing** — seat-based subscription + paywall on adding a child.

## Planned layout (pnpm monorepo)

```
apps/web/            React + Vite + TS + Tailwind (the client)
apps/server/         (SP2) TS relay/API server
packages/shared/     domain types + contracts shared by client and server
docker-compose.yml   (SP2) Postgres
docs/superpowers/specs/   design specs
```

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
