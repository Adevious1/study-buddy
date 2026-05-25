# Study Buddy — UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable, navigable React app that faithfully recreates the Study Buddy interface (six screens across a phone app and a desktop dashboard) on mock data, structured as a pnpm monorepo ready for later backend/voice/auth/billing subsystems.

**Architecture:** pnpm monorepo. `packages/shared` holds domain TypeScript types shared with the future server. `apps/web` is a Vite + React + TS app styled with Tailwind (the design tokens become the Tailwind theme). Two react-router trees: `/app/*` (phone experience, bottom-nav) and `/dashboard` (desktop left-rail). All data is read through an async `Repository` seam backed by a mock implementation, so a later sub-project swaps in a real API without touching screen code.

**Tech Stack:** pnpm workspaces, React 18, Vite, TypeScript (strict), Tailwind CSS v4 (`@tailwindcss/vite`), react-router v6, `@fontsource` (Bricolage Grotesque / Nunito / JetBrains Mono).

---

## Conventions for this plan (read first)

- **The vendored prototype is the source of truth for exact values.** Each screen/component task references its original at `docs/design-reference/project/...`. That file gives the exact markup, dimensions, colors, copy, and structure. Your job is to **port** it, not redesign it: convert inline styles to Tailwind utilities using the token map in Task 4, replace the `Object.assign(window, …)` globals with ES `import`/`export`, and type all props. When a value isn't a theme token (e.g. a one-off `borderRadius: 28` or `0 4px 0` shadow), use a Tailwind arbitrary value (`rounded-[28px]`, `shadow-[0_4px_0_var(--color-coral-d)]`).
- **Drop the scaffolding.** Do not port `design-canvas.jsx`, `tweaks-panel.jsx`, `ios-frame.jsx`, `android-frame.jsx`, `browser-window.jsx`, or `app.jsx`. They are prototype chrome.
- **Verification is manual + typecheck + build** (the approved spec chose no automated UI tests for this slice). Every task ends by running typecheck/build and/or viewing the dev server, with the exact command and expected result given.
- **Commit after every task** with the message shown.
- All `pnpm` commands run from the repo root unless stated.

### Token map (inline-style value → Tailwind utility)

Colors (used as `bg-*`, `text-*`, `border-*`): `--bg`→`bg`, `--bg-2`→`bg-2`, `--surface`→`surface`, `--surface-2`→`surface-2`, `--line`→`line`, `--ink`→`ink`, `--ink-2`→`ink-2`, `--ink-3`→`ink-3`, `--ink-4`→`ink-4`, `--coral`→`coral`, `--coral-d`→`coral-d`, `--coral-l`→`coral-l`, `--mint`→`mint`, `--mint-l`→`mint-l`, `--lavender`→`lavender`, `--lavender-l`→`lavender-l`, `--sun`→`sun`, `--sun-l`→`sun-l`, `#5DB7FF`→`sky`.

Fonts: `var(--font-display)`→`font-display`, `var(--font-body)`→`font-body`, `var(--font-mono)`→`font-mono`.

Examples:
- `background: 'var(--coral)'` → `className="bg-coral"`
- `color: 'var(--ink-3)'` → `text-ink-3`
- `border: '1.5px solid var(--line)'` → `border-[1.5px] border-line`
- `borderRadius: 24` → `rounded-[24px]` (or `rounded-r-lg`; tokens `--radius-*` defined in Task 4)
- `boxShadow: '0 4px 0 var(--coral-d)'` → `shadow-[0_4px_0_var(--color-coral-d)]`
- `fontWeight: 800, fontSize: 32` → `font-extrabold text-[32px]`
- dynamic values (computed width, animation delay) stay inline via `style={{…}}`.

---

## Task 1: Workspace root + tooling

**Files:**
- Create: `pnpm-workspace.yaml`
- Create/replace: `package.json` (repo root — replace the provisional flat-app one)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Delete: `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json` (the provisional flat-layout files in the repo root)

- [ ] **Step 1: Remove the provisional flat-layout config files**

