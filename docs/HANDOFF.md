# Study Buddy — Session Handoff

_Last updated: 2026-05-24_

> **Resume here:** Sub-project 1 (UI foundation) is **done and merged to `main`**.
> The next step is to **brainstorm Sub-project 2 (backend + database)**. Start a new
> session and say: _"Let's brainstorm Sub-project 2 (backend + database)."_ Read
> `CLAUDE.md` first (committed decisions + roadmap); this file adds the temporal
> context and the open questions waiting for each upcoming sub-project.

---

## What Study Buddy is

A voice-led tutor for **K-5 students**, anchored on a mascot named **Pip**. Students
talk to Pip about assignments; Pip guides them to answers **Socratically (guides,
never just gives the answer)** and adapts to each student's learning style over time.
Targets web, iOS, and Android. Originated from a Claude Design HTML/CSS/JS prototype
handoff (vendored at `docs/design-reference/`).

---

## Session summary (2026-05-24)

1. **Fetched + read the design bundle** (a Claude Design handoff): README, chat
   transcript, and all source files. Identified that the prototype's design-canvas,
   tweaks-panel, and iOS/Android/browser device frames are throwaway presentation
   chrome — the real product is the design tokens, the Pip mascot, the shared atoms,
   and six screens.
2. **Brainstormed the product** (interview, one question at a time). Established that
   this is not one project but **five interlocking subsystems**, and decomposed it.
3. **Wrote + approved the spec** for Sub-project 1 (UI foundation):
   `docs/superpowers/specs/2026-05-24-study-buddy-ui-foundation-design.md`.
4. **Wrote the implementation plan** (15 bite-sized tasks):
   `docs/superpowers/plans/2026-05-24-study-buddy-ui-foundation.md`, and vendored the
   prototype as the port reference at `docs/design-reference/`.
5. **Built SP1 via subagent-driven development** — 10 implementer dispatches, each
   gated by a spec-compliance review then a code-quality review, plus a final
   whole-implementation review. Fixed every real finding (fixed-accent-rule leaks on
   Profile/Library/Voice, button accessibility, a dead data-load on the dashboard);
   reasoned through and kept faithful-port non-issues.
6. **Merged SP1 to `main`** (`finishing-a-development-branch`). `main` was unborn, so
   it now holds the work; the feature branch is deleted.
7. **Captured later-subsystem decisions** in `CLAUDE.md`: backend = **Hono**, auth =
   **Google OAuth** (guardian), deployment = **everything in Docker**.

---

## Current state: Sub-project 1 — COMPLETE ✅

A runnable, faithful Study Buddy UI on mock data. pnpm monorepo:

- `packages/shared` — domain type contracts (shared with the future server).
- `apps/web` — React 18 + Vite + TS + Tailwind v4:
  - **Pip** mascot (states/expressions/listening rings) + the full atom set
    (Card, Button, HintChip, Bubble, StyleBadge, SectionTitle, icons, BottomNav,
    Waveform, Toggle).
  - **Six screens:** Home, Voice (visual-only), Recap, Profile, Library, Dashboard.
  - **Two route trees:** `/app/*` (phone shell + bottom nav) and `/dashboard`
    (desktop left-rail), with an explicit app⇄dashboard switch.
  - **Live Pip recolor** via `PipColorContext`; brand accent held **fixed at coral**
    everywhere (only Pip's body follows the customizable color).
  - **Async `Repository` seam** (`apps/web/src/data`) backed by a mock implementation
    — the single swap point for SP2's real API.

Verification (green): `pnpm -r typecheck` and `pnpm --filter @study-buddy/web build`.
No automated test suite in this slice (approved decision — manual/build verification).

### Run it
```bash
pnpm install
pnpm dev        # → http://localhost:5173  (redirects to /app)
```

---

## Committed architecture decisions

(Authoritative copy lives in `CLAUDE.md`.)

| Area | Decision |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict) |
| Styling | Tailwind v4 — design tokens ARE the theme |
| Routing | react-router; `/app/*` (phone) + `/dashboard` (desktop) |
| Fonts | self-hosted `@fontsource` (Bricolage Grotesque / Nunito / JetBrains Mono) |
| Backend | **Hono** (TypeScript) — HTTP/API + Gemini Live WS relay |
| Voice / AI | **Gemini Live API** (`gemini-3.1-flash-live-preview`), real-time audio |
| Live API auth | full backend relay: browser ⇄ Hono WS server ⇄ Gemini (key server-side) |
| Database | Postgres + Drizzle ORM |
| Accounts | guardian account (**Google sign-in**) → multiple child profiles |
| Auth method | **Google OAuth** (likely `better-auth` Google provider — confirm SP4) |
| Billing | per-child-profile (seat-based) subscription |
| Repo | pnpm monorepo |
| Deployment | **everything in Docker** — compose: web + Hono server + Postgres |

