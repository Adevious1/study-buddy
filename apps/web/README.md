# Study Buddy — Web App (UI Foundation)

Study Buddy is a K-5 voice-led tutoring interface anchored on Pip, a friendly mascot that guides kids through homework sessions. This package is the **UI foundation sub-project**: a fully navigable React app running on mock data, with all route trees, components, design tokens, and data seams in place for the real backend to be wired in later.

---

## Getting started

Install dependencies from the repo root (pnpm workspaces):

```bash
pnpm install
```

Start the dev server:

```bash
pnpm --filter @study-buddy/web dev
```

The app opens at `http://localhost:5173`.

---

## Route trees

The app hosts two separate experiences under one Vite entry point:

| Path | Experience | Layout |
|---|---|---|
| `/app` | Phone app | `AppLayout` — max-width 420 px, bottom nav |
| `/app/subjects` | Library screen | (same AppLayout) |
| `/app/me` | Profile screen | (same AppLayout) |
| `/app/voice` | Active voice session | Full-bleed, no nav |
| `/app/recap` | Post-session recap | Full-bleed, no nav |
| `/dashboard` | Desktop dashboard | Left-rail, full-width |
| `/` | — | Redirects to `/app` |
| `*` | — | Redirects to `/app` |

`AppLayout` hides the bottom nav and the "Open dashboard" link on `/app/voice` and `/app/recap` (the immersive screens).

---

## Data seam (`src/data`)

All screens read data through an async `Repository` interface defined in `src/data/repository.ts`. The current implementation (`src/data/mockRepository.ts`) resolves instantly from static fixtures in `src/data/fixtures.ts`.

To swap in a real API, replace the single export in `src/data/index.ts`:

```ts
// src/data/index.ts  (today)
export const repository: Repository = mockRepository;

// SP2: replace with
export const repository: Repository = new ApiRepository(/* config */);
```

Screen code imports `repository` from `src/data` only — no screen touches fixtures or mock internals directly.

---

## Pip color (`PipColorContext`)

`src/state/PipColorContext.tsx` exposes a `PipColorProvider` and `usePipColor()` hook. The `pipColorValue` string (a CSS custom property reference) is passed to `<Pip color={pipColorValue}>` only — it recolors Pip's body and the mic/waveform that represent Pip's listening state. Brand chrome (buttons, bottom nav accent, section headings) uses the fixed coral token (`var(--color-coral)`), independent of the chosen Pip color.

The Profile screen lets kids pick Pip's color; the selection persists for the session via React context.

---

## Deferred subsystems

The following were explicitly out of scope for this UI-foundation sub-project and will be addressed in later sub-projects:

- **Real voice / Gemini Live API** — `VoiceRoute` shows a static transcript; mic toggle is local UI state only.
- **Backend & database** — all data is served from in-memory fixtures.
- **Authentication** — no auth layer; app loads directly.
- **Billing / subscription** — not modelled.
- **Automated UI tests** — typecheck + build verification only for this slice.

---

## Build

```bash
pnpm --filter @study-buddy/web build
```

Output goes to `apps/web/dist`.

## Typecheck

```bash
pnpm -r typecheck
```