```bash
rm -f vite.config.ts tsconfig.json tsconfig.node.json
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Replace root `package.json`**

```json
{
  "name": "study-buddy",
  "version": "0.1.0",
  "private": true,
  "description": "Study Buddy — a K-5 voice-led tutor anchored on Pip, a friendly mascot.",
  "scripts": {
    "dev": "pnpm --filter @study-buddy/web dev",
    "build": "pnpm --filter @study-buddy/web build",
    "typecheck": "pnpm -r typecheck",
    "preview": "pnpm --filter @study-buddy/web preview"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 5: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.local
.DS_Store
.env
.env.*
!.env.example
*.tsbuildinfo
.vscode/*
!.vscode/extensions.json
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: set up pnpm monorepo workspace root"
```

---

## Task 2: `packages/shared` — domain types

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@study-buddy/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "moduleDetection": "force"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/domain.ts`**

```ts
// Shared domain contracts. Imported by the web app now and by the server later.

export type PipColor = 'coral' | 'mint' | 'lavender' | 'sun' | 'sky';

export type SubjectKind =
  | 'math' | 'reading' | 'science' | 'writing' | 'spanish' | 'social';

export interface Student {
  id: string;
  name: string;
  ageLabel: string;        // e.g. "Age 8 · Grade 3 · Learning with Pip since Feb"
  pipColor: PipColor;
  streakDays: number;
  starsToday: number;
  starsTodayMax: number;
}

export interface Assignment {
  id: string;
  subject: string;         // display label, e.g. "Reading"
  title: string;           // e.g. "Charlotte's Web, Ch. 3"
  minutes: number;
  stars: number;
  totalStars: number;
  iconKind: SubjectKind;
  /** theme color token name for the icon tile, e.g. "mint" */
  color: string;
  /** soft theme color token name, e.g. "mint-l" */
  softColor: string;
}

export interface ContinueSession {
  title: string;           // "Fractions with pizza"
  progressLabel: string;   // "We stopped at question 3 of 5"
  questionIndex: number;   // 3
  questionTotal: number;   // 5
}

export interface Subject {
  kind: SubjectKind;
  label: string;
  topic: string;
  color: string;           // theme token or hex
  soft: string;            // theme token or hex
}

export interface LearningStyleTrait {
  id: string;
  label: string;           // "Pictures & diagrams"
  score: number;           // 0..100
  color: string;           // theme token, e.g. "lavender"
}

export interface LearningProfile {
  traits: LearningStyleTrait[];
  note: string;            // the explanatory line under the bars
}

export interface WeekActivity {
  /** Mon..Sun, each 0..100 height percentage for the bar chart */
  bars: number[];
  totalLabel: string;      // "1h 12m"
  deltaLabel: string;      // "+18m"
  /** which weekday indexes are "done" (filled) in the streak row */
  doneDays: number[];
  todayIndex: number;
}

export interface RecapResult {
  minutes: number;
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: { ok: boolean; text: string }[];
  insightTitle: string;    // "You're a picture person!"
  insightBody: string;
  insightBadge: string;    // "VISUAL +1"
}
```

- [ ] **Step 4: Create `packages/shared/src/index.ts`**

```ts
export * from './domain';
```

- [ ] **Step 5: Install and typecheck**

Run:
```bash
pnpm install
pnpm --filter @study-buddy/shared typecheck
```
Expected: install completes; typecheck exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): add domain type contracts"
```

---

## Task 3: `apps/web` — Vite + React + TS scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx` (temporary hello)
- Create: `apps/web/src/vite-env.d.ts`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@study-buddy/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@study-buddy/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.11"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "useDefineForClassFields": true,
    "allowImportingTsExtensions": true,
    "moduleDetection": "force"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`** (Tailwind plugin added in Task 4)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Study Buddy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Create `apps/web/src/App.tsx`** (temporary)

```tsx
export default function App() {
  return <div>Study Buddy</div>;
}
```

- [ ] **Step 7: Create `apps/web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Install, typecheck, and run the dev server**

Run:
```bash
pnpm install
pnpm --filter @study-buddy/web typecheck
pnpm --filter @study-buddy/web dev
```
Expected: typecheck exits 0; dev server prints a Local URL; opening it shows "Study Buddy". Stop the server (Ctrl-C) after confirming.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): scaffold Vite + React + TS app"
```

---

## Task 4: Tailwind + design tokens + fonts + animations

> Verify the exact Tailwind v4 setup against current docs (context7: `tailwindcss`) before starting — the `@tailwindcss/vite` plugin and CSS-first `@theme` are the v4 mechanism. If the project ends up on Tailwind v3, the equivalent goes in `tailwind.config.ts`; the token VALUES below are unchanged either way.

**Files:**
- Modify: `apps/web/package.json` (add deps)
- Modify: `apps/web/vite.config.ts` (add Tailwind plugin)
- Create: `apps/web/src/index.css`
- Modify: `apps/web/src/main.tsx` (import the css)
- Reference: `docs/design-reference/project/theme.css`

- [ ] **Step 1: Add dependencies to `apps/web/package.json`**

Add to `dependencies`: `"@fontsource/bricolage-grotesque": "^5.1.0"`, `"@fontsource/nunito": "^5.1.0"`, `"@fontsource/jetbrains-mono": "^5.1.0"`. Add to `devDependencies`: `"tailwindcss": "^4.0.0"`, `"@tailwindcss/vite": "^4.0.0"`.

Then run `pnpm install`.

- [ ] **Step 2: Wire the Tailwind plugin in `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 3: Create `apps/web/src/index.css`** (tokens + fonts + keyframes)

