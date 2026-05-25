# Study Buddy — Sub-project 1: UI Foundation (Design Spec)

_Date: 2026-05-24_
_Status: Approved (design); awaiting spec review before planning_

## Background

Study Buddy is a voice-led tutor for K-5 students, anchored on a friendly mascot
named **Pip**. Through voice conversations, the system guides a student toward
answers Socratically (it guides, it does not give the answer), and it adapts to
the student's learning style over time. The product targets iOS, Android, and the
web.

This work originates from a Claude Design handoff bundle (HTML/CSS/JS prototypes
of six screens across iOS, Android, and a browser dashboard). Per the bundle's
README, the prototypes are to be recreated faithfully in production-appropriate
technology — matching the visual output, not copying the prototype's internal
structure. The prototype's presentation scaffolding (a pan/zoom design canvas, a
live "tweaks" panel, and the device frames) is throwaway chrome and is **not**
part of the product.

## Overall product scope (context for this and future sub-projects)

Decisions captured during brainstorming:

| Decision | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| UI scope | Navigable mobile app (5 screens) + responsive web dashboard |
| Voice / AI | Real — Gemini Live API (`gemini-3.1-flash-live-preview`) |
| Live API auth | Full backend relay (browser ⇄ our WebSocket server ⇄ Gemini) |
| Data | Real database |
| Database | Postgres in Docker, Drizzle ORM |
| Accounts | Guardian account → multiple child profiles |
| Billing | Per-child-profile (seat-based) subscription pricing |
| Repo | pnpm monorepo from day one |

Because this spans real-time media, persistence, auth, and payments, it is **not**
a single project. It decomposes into five independently buildable, independently
demoable subsystems, built in order:

1. **UI foundation** — design system, Pip, shared atoms, all six screens, two
   route trees, navigation, on mock data. _(This spec.)_
2. **Backend + database** — TS relay/API server, Postgres in Docker, Drizzle
   schema (guardians, children, sessions, learning_profiles, plans); the web app
   swaps mock data for real queries against a seeded guardian + child.
3. **Live voice tutor** — mic capture + audio playback in the client, the
   WebSocket relay to Gemini Live, the Socratic system prompt, live transcript,
   session lifecycle, and learning-style detection (function calling) writing
   profile deltas to the DB.
4. **Auth** — `better-auth`, guardian sign-up/login, child-profile management +
   a "who's learning?" switcher, plus the new onboarding screens (not in the
   original design); gates the app.
5. **Billing** — seat-based subscription (one base price + per-additional-child),
   and a paywall when a guardian adds another child.

Each subsystem gets its own spec → plan → implementation cycle. **This document
covers Sub-project 1 only.**

## Sub-project 1 — Goals & non-goals

### Goals

- A runnable, navigable React app that faithfully recreates the Study Buddy
  interface from the design bundle, running entirely on mock data.
- Structure the repo and the data layer so that subsystems 2–5 plug in with
  minimal disruption (monorepo, shared types, an async data seam).
- A faithful design system expressed as Tailwind theme tokens, so utilities are
  the design system.

### Non-goals (explicitly deferred to later sub-projects)

- Real voice, microphone capture/playback, or any Gemini Live integration (SP3).
- Backend relay/API server (SP2/SP3).
- Postgres / persistence — in this slice, a reload resets all state (SP2).
- `better-auth` login, sign-up, onboarding, or the child-profile switcher (SP4).
- Seat-based billing / paywall (SP5).
- The prototype's design canvas, tweaks panel, and iOS/Android/browser device
  frames — dropped permanently as presentation chrome.

## Repository structure (pnpm monorepo)

```
study-buddy/
  pnpm-workspace.yaml
  package.json                 workspace root (scripts, shared dev tooling)
  tsconfig.base.json
  docker-compose.yml           placeholder; populated in SP2
  .gitignore
  docs/superpowers/specs/      design specs (this file)
  packages/
    shared/                    @study-buddy/shared
      package.json
      src/
        index.ts
        domain.ts              Student, Subject, Assignment, Session,
                               LearningProfile, LearningStyleTrait, WeekActivity,
                               PipColor, etc. — typed contracts shared with the
                               future server.
  apps/
    web/                       @study-buddy/web — Vite + React + TS + Tailwind
      index.html
      package.json
      vite.config.ts
      tsconfig.json
      tailwind config (per current Tailwind line)
      src/
        main.tsx
        index.css              Tailwind layers, @theme tokens, keyframes, fonts
        App.tsx                router root
        routes/
          app/
            AppLayout.tsx       phone shell + bottom nav + "Open dashboard" link
            HomeRoute.tsx
            LibraryRoute.tsx
            ProfileRoute.tsx
            VoiceRoute.tsx       full-screen, bottom nav hidden
            RecapRoute.tsx       full-screen, bottom nav hidden
          dashboard/
            DashboardRoute.tsx   desktop left-rail layout + "Open app" link
        components/
          Pip.tsx
          ui/
            Card.tsx Button.tsx HintChip.tsx Bubble.tsx StyleBadge.tsx
            SectionTitle.tsx Star.tsx Flame.tsx Sparkle.tsx SubjectIcon.tsx
            NavIcon.tsx BottomNav.tsx Waveform.tsx
        state/
          PipColorContext.tsx
        data/
          repository.ts          async Repository interface (the SP2 swap seam)
          mockRepository.ts       mock implementation
          fixtures.ts             seed/mock data
        hooks/
          useResource.ts          tiny async-data hook (loading/data)
```