---

## Roadmap ahead

Built in order; each is independently demoable and gets its **own** brainstorm → spec
→ plan → subagent-driven build cycle. **Do not collapse these into one effort.**

### SP2 — Backend + database  ← NEXT
TS **Hono** server (`apps/server`), Postgres + Drizzle schema (guardians, children,
sessions, learning_profiles, plans), and a `docker-compose` bringing up the full
stack. The web app's mock `Repository` is swapped for a real Hono API implementation
(one-line change in `apps/web/src/data/index.ts`).
**Open design questions for the SP2 brainstorm:**
- **Server runtime + WS adapter:** Node (`@hono/node-server` + `@hono/node-ws`) vs.
  **Bun** (native WS). Drives how the Gemini Live relay holds two live sockets, and
  pairs with the "everything in Docker" decision.
- Drizzle schema shape + migrations; seed data (port the SP1 fixtures into a seed).
- API surface (REST endpoints mapping to the `Repository` methods) + how the client
  fetches (introduce React Query, or keep `useResource`).
- `docker-compose` topology + Dockerfiles for `apps/web` and `apps/server`.
- Refine the SP1 domain contracts where SP2 needs real fields (e.g. `Student.age`/
  `grade` instead of the display-only `ageLabel`; tuple/length types) — these were
  deliberately deferred from SP1.

### SP3 — Live voice tutor (the hero)
Mic capture + audio playback in the client; the Hono **WebSocket relay** to Gemini
Live; the Socratic "guide-don't-tell" system prompt; live transcript; session
lifecycle; learning-style detection (function calling) writing profile deltas to the
DB. **Use the `gemini-live-api-dev` skill** for current model specs/config. The
visual-only Voice screen from SP1 becomes real here.

### SP4 — Auth
**Google OAuth** guardian sign-in (lean: `better-auth` Google provider), child-profile
management + a "who's learning?" switcher, and the onboarding screens (new — not in
the original design). Gates the app. The `better-auth-engineer` agent can help.

### SP5 — Billing
Seat-based subscription (one base price + per-additional-child), and a paywall when a
guardian adds another child.

---

## How we work (process to follow each sub-project)

1. **Brainstorm** (`superpowers:brainstorming`) — interview one question at a time;
   present a design; get approval. The user wants this **even when requirements seem
   clear**.
2. **Spec** → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, committed.
3. **Plan** (`superpowers:writing-plans`) → `docs/superpowers/plans/...`, bite-sized
   tasks with exact code + verification.
4. **Build** (`superpowers:subagent-driven-development`) — fresh implementer subagent
   per task, then spec-compliance review, then code-quality review; fix findings;
   final whole-implementation review.
5. **Finish** (`superpowers:finishing-a-development-branch`) — start each sub-project
   on its own feature branch; merge to `main` when green.

Verify before claiming done: run typecheck/build (and tests once they exist); report
real output. Verify library APIs against current docs (context7) — don't assume.

---

## Key files / pointers

- `CLAUDE.md` — committed decisions + roadmap (read first in a new session).
- `docs/superpowers/specs/2026-05-24-study-buddy-ui-foundation-design.md` — SP1 spec.
- `docs/superpowers/plans/2026-05-24-study-buddy-ui-foundation.md` — SP1 plan.
- `docs/design-reference/` — the vendored prototype (exact values to port from).
- `apps/web/README.md` — how to run the web app + the route trees + the data seam.
- `apps/web/src/data/` — the `Repository` seam (mock now; SP2 swaps it).
- `packages/shared/src/domain.ts` — the domain contracts shared client↔server.

## Known minor deferrals (noted during SP1 reviews; not blocking)
- `Student.ageLabel` / `ContinueSession.progressLabel` are display strings; raw
  `age`/`grade` etc. get designed against the real schema in SP2.
- `Student.pipColor` fixture field isn't yet wired to seed the initial Pip color
  (provider mounts above the data layer); wire or drop in SP2.
- `WeekActivity.bars` / `doneDays` are `number[]` (could be fixed-length tuples).
- Dashboard "My sessions" rail item routes to `/app` (no sessions screen exists yet).
- `PipExpression` includes an unused `'star'` variant (spec-listed; renders as happy).