```css
@import "tailwindcss";

/* self-hosted fonts (weights used by the design) */
@import "@fontsource/bricolage-grotesque/500.css";
@import "@fontsource/bricolage-grotesque/600.css";
@import "@fontsource/bricolage-grotesque/700.css";
@import "@fontsource/bricolage-grotesque/800.css";
@import "@fontsource/nunito/500.css";
@import "@fontsource/nunito/600.css";
@import "@fontsource/nunito/700.css";
@import "@fontsource/nunito/800.css";
@import "@fontsource/jetbrains-mono/500.css";
@import "@fontsource/jetbrains-mono/700.css";

@theme {
  --color-bg: #FFF4E8;
  --color-bg-2: #FBE6D0;
  --color-surface: #FFFFFF;
  --color-surface-2: #FFF9F1;
  --color-line: #F0DFC9;

  --color-ink: #2A1F18;
  --color-ink-2: #5B4A3D;
  --color-ink-3: #8B7A6B;
  --color-ink-4: #B8A89A;

  --color-coral: #FF7B5A;
  --color-coral-d: #E5614A;
  --color-coral-l: #FFD9CC;
  --color-mint: #4FCFA1;
  --color-mint-l: #C9F2DF;
  --color-lavender: #9D87E8;
  --color-lavender-l: #E0D7F7;
  --color-sun: #FFCB47;
  --color-sun-l: #FFE9AC;
  --color-sky: #5DB7FF;

  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-body: "Nunito", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-xl: 32px;

  --animate-pip-breathe: pip-breathe 3.6s ease-in-out infinite;
  --animate-pip-listen: pip-listen 1.1s ease-in-out infinite;
  --animate-pip-speak: pip-speak 0.45s ease-in-out infinite;
  --animate-pip-blink: pip-blink 4.8s ease-in-out infinite;
  --animate-ring-pulse: ring-pulse 2.2s ease-out infinite;
  --animate-wave-bar: wave-bar 0.7s ease-in-out infinite;
}

@keyframes pip-breathe {
  0%, 100% { transform: scale(1) translateY(0); }
  50%      { transform: scale(1.035) translateY(-2px); }
}
@keyframes pip-listen {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@keyframes pip-speak {
  0%   { transform: scale(1) rotate(-1deg); }
  25%  { transform: scale(1.04) rotate(1.5deg); }
  50%  { transform: scale(0.99) rotate(-1deg); }
  75%  { transform: scale(1.03) rotate(1deg); }
  100% { transform: scale(1) rotate(-1deg); }
}
@keyframes pip-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95%           { transform: scaleY(0.1); }
}
@keyframes ring-pulse {
  0%   { transform: scale(0.7); opacity: 0.55; }
  100% { transform: scale(1.6); opacity: 0; }
}
@keyframes wave-bar {
  0%, 100% { transform: scaleY(0.3); }
  50%      { transform: scaleY(1); }
}

@layer base {
  html, body, #root { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--font-body);
    color: var(--color-ink);
    background: #EEE9E3;
    -webkit-font-smoothing: antialiased;
  }
  /* muted scrollbars inside scrolling panes */
  .sb-scroll::-webkit-scrollbar { width: 0; height: 0; }
  .sb-scroll { scrollbar-width: none; }
}
```

- [ ] **Step 4: Import the css in `apps/web/src/main.tsx`**

Add as the first import: `import './index.css';`

- [ ] **Step 5: Prove tokens + fonts + an animation work — temporary App.tsx**

```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center gap-6">
      <div className="rounded-xl bg-coral px-6 py-4 font-display text-2xl font-extrabold text-white shadow-[0_4px_0_var(--color-coral-d)]">
        Pip
      </div>
      <div className="h-10 w-10 rounded-full bg-mint animate-pip-breathe" />
      <span className="font-mono text-ink-3">tokens OK</span>
    </div>
  );
}
```

- [ ] **Step 6: Run the dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: a cream page with a coral "Pip" pill (Bricolage Grotesque, hard coral-d shadow), a mint circle gently breathing, and "tokens OK" in JetBrains Mono. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add Tailwind theme tokens, fonts, and Pip animations"
```

---

## Task 5: Pip mascot component

**Files:**
- Create: `apps/web/src/components/Pip.tsx`
- Reference: `docs/design-reference/project/mascot.jsx`

Port `mascot.jsx` (the `Pip`, `Ring`, and `Waveform` functions). Keep the SVG `blobPath`, the cheeks/eyes/mouth, the per-`expression` eye offsets, and the per-`state` mouth/tongue exactly as in the reference. Replace the `animations` object's inline animation strings with the Tailwind `animate-pip-*` classes on the animated wrapper (`idle`→`animate-pip-breathe`, `listen`→`animate-pip-listen`, `speak`→`animate-pip-speak`, `cheer`→`animate-pip-listen` with a faster feel is fine to keep as `animate-pip-listen`, `think`→`animate-pip-breathe`). The drop-shadow `filter` and the listening `Ring`s (which use `ring-pulse` with staggered `animationDelay`) stay as inline `style` since they use computed/size-derived values.

- [ ] **Step 1: Create `apps/web/src/components/Pip.tsx`**

```tsx
import { useId } from 'react';

export type PipState = 'idle' | 'listen' | 'speak' | 'cheer' | 'think';
export type PipExpression = 'happy' | 'curious' | 'wink' | 'star';

const ANIM: Record<PipState, string> = {
  idle: 'animate-pip-breathe',
  listen: 'animate-pip-listen',
  speak: 'animate-pip-speak',
  cheer: 'animate-pip-listen',
  think: 'animate-pip-breathe',
};

const BLOB =
  'M50,5 C72,5 92,17 96,40 C100,63 92,84 72,93 C52,102 28,98 14,82 C0,66 -2,40 12,22 C23,8 35,5 50,5 Z';

export interface PipProps {
  size?: number;
  state?: PipState;
  color?: string;       // CSS color (hex or var). default coral token.
  shadow?: boolean;
  expression?: PipExpression;
}