The four config files scaffolded earlier in the repo root (a flat single-app
`package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`) will be
reorganized into this monorepo layout.

## Tech stack

- React 18, Vite, TypeScript (strict mode).
- **Tailwind CSS** (current line) for styling; design tokens mapped into the
  theme. Exact setup verified against live Tailwind docs during implementation.
- **react-router** for the two route trees.
- **@fontsource** packages for Bricolage Grotesque, Nunito, and JetBrains Mono
  (self-hosted; no external CDN, no flash-of-unstyled-text). _(Approved call (a).)_
- Domain types live in `@study-buddy/shared` so SP2's server imports identical
  contracts.

## Design system → Tailwind theme

Ported from the bundle's `theme.css`. The whole visual language becomes theme
tokens:

- **Surfaces:** `bg` #FFF4E8, `bg-2` #FBE6D0, `surface` #FFFFFF,
  `surface-2` #FFF9F1, `line` #F0DFC9.
- **Ink scale:** `ink` #2A1F18, `ink-2` #5B4A3D, `ink-3` #8B7A6B, `ink-4` #B8A89A.
- **Brand & accents:** `coral` #FF7B5A / `coral-d` #E5614A / `coral-l` #FFD9CC;
  `mint` #4FCFA1 / `mint-l` #C9F2DF; `lavender` #9D87E8 / `lavender-l` #E0D7F7;
  `sun` #FFCB47 / `sun-l` #FFE9AC; `sky` #5DB7FF.
- **Type:** `font-display` = Bricolage Grotesque, `font-body` = Nunito,
  `font-mono` = JetBrains Mono.
- **Radii:** 10 / 16 / 24 / 32 / pill (9999).
- **Signature shadow:** the `0 4px 0 <darker>` "hard" offset shadow used on
  primary buttons (and card variants like `0 4px 0 #F0DFC9`).
- **Animations (keyframes + utilities):** `pip-breathe`, `pip-listen`,
  `pip-speak`, `pip-blink`, `ring-pulse`, `wave-bar`. (`float-up`, `shimmer`
  ported only if a screen uses them.)

## Components

### Pip (mascot)

Recreated as inline SVG: blob body with a radial-gradient sheen, blush cheeks,
blinking eyes (with a wink expression variant), a state-driven mouth (and a small
tongue when speaking), and animated listening rings. Props:

- `size: number`
- `state: 'idle' | 'listen' | 'speak' | 'cheer' | 'think'` (drives the animation)
- `color: string` (fill; defaults from `PipColorContext`)
- `expression: 'happy' | 'curious' | 'wink' | 'star'`
- `shadow?: boolean`

### Shared atoms (faithful ports)

`Card`, `Button` (variants: primary/soft/ghost/mint/dark; sizes sm/md/lg),
`HintChip`, `Bubble` (pip/user), `StyleBadge` (label + score bar), `SectionTitle`
(+ optional action), `Star` (filled/outline), `Flame`, `Sparkle`, `SubjectIcon`
(math/reading/science/writing/spanish/social), `NavIcon` (home/library/profile),
`BottomNav` (Home / Subjects / Me), `Waveform`.

## Routing & layout trees

Two hand-tuned layout trees with an explicit switch between them _(approved layout
model)_:

| Route | Renders | Notes |
|---|---|---|
| `/` | redirect → `/app` | default entry |
| `/app` | Home | phone shell, bottom nav |
| `/app/subjects` | Library | bottom nav |
| `/app/me` | Profile | bottom nav |
| `/app/voice` | Voice session | full-screen, nav hidden |
| `/app/recap` | Recap | full-screen, nav hidden |
| `/dashboard` | Web dashboard | desktop left-rail layout |

`/app/*` is the phone experience: full-bleed on mobile, centered in a phone-width
column on larger viewports, with the 3-tab bottom nav (Home / Subjects / Me).
`/dashboard` is the desktop layout. Each links to the other ("Open dashboard" /
"Open app").

## Screens (faithful recreations)

