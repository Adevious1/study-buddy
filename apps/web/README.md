# Study Buddy — Web App

Study Buddy is a K-5 voice-led tutoring interface anchored on Pip, a friendly mascot that guides kids through homework sessions. This workspace is the React client — fully navigable, all route trees, design tokens, and data layer in place.

---

## Getting started

Install dependencies from the repo root (pnpm workspaces):

```bash
pnpm install
```

Run the full dev stack (web + server + Postgres) from the repo root:

```bash
pnpm dev           # docker compose up — opens at http://localhost:5173
```

To run just the Vite dev server against an already-running backend:

```bash
pnpm dev:web       # alias: pnpm --filter @study-buddy/web dev
```

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

`AppLayout` hides the bottom nav on `/app/voice` and `/app/recap` (the immersive screens).

---

## Data layer (`src/data`)

All screens read data through an async `Repository` interface defined in `src/data/repository.ts`. This interface is the stable seam — it was not changed in SP2 and will not change as the backend evolves.

**SP2 implementation:** `src/data/apiRepository.ts` — fetches over HTTP from the Hono backend. The active export in `src/data/index.ts`:

```ts
export const repository: Repository = apiRepository;
```

SP1's `mockRepository.ts` and `fixtures.ts` have been deleted. Type contracts in `packages/shared` are the authoritative source of truth.

### Data fetching

Screens fetch via [TanStack Query](https://tanstack.com/query) (`@tanstack/react-query`), not the old `useResource` hook (deleted in SP2). Query keys follow the convention:

```ts
['child', CURRENT_CHILD_ID, '<resource>']
// e.g. ['child', CURRENT_CHILD_ID, 'student']
//      ['child', CURRENT_CHILD_ID, 'assignments']
```

`CURRENT_CHILD_ID` is set via the `VITE_CURRENT_CHILD_ID` env var (provided by Docker or a local `.env`).

---

## Pip color (`PipColorContext`)

`src/state/PipColorContext.tsx` exposes a `PipColorProvider` and `usePipColor()` hook. The `pipColorValue` string recolors Pip's body and the mic/waveform representing Pip's listening state. Brand chrome (buttons, bottom nav, CTAs) uses the fixed coral token (`var(--color-coral)`).

---

## Live voice (`/app/voice`)

The voice screen is wired to the Gemini Live relay via `useVoiceSession` (SP3).
On navigation to `/app/voice` (via a subject or the free-talk chooser) the hook
upgrades a WebSocket to `GET /api/children/:childId/voice`, requests mic
permission, and streams audio in both directions. The live transcript updates in
real time for both child and Pip turns.

**Requirements:**
- The server must have `GEMINI_API_KEY` set — the API key is server-side only.
- The browser must grant microphone permission; if denied, `ErrorState` shows
  "Pip needs your microphone".

See `apps/server/README.md` for the environment variable and `docs/superpowers/SP3-manual-smoke.md` for the manual smoke checklist.

---

## Deferred subsystems

- **Authentication** — no auth layer; app loads directly. Auth is SP4.
- **Billing / subscription** — not modelled. Billing is SP5.

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