export function Pip({
  size = 160,
  state = 'idle',
  color = 'var(--color-coral)',
  shadow = true,
  expression = 'happy',
}: PipProps) {
  const gid = useId();
  const eye =
    expression === 'curious' ? { y: 38, ry: 9 }
    : expression === 'wink' ? { y: 42, ry: 7 }
    : { y: 42, ry: 8 };
  const blink = state !== 'speak' && state !== 'cheer';

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className={ANIM[state]}
        style={{
          width: size,
          height: size,
          transformOrigin: 'center center',
          filter: shadow
            ? `drop-shadow(0 ${size * 0.06}px ${size * 0.12}px rgba(229,97,74,0.28))`
            : 'none',
        }}
      >
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <defs>
            <radialGradient id={gid} cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="white" stopOpacity="0.55" />
              <stop offset="40%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d={BLOB} fill={color} />
          <path d={BLOB} fill={`url(#${gid})`} />
          <ellipse cx="22" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />
          <ellipse cx="78" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />

          <g
            style={{ transformOrigin: '35px 42px' }}
            className={blink ? 'animate-pip-blink' : undefined}
          >
            <ellipse cx="35" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
            <circle cx="36.4" cy={eye.y - 2.2} r="1.6" fill="white" />
          </g>
          <g
            style={{ transformOrigin: '65px 42px', animationDelay: '0.1s' }}
            className={blink ? 'animate-pip-blink' : undefined}
          >
            {expression === 'wink' ? (
              <path d="M60 42 Q65 39 70 42" stroke="#2A1F18" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            ) : (
              <>
                <ellipse cx="65" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
                <circle cx="66.4" cy={eye.y - 2.2} r="1.6" fill="white" />
              </>
            )}
          </g>

          {state === 'speak' ? (
            <ellipse cx="50" cy="68" rx="7" ry="5" fill="#2A1F18" />
          ) : state === 'cheer' ? (
            <path d="M40 64 Q50 78 60 64" stroke="#2A1F18" strokeWidth="3" fill="#2A1F18" strokeLinejoin="round" />
          ) : state === 'think' ? (
            <path d="M44 68 L56 68" stroke="#2A1F18" strokeWidth="3" strokeLinecap="round" />
          ) : (
            <path d="M42 64 Q50 72 58 64" stroke="#2A1F18" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          )}
          {state === 'speak' && <ellipse cx="50" cy="71" rx="3.5" ry="2" fill="#FF6688" />}
        </svg>
      </div>

      {state === 'listen' && (
        <>
          <Ring size={size} delay={0} color={color} />
          <Ring size={size} delay={0.7} color={color} />
          <Ring size={size} delay={1.4} color={color} />
        </>
      )}
    </div>
  );
}

function Ring({ size, delay, color }: { size: number; delay: number; color: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-full animate-ring-pulse"
      style={{ border: `2px solid ${color}`, opacity: 0, animationDelay: `${delay}s` }}
    />
  );
}
```

- [ ] **Step 2: Temporarily render Pip in `App.tsx` to eyeball it**

Replace `App.tsx` body with a row of `<Pip size={120} state="idle" />`, `state="listen"`, `state="speak"`, `state="cheer"`, `state="think"` on a `bg-bg` page.

- [ ] **Step 3: Run dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: five coral blobs with eyes; idle breathes, listen shows expanding rings, speak has an open mouth + tongue and wobbles, cheer grins, think is a flat mouth. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add Pip mascot component"
```

---

## Task 6: UI atoms — icons & glyphs

**Files:**
- Create: `apps/web/src/components/ui/icons.tsx`
- Reference: `docs/design-reference/project/ui.jsx` (`SBStar`, `SBFlame`, `SBSparkle`, `SubjectIcon`, `NavIcon`)

Port these five into one `icons.tsx` module as named exports `Star`, `Flame`, `Sparkle`, `SubjectIcon`, `NavIcon`. They are pure SVG — keep every path exactly as in the reference. Convert `color`/`fill` defaults that used `var(--…)` to the same `var(--color-…)` form, or accept a `color` prop string. `SubjectIcon` takes `kind: SubjectKind` (import from `@study-buddy/shared`). `NavIcon` takes `kind: 'home' | 'library' | 'profile'`, `active: boolean`, plus `color`/`mute` color strings.

- [ ] **Step 1: Create `apps/web/src/components/ui/icons.tsx`** with the five components.

Signatures to match (fill in the SVG bodies from the reference verbatim):

```tsx
import type { SubjectKind } from '@study-buddy/shared';

export function Star({ size = 18, filled = true, color = 'var(--color-sun)' }:
  { size?: number; filled?: boolean; color?: string }) { /* SBStar path */ }

export function Flame({ size = 18, color = 'var(--color-coral)' }:
  { size?: number; color?: string }) { /* SBFlame two-path */ }

export function Sparkle({ size = 14, color = 'var(--color-lavender)' }:
  { size?: number; color?: string }) { /* SBSparkle path */ }

export function SubjectIcon({ kind, size = 28, color = 'white' }:
  { kind: SubjectKind; size?: number; color?: string }) { /* map of 6 SVGs */ }

export function NavIcon({ kind, active, color, mute }:
  { kind: 'home' | 'library' | 'profile'; active: boolean; color: string; mute: string }) { /* map of 3 SVGs */ }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): add icon/glyph atoms"
```

---

## Task 7: UI atoms — surfaces & controls

**Files:**
- Create: `apps/web/src/components/ui/Card.tsx`
- Create: `apps/web/src/components/ui/Button.tsx`
- Create: `apps/web/src/components/ui/HintChip.tsx`
- Create: `apps/web/src/components/ui/Bubble.tsx`
- Create: `apps/web/src/components/ui/SectionTitle.tsx`
- Create: `apps/web/src/components/ui/StyleBadge.tsx`
- Create: `apps/web/src/components/ui/Waveform.tsx`
- Create: `apps/web/src/components/ui/BottomNav.tsx`
- Reference: `docs/design-reference/project/ui.jsx` (`SBCard`, `SBButton`, `HintChip`, `Bubble`, `SectionTitle`, `StyleBadge`, `BottomNav`) and `mascot.jsx` (`Waveform`)

