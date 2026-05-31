# SP1 (UI Foundation) — Manual Smoke Checklist

SP1 is the design system + the six screens + the two route trees (`/app/*` phone,
`/dashboard` desktop). It needs a browser, so it is NOT exercised by CI. This
checklist is a click-through of every screen.

> SP1 originally ran on mock data. In the current (post-SP2/SP4/SP5) state the
> same screens read **real Postgres data through the Repository seam** and sit
> behind auth + entitlement. This doc smokes the screens as they are now — so the
> values below match the **dev seed** (child *Maya*), and you must sign in first.

## Prerequisites

Bring the stack up (docker is at `/usr/local/bin`):

```bash
export PATH="/usr/local/bin:$PATH"
docker compose up -d --wait
```

> **Restart long-running containers before smoking new commits.** A `web`/`server`
> container that's been up since before your latest commits can serve stale code
> (Vite caches transformed modules). If a screen doesn't reflect recent changes:
> `docker compose restart web server`, then hard-reload. To see what's actually
> served: `curl -s http://localhost:5173/src/routes/app/HomeRoute.tsx`. (Same
> drift as the `docker-node-modules-sync` memory.)

The dev DB must be seeded with the auth-linked guardian + Maya. If it isn't (or to
get a clean run), truncate + re-seed — the seed's create-hook also writes the SP5
trial row:

```bash
docker compose exec -T postgres psql -U studybuddy -d studybuddy -c \
  'TRUNCATE "user","session","account","verification",guardians,children,plans,assignments,sessions,learning_profiles,learning_profile_traits,subscriptions RESTART IDENTITY CASCADE;'
docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'
```

Web app: `http://localhost:5173`. API/relay: `http://localhost:3001`. Dev seed
login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN `1234`.

## Sign in

1. Visit `http://localhost:5173/app` → redirected to `/login`.
2. Click **"Sign in as seed guardian (dev)"** → lands signed-in. With an active
   trial and a seeded child, you arrive at `/app` (or `/switch` if no active child
   is selected yet).

> Throughout: the browser console should show **0 errors** on every screen.

## 1. Profile picker — `/switch`

- Heading **"Who's learning?"**, a **Maya** card, and an **add (+)** card.
- Click **Maya** → navigates to `/app` with Maya active.

## 2. Home — `/app`

- Greeting **"Hi Maya!"**, Pip with "Ready to learn together?".
- **5 DAY STREAK**, **STARS TODAY** (3 of 4 filled).
- **Today's adventures**:
  - **Continue** card — *Fractions with pizza*, "We stopped at question 3 of 5",
    **Pick up where we left off →**.
  - Reading · 10 min — *Charlotte's Web, Ch. 3*.
  - Math · 15 min — *Word problems*.
  - Writing · 5 min — *-tion words*.
- Bottom nav: **Home / Subjects / Me**.

## 3. Subjects — `/app/subjects`

- Heading **"Pick a subject"**.
- A **Just talk with Pip** card ("Ask anything from class or homework").
- Six subject tiles with seeded topics: **Math** (Word problems), **Reading**
  (Charlotte's Web), **Science** (Plants & light), **Writing** (Story ideas),
  **Spanish** (20 new words), **Social Studies** (Our community).
- Tapping a tile (or *Just talk with Pip*) starts a voice session for that subject.

## 4. Me / Profile — `/app/me`

- **Maya · Age 8 · Grade 3 · Learning with Pip since Feb**, **Switch profile**.
- **Meet Pip** color picker — five swatches (coral / mint / lavender / sun / sky),
  **coral** selected. Picking another recolors Pip live (brand coral stays on
  CTAs/nav — `PipColorContext`).
- **How I learn best** traits: Pictures & diagrams **82**, Stories & examples
  **68**, Hands-on practice **54**, Hearing it out loud **41**.
- This-week chart; **Settings** (Show live transcript [on], Pip's voice speed,
  Read to me, Grown-up dashboard → Set up).

## 5. Voice — `/app/voice`

- Header **"Pip · Live / Talk with Pip"** with a **live** badge.
- Pip animation + status (**"Connecting…"** → "Listening"/"Speaking" once live).
- Controls: **Mute**, mic toggle, **End**.

> The live audio loop needs a mic + a real `GEMINI_API_KEY` and is covered by the
> SP3 smoke (`docs/superpowers/SP3-manual-smoke.md`). Here, confirm only that the
> screen + controls render and the route is reachable (not 402) for an entitled
> guardian.

## 6. Recap — `/app/recap`

- **"Awesome work, Maya!"**, "You and Pip just spent **15 minutes** on math."
- **Stars Earned** (3) and **Solved It Yourself 4/5**.
- **What we figured out** — four items (✓/○), e.g. "Sharing means dividing
  equally", "12 ÷ 4 = 3", "Drawing groups helps with division", "When the leftover
  is tricky — try again tomorrow".
- **Pip noticed… "You're a picture person!"** with a **VISUAL +1** badge.
- **Replay session** / **Done**.

## 7. Dashboard (desktop) — `/dashboard`

- PIN gate **"Grown-ups only"** → enter **1234** → **Unlock**.
- Desktop layout renders:
  - Left rail: Study Buddy wordmark, nav (Today / Subjects / My sessions / How I
    learn), streak (5 days), user chip (Maya · Grade 3), **Subscribe** + **Sign
    out**.
  - Main: **trial banner "14 days left in your free trial"** + **Subscribe** (SP5),
    greeting, **In progress** hero (*Fractions with pizza*, Pick up / Replay),
    **This week 54m (+54m)** chart, **Pip's noticing**, **Today's adventures**
    (Reading / Math / Writing with Start →), **Open app ↗**.

> The trial banner + Subscribe/Manage-billing control are SP5 (billing); the rest
> of the dashboard is SP1. See `docs/superpowers/SP5-manual-smoke.md` for the
> billing flow.

## Design-system spot-checks (any screen)

- **Tokens, not ad-hoc hex** — coral CTAs, the `0 4px 0` hard shadow, rounded
  cards, the display/body/mono font split (Bricolage / Nunito / JetBrains Mono).
- **Pip** animates and respects the user-chosen color; **brand coral** stays fixed
  for CTAs/nav.
- The prototype's design canvas / tweaks panel / device frames are **not** present
  (intentionally removed).

## Known limitations (acceptable)

- Greeting date ("Tuesday · April 22") is static copy in the design, not the live
  date.
- **Voice** "Connecting…" won't progress without a mic + Gemini creds (see SP3).
- Screens are reached via the seed child; a fresh guardian goes through
  onboarding first (see `docs/superpowers/SP4-manual-smoke.md`).

## Automated coverage (run anytime)

```bash
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