- **Home** (`/app`) — "Tuesday · April 22" + "Hi {name}!"; Pip greeting card;
  streak (5-day) + stars-today stats; dark "Continue last session — Fractions
  with pizza (Q3 of 5)" feature card with peeking Pip; today's assignment cards
  (Reading / Math / Spelling) with subject icon, minutes, and star progress.
- **Voice** (`/app/voice`) — _visual-only this slice._ Session header
  (Math · Word problems, Question 3 of 5, timer), progress dots, large animated
  Pip, a state chip (Listening… / Pip is talking / Pip is thinking) with
  waveform/dots, mock transcript bubbles, Socratic hint chips
  (Try drawing it / Need a hint? / Read again / Slower please), and the control
  row (Mute · big Mic · End). The mic button toggles Pip/state between
  `idle` and `listen` locally; "End" navigates to Recap.
- **Recap** (`/app/recap`) — celebration header (sun gradient + confetti dots +
  cheering Pip + "Awesome work, {name}!" + "14 minutes on word problems"); stars
  earned + "solved it yourself 4/5"; "What we figured out" checklist (3 ok, 1
  try-again); the "Pip noticed… You're a picture person! VISUAL +1" learning-style
  nudge; Replay / Done buttons (Done → Home).
- **Profile** (`/app/me`) — name + "Age 8 · Grade 3 · Learning with Pip since
  Feb"; customize-Pip card with a live color picker; "How I learn best" bars
  (Pictures 82 / Stories 68 / Hands-on 54 / Hearing 41); this-week streak row;
  settings list (transcript toggle, voice speed, read-to-me toggle, grown-up
  dashboard). Toggles are locally interactive (do not persist).
- **Library** (`/app/subjects`) — "Just talk with Pip" dark free-talk card; 2-col
  subject grid (Math, Reading, Science, Writing, Spanish, Social Studies) with
  colored icon tiles + topic subtitles. Subject cards / free-talk card →
  Voice session.
- **Dashboard** (`/dashboard`) — left rail (Pip + wordmark, nav: Today / Subjects
  / My sessions / How I learn, streak card, user chip); greeting row + "Start a
  session"; in-progress hero (dark, large Pip, "Fractions with pizza", pick-up /
  replay); stats column (weekly time + bar chart, "Pip's noticing" card); today's
  adventures 3-col grid with "Start →" buttons.

## State & data

- **`PipColorContext`** — `{ pipColor, setPipColor }`. The Profile color picker
  updates Pip's color live across every screen (the one useful knob salvaged from
  the prototype's tweaks panel). The brand **accent stays coral, fixed**, for
  CTAs and nav, to keep contrast predictable. _(Approved call (c).)_ Default Pip
  color: coral. Available colors: coral, mint, lavender, sun, sky.
- **Navigation** — react-router. Voice's mic toggles a local `idle ⇄ listen`
  visual state; "End" → `/app/recap`; Recap "Done" → `/app`; Home "continue" and
  Library start cards → `/app/voice`.
- **Data seam** — all screens read through an **async `Repository`** interface
  (`getStudent`, `getTodayAssignments`, `getLearningProfile`, `getWeekActivity`,
  `getSubjects`, `getContinueSession`, `getRecap`). SP1 ships `mockRepository`
  backed by `fixtures.ts`; SP2 swaps in an API-backed implementation **without
  touching screen code**. A small `useResource` hook handles loading/data state;
  React Query can arrive with the real backend. _(Approved call (b): async from
  day one.)_

## Interactivity this slice

All navigation works (tabs, pushed Voice/Recap screens, the app ⇄ dashboard
switch); Pip recoloring works live; the Voice mic toggles its visual state;
Profile setting toggles are interactive locally (do not persist — SP2). Hover and
active states throughout via Tailwind.

## Verification

Done means all of the following pass, observed (not assumed):

- `pnpm install` succeeds from a clean checkout.
- `pnpm --filter @study-buddy/web dev` serves the app.
- `pnpm --filter @study-buddy/web build` and the TypeScript typecheck pass clean
  (no errors).
- Manual click-through: every route renders; bottom-nav tabs switch; Home/Library
  start → Voice; Voice mic toggles state; Voice End → Recap; Recap Done → Home;
  Profile color picker recolors Pip everywhere; the app ⇄ dashboard links work.

## Open questions / assumptions

- Tailwind major version and exact config mechanism (CSS `@theme` vs JS config)
  will be pinned against current Tailwind docs at implementation time; either
  satisfies this spec.
- Student display name in mock fixtures defaults to "Maya" (matches the
  prototype); trivially changed.
- No automated UI tests in this slice (manual verification only); a testing
  approach can be revisited when logic-bearing subsystems (SP2+) arrive.