Port each, converting inline styles to Tailwind per the token map. Keep props faithful. `Button` keeps the variant/size maps; render the hard shadow via arbitrary value per variant. `BottomNav` uses `NavIcon` + react-router `Link`/`NavLink` (wired in Task 9); for this task accept `active: 'home'|'library'|'profile'` and an `accent` color string and render static.

- [ ] **Step 1: Create `apps/web/src/components/ui/Button.tsx`**

```tsx
import type { CSSProperties, ReactNode } from 'react';

type Kind = 'primary' | 'soft' | 'ghost' | 'mint' | 'dark';
type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, string> = {
  sm: 'px-[14px] py-2 text-[13px]',
  md: 'px-5 py-3 text-[15px]',
  lg: 'px-7 py-4 text-[17px]',
};

const KIND: Record<Kind, string> = {
  primary: 'bg-coral text-white shadow-[0_4px_0_var(--color-coral-d)]',
  soft: 'bg-coral-l text-coral-d',
  ghost: 'bg-transparent text-ink-2 shadow-[inset_0_0_0_1.5px_var(--color-line)]',
  mint: 'bg-mint text-white shadow-[0_4px_0_#2FA77F]',
  dark: 'bg-ink text-white shadow-[0_4px_0_#0F0907]',
};

export interface ButtonProps {
  children: ReactNode;
  kind?: Kind;
  size?: Size;
  full?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function Button({
  children, kind = 'primary', size = 'md', full = false, onClick, style, className = '',
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={`cursor-pointer rounded-full border-0 font-body font-extrabold transition-transform active:translate-y-0.5 ${SIZE[size]} ${KIND[kind]} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create the remaining six atoms** (`Card`, `HintChip`, `Bubble`, `SectionTitle`, `StyleBadge`, `Waveform`) and the static `BottomNav`, porting from the reference. Key signatures:

```tsx
// Card.tsx
export function Card({ children, className = '', style }:
  { children: ReactNode; className?: string; style?: CSSProperties }) { /* rounded surface; default bg-surface rounded-lg p-4 */ }

// HintChip.tsx — pill, bg-surface, 1.5px border-line, font-body font-bold text-[13px] text-ink-2, optional leading icon
// Bubble.tsx — from: 'pip' | 'user'; pip = bg-surface text-ink left; user = bg-coral text-white right; tail via asymmetric radii
// SectionTitle.tsx — { children, action? }; display font, optional coral-d action text on the right
// StyleBadge.tsx — { icon, label, score, color }; icon tile + label + progress bar (width = score%) + mono score
// Waveform.tsx — { active?, color?, bars?, height? }; row of bars each animate-wave-bar with per-bar delay/duration via inline style
// BottomNav.tsx — { active, accent }; three items Home/Subjects/Me using NavIcon
```

For `StyleBadge`'s bar fill and `Waveform`'s per-bar timing, use inline `style` for the computed `width`/`animationDelay`/`animationDuration`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): add surface and control atoms"
```

---

## Task 8: Data seam — fixtures, repository, hook

**Files:**
- Create: `apps/web/src/data/repository.ts`
- Create: `apps/web/src/data/fixtures.ts`
- Create: `apps/web/src/data/mockRepository.ts`
- Create: `apps/web/src/data/index.ts`
- Create: `apps/web/src/hooks/useResource.ts`
- Reference: the screen files in `docs/design-reference/project/screens/` for the exact mock values (names, numbers, copy).

- [ ] **Step 1: Create `apps/web/src/data/repository.ts`**

```ts
import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';

export interface Repository {
  getStudent(): Promise<Student>;
  getContinueSession(): Promise<ContinueSession>;
  getTodayAssignments(): Promise<Assignment[]>;
  getSubjects(): Promise<Subject[]>;
  getLearningProfile(): Promise<LearningProfile>;
  getWeekActivity(): Promise<WeekActivity>;
  getRecap(): Promise<RecapResult>;
}
```

- [ ] **Step 2: Create `apps/web/src/data/fixtures.ts`**

Populate with the exact values from the prototype screens (student "Maya", `streakDays: 5`, `starsToday: 3/4`; continue = "Fractions with pizza", 3 of 5; today's assignments Reading/Math/Spelling with their colors+stars; the six subjects from `library.jsx`; the four learning traits 82/68/54/41 from `profile.jsx`; week activity bars `[60,35,80,20,75,0,0]`, "1h 12m"/"+18m", doneDays `[0,1,2,3,4]`, todayIndex 4 from `web.jsx`/`profile.jsx`; recap = 14 minutes, 2/3 stars, 4/5 solved, the four "figured out" rows + the "picture person" insight from `recap.jsx`). Export each as a typed const.

- [ ] **Step 3: Create `apps/web/src/data/mockRepository.ts`**

```ts
import type { Repository } from './repository';
import * as fx from './fixtures';

const ok = <T>(value: T): Promise<T> => Promise.resolve(value);

export const mockRepository: Repository = {
  getStudent: () => ok(fx.student),
  getContinueSession: () => ok(fx.continueSession),
  getTodayAssignments: () => ok(fx.todayAssignments),
  getSubjects: () => ok(fx.subjects),
  getLearningProfile: () => ok(fx.learningProfile),
  getWeekActivity: () => ok(fx.weekActivity),
  getRecap: () => ok(fx.recap),
};
```

- [ ] **Step 4: Create `apps/web/src/data/index.ts`**

```ts
import { mockRepository } from './mockRepository';
import type { Repository } from './repository';

// Single seam. SP2 swaps this for an API-backed implementation.
export const repository: Repository = mockRepository;
export type { Repository } from './repository';
```

- [ ] **Step 5: Create `apps/web/src/hooks/useResource.ts`**

```ts
import { useEffect, useState } from 'react';

export function useResource<T>(loader: () => Promise<T>): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    let live = true;
    loader().then((d) => { if (live) setData(d); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add mock data repository seam and useResource hook"
```

---

## Task 9: Pip color context + router shell + AppLayout

**Files:**
- Create: `apps/web/src/state/PipColorContext.tsx`
- Create: `apps/web/src/routes/app/AppLayout.tsx`
- Modify: `apps/web/src/components/ui/BottomNav.tsx` (use react-router `NavLink`)
- Rewrite: `apps/web/src/App.tsx` (router)
- Create placeholder route files: `apps/web/src/routes/app/{Home,Library,Profile,Voice,Recap}Route.tsx` and `apps/web/src/routes/dashboard/DashboardRoute.tsx` (each a stub returning its name; real content in Tasks 10–13).

- [ ] **Step 1: Create `apps/web/src/state/PipColorContext.tsx`**

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PipColor } from '@study-buddy/shared';

const TOKEN: Record<PipColor, string> = {
  coral: 'var(--color-coral)',
  mint: 'var(--color-mint)',
  lavender: 'var(--color-lavender)',
  sun: 'var(--color-sun)',
  sky: 'var(--color-sky)',
};

interface Ctx {
  pipColor: PipColor;
  pipColorValue: string;   // CSS color for the current pipColor
  setPipColor: (c: PipColor) => void;
}

const PipColorCtx = createContext<Ctx | null>(null);

export function PipColorProvider({ initial = 'coral', children }:
  { initial?: PipColor; children: ReactNode }) {
  const [pipColor, setPipColor] = useState<PipColor>(initial);
  return (
    <PipColorCtx.Provider value={{ pipColor, pipColorValue: TOKEN[pipColor], setPipColor }}>
      {children}
    </PipColorCtx.Provider>
  );
}

export function usePipColor(): Ctx {
  const ctx = useContext(PipColorCtx);
  if (!ctx) throw new Error('usePipColor must be used within PipColorProvider');
  return ctx;
}

export const PIP_COLOR_VALUE = TOKEN;
```

- [ ] **Step 2: Update `BottomNav.tsx` to navigate**

Make each item a react-router `NavLink` to `/app` (home), `/app/subjects` (library), `/app/me` (profile); derive `active` from the `NavLink` render-prop `isActive`; color active items with the fixed coral accent, inactive with `text-ink-3`.

- [ ] **Step 3: Create `apps/web/src/routes/app/AppLayout.tsx`**

The phone shell: a centered, phone-width (max ~`420px`) column with `bg-bg`, full-height, that renders `<Outlet/>` and—unless the current route is `/app/voice` or `/app/recap`—the `BottomNav`. Include a small "Open dashboard" link (top corner) to `/dashboard`. Use `useLocation` to decide whether to show the nav.

```tsx
import { Outlet, useLocation, Link } from 'react-router-dom';
import { BottomNav } from '../../components/ui/BottomNav';

const NO_NAV = ['/app/voice', '/app/recap'];

export function AppLayout() {
  const { pathname } = useLocation();
  const showNav = !NO_NAV.includes(pathname);
  const active = pathname.startsWith('/app/subjects') ? 'library'
    : pathname.startsWith('/app/me') ? 'profile' : 'home';
  return (
    <div className="min-h-screen w-full bg-[#EEE9E3] flex justify-center">
      <div className="relative flex min-h-screen w-full max-w-[420px] flex-col overflow-hidden bg-bg shadow-xl">
        <Link to="/dashboard"
          className="absolute right-3 top-3 z-50 rounded-full bg-surface/80 px-3 py-1 font-body text-[11px] font-bold text-ink-3 backdrop-blur">
          Open dashboard ↗
        </Link>
        <div className="flex flex-1 flex-col overflow-y-auto sb-scroll">
          <Outlet />
        </div>
        {showNav && <BottomNav active={active} accent="var(--color-coral)" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the seven placeholder route components** (stub: a `div` with the screen name). Example `HomeRoute.tsx`:

```tsx
export function HomeRoute() { return <div className="p-6 font-display">Home</div>; }
```

(Do the same for `LibraryRoute`, `ProfileRoute`, `VoiceRoute`, `RecapRoute`, and `dashboard/DashboardRoute` exporting `DashboardRoute`.)

- [ ] **Step 5: Rewrite `apps/web/src/App.tsx`** as the router

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PipColorProvider } from './state/PipColorContext';
import { AppLayout } from './routes/app/AppLayout';
import { HomeRoute } from './routes/app/HomeRoute';
import { LibraryRoute } from './routes/app/LibraryRoute';
import { ProfileRoute } from './routes/app/ProfileRoute';
import { VoiceRoute } from './routes/app/VoiceRoute';
import { RecapRoute } from './routes/app/RecapRoute';
import { DashboardRoute } from './routes/dashboard/DashboardRoute';

export default function App() {
  return (
    <PipColorProvider initial="coral">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<HomeRoute />} />
            <Route path="subjects" element={<LibraryRoute />} />
            <Route path="me" element={<ProfileRoute />} />
            <Route path="voice" element={<VoiceRoute />} />
            <Route path="recap" element={<RecapRoute />} />
          </Route>
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </PipColorProvider>
  );
}
```

- [ ] **Step 6: Run dev server and confirm navigation**

Run: `pnpm --filter @study-buddy/web dev`
Expected: `/` redirects to `/app` (shows "Home" in a centered phone column with a bottom nav and an "Open dashboard" link); tapping nav items routes to Subjects/Me; visiting `/app/voice` hides the bottom nav; "Open dashboard" goes to `/dashboard` ("Dashboard" stub). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): add Pip color context, router, and phone app layout"
```

---

## Task 10: Home + Library screens

**Files:**
- Rewrite: `apps/web/src/routes/app/HomeRoute.tsx`
- Rewrite: `apps/web/src/routes/app/LibraryRoute.tsx`
- Create: `apps/web/src/components/AssignmentCard.tsx` (extracted from `home.jsx`)
- Reference: `docs/design-reference/project/screens/home.jsx`, `screens/library.jsx`

Port both screens. Read data via `useResource(() => repository.getStudent())` etc.; render nothing (or a simple `bg-bg` placeholder) until data resolves. Use `Pip` with `usePipColor().pipColorValue`. Wire actions: Home "Pick up where we left off" and each Library subject card + the "Just talk with Pip" card call `useNavigate()` → `/app/voice`.

- [ ] **Step 1: Port `HomeRoute.tsx`** — greeting (date + "Hi {student.name}!"), Pip greeting card, streak+stars stat row, "Today's adventures" section with the dark Continue card (peeking `Pip`, `onClick`→`/app/voice`) and the `AssignmentCard` list from `getTodayAssignments()`. Drop the `topInset`/`isAndroid` props from the reference (device-frame artifacts). Replace `BottomNav` (the layout renders it).

- [ ] **Step 2: Create `AssignmentCard.tsx`** porting the reference's `AssignmentCard`, typed with the `Assignment` fields; the icon tile background uses the assignment's `color` token via `style={{ background: 'var(--color-' + color + ')' }}` or a token lookup — keep colors faithful.

- [ ] **Step 3: Port `LibraryRoute.tsx`** — header, dark "Just talk with Pip" free-talk card (speaking `Pip`, `onClick`→`/app/voice`), and the 2-col subject grid from `getSubjects()` (each card `onClick`→`/app/voice`). Drop device-frame props and the in-screen `BottomNav`.

- [ ] **Step 4: Run dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: `/app` shows the full Home screen matching the reference; `/app/subjects` shows the subject grid; all start/continue affordances navigate to `/app/voice`. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): implement Home and Library screens"
```

---

## Task 11: Voice screen (visual-only)

**Files:**
- Rewrite: `apps/web/src/routes/app/VoiceRoute.tsx`
- Reference: `docs/design-reference/project/screens/voice.jsx`

Port the hero screen. The session is **visual-only** this slice: hold local state `const [active, setActive] = useState(true)` representing listening. The big mic toggles `active`; Pip's `state` is `active ? 'listen' : 'idle'` and the state chip reflects it. The transcript bubbles and hint chips are static (from the reference copy). The back chevron (top-left) and "End" both navigate (`useNavigate`): back → `/app`, End → `/app/recap`. Keep `ControlBtn` and `BigMic` as local components ported from the reference; `BigMic` shows pulse rings only when `active`.

- [ ] **Step 1: Port `VoiceRoute.tsx`** with the header, progress dots, big `Pip` (color from `usePipColor`), state chip (Waveform/dots per state), static transcript `Bubble`s, hint chips, and the Mute/Mic/End control row. Wire mic toggle + navigation. Drop `topInset`/`isAndroid`.

- [ ] **Step 2: Run dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: navigating from Home/Library lands on the Voice screen (no bottom nav); Pip animates listening with rings; tapping the mic toggles to idle and back; "End" → Recap; back chevron → Home. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): implement Voice session screen (visual-only)"
```

---

## Task 12: Recap screen

**Files:**
- Rewrite: `apps/web/src/routes/app/RecapRoute.tsx`
- Reference: `docs/design-reference/project/screens/recap.jsx`

Port the recap. Read `repository.getRecap()` and `getStudent()` for the name. Celebration header (sun gradient + confetti dots + `Pip state="cheer"` + "Awesome work, {name}!" + minutes), stars-earned + solved-self stats, the "What we figured out" checklist (ok→mint check, not-ok→sun warning), the "Pip noticed…" lavender insight card with the badge, and the Replay/Done buttons. Wire: "Done" → `/app`, "Replay session" → `/app/voice`. Drop device-frame props and the in-screen `BottomNav`.

- [ ] **Step 1: Port `RecapRoute.tsx`** per the reference, mapping `RecapResult` fields onto the markup.

- [ ] **Step 2: Run dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: reaching `/app/recap` (via Voice "End") shows the celebration, checklist, and insight; "Done" → Home; "Replay" → Voice. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): implement Recap screen"
```

---

## Task 13: Profile screen + live Pip recolor

**Files:**
- Rewrite: `apps/web/src/routes/app/ProfileRoute.tsx`
- Create: `apps/web/src/components/ui/Toggle.tsx` (ported from `profile.jsx`)
- Reference: `docs/design-reference/project/screens/profile.jsx`

Port Profile. The color picker reads `usePipColor()` and calls `setPipColor(c)` on tap; the selected swatch shows the ring; **Pip recolors live across all screens**. Read `getStudent()` (header), `getLearningProfile()` (the `StyleBadge` bars + note), `getWeekActivity()` (the streak row). The settings list toggles use local state via the ported `Toggle` (interactive, non-persistent). Drop device-frame props and the in-screen `BottomNav`.

- [ ] **Step 1: Create `Toggle.tsx`** (the sliding pill from the reference; `{ on, accent, onChange? }`).

- [ ] **Step 2: Port `ProfileRoute.tsx`**, wiring the color picker to `PipColorContext` and the swatch list to the five `PipColor`s.

- [ ] **Step 3: Run dev server and confirm the live recolor**

Run: `pnpm --filter @study-buddy/web dev`
Expected: `/app/me` shows the profile; tapping a color swatch immediately recolors the Pip on this screen, and navigating to Home/Voice shows Pip in the new color too; learning bars + streak match the reference; setting toggles flip. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): implement Profile screen with live Pip recolor"
```

---

## Task 14: Web dashboard (desktop)

**Files:**
- Rewrite: `apps/web/src/routes/dashboard/DashboardRoute.tsx`
- Reference: `docs/design-reference/project/screens/web.jsx`

Port the desktop dashboard as a full-viewport layout (no phone frame, no device chrome — the prototype's `WebDashboard` is just the page body). Left rail (Pip + "Study Buddy" wordmark, nav items, streak card, user chip) + main column (greeting + "Start a session", in-progress hero with large `Pip`, stats column with the weekly bar chart + "Pip's noticing" card, today's adventures 3-col grid). Wire nav/CTAs with `useNavigate`: "Start a session" / "Pick up where we left off" / each "Start →" / the rail's "Subjects" → `/app/voice` or the matching `/app/*` route as sensible; the rail "Today" stays on `/dashboard`. Add an "Open app ↗" link to `/app`. Use `useResource` for `getStudent`, `getWeekActivity`, `getLearningProfile`, `getContinueSession`, `getTodayAssignments`.

- [ ] **Step 1: Port `DashboardRoute.tsx`** per the reference; replace hardcoded "Maya"/numbers with repository data; add the "Open app" link.

- [ ] **Step 2: Run dev server and confirm**

Run: `pnpm --filter @study-buddy/web dev`
Expected: `/dashboard` shows the full desktop dashboard (left rail + hero + chart + grid) at desktop width; "Open app" → `/app`; CTAs navigate. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(web): implement desktop web dashboard"
```

---

## Task 15: Final wiring, README, full verification

**Files:**
- Create: `apps/web/README.md`
- Modify: any screen file with leftover device-frame props (`topInset`, `isAndroid`) — remove them.

- [ ] **Step 1: Grep for and remove leftover prototype artifacts**

Run: `grep -rn "topInset\|isAndroid\|BottomNav active=\"" apps/web/src` — confirm no `topInset`/`isAndroid` remain in screen props and that `BottomNav` is rendered only by `AppLayout`. Fix any stragglers.

- [ ] **Step 2: Create `apps/web/README.md`** documenting: what the app is, `pnpm install`, `pnpm dev`, the two route trees, the mock-data seam (and that SP2 swaps it), and the deferred subsystems.

- [ ] **Step 3: Full typecheck**

Run: `pnpm -r typecheck`
Expected: exits 0 across `@study-buddy/shared` and `@study-buddy/web`.

- [ ] **Step 4: Full production build**

Run: `pnpm --filter @study-buddy/web build`
Expected: build succeeds, emits `apps/web/dist`, no type or import errors.

- [ ] **Step 5: Manual click-through against the acceptance checklist**

Run: `pnpm --filter @study-buddy/web dev`, then verify each:
- `/` redirects to `/app`.
- Home renders fully and matches the reference.
- Bottom nav switches Home / Subjects / Me.
- Home "continue" and Library cards → Voice.
- Voice mic toggles listen/idle; "End" → Recap; back → Home.
- Recap "Done" → Home; "Replay" → Voice.
- Profile color picker recolors Pip everywhere.
- `/dashboard` renders the desktop layout; "Open app" → `/app`; "Open dashboard" (in app) → `/dashboard`.
Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(web): add README; final wiring and verification for UI foundation"
```

---

## Self-review notes (author checklist — already applied)

- **Spec coverage:** repo structure (T1–3), tokens/fonts/animations (T4), Pip (T5), atoms (T6–7), data seam + async (T8), PipColorContext + routing + two trees (T9, T14), all six screens (T10–14), verification (T15). ✓
- **Deferred items confirmed absent:** no voice/Gemini, backend, DB, auth, billing, or device frames in any task. ✓
- **Type consistency:** `Repository` method names match between `repository.ts`, `mockRepository.ts`, and screen usage; `PipColor`/`SubjectKind` imported from `@study-buddy/shared` everywhere. ✓
- **Tailwind version caveat:** flagged in T4 — values are version-independent; verify the v4 `@theme`/plugin mechanism against current docs at execution.
