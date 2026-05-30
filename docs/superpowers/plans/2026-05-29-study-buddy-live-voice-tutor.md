# Study Buddy SP3 — Live Voice Tutor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pip talk — a real-time spoken Socratic tutoring session in the browser, bridged through a Hono-on-Bun WebSocket relay to the Gemini Live API, with a live transcript and learning-style detection that nudges the child's stored profile.

**Architecture:** A thin server relay (`browser ⇄ our Hono WS ⇄ Gemini Live`) keeps the API key server-side and exposes a narrow WS envelope. The browser streams 16 kHz PCM mic audio up and plays 24 kHz PCM back; the relay holds the Gemini session, injects a Socratic system prompt + a `note_learning_signal` tool, accumulates signals, and commits bounded trait deltas to `learning_profile_traits` in one transaction at session end. Sessions resume transparently across Gemini's ~10-min connection lifetime and end at a ~10-min soft cap.

**Tech Stack:** Hono 4.x (Bun WS adapter) · Bun 1.x · `@google/genai` · `gemini-3.1-flash-live-preview` · Drizzle ORM + Postgres 16 · React 18 + Vite + TanStack Query · Web Audio API (AudioWorklet) · TypeScript strict · pnpm.

**Spec:** `docs/superpowers/specs/2026-05-29-study-buddy-live-voice-tutor-design.md`

---

## File Structure

```
packages/shared/src/
  voice.ts                     NEW — WS envelope + tool payload types (shared contract)
  index.ts                     MODIFY — re-export ./voice

apps/server/
  package.json                 MODIFY — add @google/genai
  src/voice/
    profileCommit.ts           NEW — pure delta/clamp/note logic + DB commit
    systemPrompt.ts            NEW — pure system-instruction assembly
    tools.ts                   NEW — note_learning_signal decl + signal parse/accumulate
    geminiSession.ts           NEW — GeminiLiveSession interface + real connector
    fakeGeminiSession.ts       NEW (test util) — scripted fake connector
    sessionRow.ts              NEW — create/finalize sessions rows
    relay.ts                   NEW — per-connection orchestrator (state machine)
    voiceRoute.ts              NEW — Hono WS endpoint wiring (createBunWebSocket)
  src/index.ts                 MODIFY — mount voice route + Bun.serve websocket handler
  test/voice/
    profileCommit.test.ts      NEW
    systemPrompt.test.ts       NEW
    tools.test.ts              NEW
    sessionRow.test.ts         NEW (against test DB)
    relay.test.ts              NEW (drives relay with fake Gemini + fake WS sink)

apps/web/
  src/voice/
    pcm.ts                     NEW — pure PCM conversion/resample helpers
    audioCapture.ts            NEW — mic → AudioWorklet → 16 kHz PCM16 frames
    audioPlayback.ts           NEW — 24 kHz PCM16 queue → AudioContext
    voiceReducer.ts            NEW — pure status/transcript reducer
    useVoiceSession.ts         NEW — hook wiring WS + capture + playback + reducer
  public/pcm-capture-worklet.js  NEW — AudioWorklet processor (downsample + emit)
  src/routes/app/VoiceRoute.tsx  MODIFY — rewire static mock → live hook + subject chooser
  src/routes/app/LibraryRoute.tsx     MODIFY — pass subject context on navigate
  src/routes/app/HomeRoute.tsx        MODIFY — pass subject context on continue/assignment
  src/routes/dashboard/DashboardRoute.tsx MODIFY — pass subject context on continue/assignment
  test/voice/
    pcm.test.ts                NEW
    voiceReducer.test.ts       NEW

.env.example                   MODIFY — add GEMINI_API_KEY
docker-compose.yml             MODIFY — pass GEMINI_API_KEY into server service
```

**Testing note:** the server suite already runs via `bun test` against a `studybuddy_test` Postgres (see `apps/server/test/setup.ts`). The web app has no test runner yet; Task 9 adds `bun test` for the two pure web modules (Bun can run `.test.ts` files directly without extra deps). The Gemini SDK sits behind the `GeminiConnector` interface so tests inject a fake — no real API calls in any test.

---

## Task 1: Shared voice contract + deps + secret config

**Files:**
- Create: `packages/shared/src/voice.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/package.json`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create the shared voice contract**

`packages/shared/src/voice.ts`:

```ts
import type { LearningTraitId, SubjectKind } from './domain';

/** Status of a live voice session, surfaced to the browser. */
export type VoiceStatus = 'live' | 'resuming' | 'ended';

/** Error codes the relay (or client) can raise. */
export type VoiceErrorCode = 'mic-denied' | 'gemini-unavailable' | 'connection-lost';

/** Browser → relay control messages. Audio is sent separately as binary frames. */
export type ClientControl =
  | { type: 'start'; subjectKind: SubjectKind; topic: string; title: string }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'end' };

/** Relay → browser control messages. Audio is sent separately as binary frames. */
export type ServerControl =
  | { type: 'ready' }
  | { type: 'transcript'; role: 'pip' | 'child'; text: string; final: boolean }
  | { type: 'interrupted' }
  | { type: 'status'; state: VoiceStatus }
  | { type: 'error'; code: VoiceErrorCode; message: string };

/** Learning-style signal Pip emits via function calling. */
export type LearningSignalStrength = 'weak' | 'strong';
export interface LearningSignal {
  trait: LearningTraitId;
  strength: LearningSignalStrength;
}
```

- [ ] **Step 2: Re-export from the shared barrel**

`packages/shared/src/index.ts` becomes:

```ts
export * from './domain';
export * from './voice';
```

- [ ] **Step 3: Add the Gemini SDK to the server**

In `apps/server/package.json`, add to `dependencies` (keep alphabetical-ish, after `@study-buddy/shared`):

```json
    "@google/genai": "^1.0.0",
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: lockfile updates, `@google/genai` present under `apps/server`.

- [ ] **Step 5: Add the secret to env files**

Append to `.env.example`:

```
# Gemini Live API (SP3 voice tutor) — server-side only, never exposed to the web app.
GEMINI_API_KEY=your-gemini-api-key
```

In `docker-compose.yml`, under `services.server.environment`, add:

```yaml
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: all three workspaces pass (shared now exports voice types).

- [ ] **Step 7: Commit**

```bash
git add packages/shared apps/server/package.json pnpm-lock.yaml .env.example docker-compose.yml
git commit -m "feat(sp3): shared voice contract + @google/genai dep + GEMINI_API_KEY config"
```

---

## Task 2: `profileCommit` pure logic (TDD)

**Files:**
- Create: `apps/server/src/voice/profileCommit.ts`
- Test: `apps/server/test/voice/profileCommit.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/profileCommit.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  computeTraitDeltas, applyTraitDeltas, noteFromDeltas,
} from '../../src/voice/profileCommit';
import type { LearningSignal } from '@study-buddy/shared';

describe('computeTraitDeltas', () => {
  it('sums weak (+2) and strong (+5) per trait', () => {
    const signals: LearningSignal[] = [
      { trait: 'visual', strength: 'strong' },
      { trait: 'visual', strength: 'weak' },
      { trait: 'auditory', strength: 'weak' },
    ];
    expect(computeTraitDeltas(signals)).toEqual({ visual: 7, auditory: 2 });
  });

  it('caps a single trait at +10 per session', () => {
    const signals: LearningSignal[] = Array.from({ length: 5 }, () => ({
      trait: 'visual' as const, strength: 'strong' as const,
    })); // 25 raw
    expect(computeTraitDeltas(signals)).toEqual({ visual: 10 });
  });

  it('returns {} for no signals', () => {
    expect(computeTraitDeltas([])).toEqual({});
  });
});

describe('applyTraitDeltas', () => {
  it('adds deltas and clamps to 0..100', () => {
    const current = [
      { traitId: 'visual' as const, score: 96 },
      { traitId: 'auditory' as const, score: 41 },
      { traitId: 'narrative' as const, score: 68 },
    ];
    const out = applyTraitDeltas(current, { visual: 7, auditory: 2 });
    expect(out).toEqual([
      { traitId: 'visual', score: 100 }, // 96+7 clamped
      { traitId: 'auditory', score: 43 },
      { traitId: 'narrative', score: 68 }, // untouched
    ]);
  });
});

describe('noteFromDeltas', () => {
  it('picks the note for the largest positive delta', () => {
    expect(noteFromDeltas({ visual: 7, auditory: 2 })).toContain('draw');
  });
  it('returns null when nothing moved', () => {
    expect(noteFromDeltas({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/profileCommit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure logic**

`apps/server/src/voice/profileCommit.ts`:

```ts
import type { LearningSignal, LearningTraitId } from '@study-buddy/shared';

const DELTA: Record<LearningSignal['strength'], number> = { weak: 2, strong: 5 };
const MAX_SESSION_MOVE = 10;

export interface TraitScore {
  traitId: LearningTraitId;
  score: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Sum signals into per-trait deltas, each capped to ±MAX_SESSION_MOVE. */
export function computeTraitDeltas(signals: LearningSignal[]): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const s of signals) raw[s.trait] = (raw[s.trait] ?? 0) + DELTA[s.strength];
  const capped: Record<string, number> = {};
  for (const t of Object.keys(raw)) {
    capped[t] = clamp(raw[t], -MAX_SESSION_MOVE, MAX_SESSION_MOVE);
  }
  return capped;
}

/** Apply deltas to current trait scores, clamped to 0..100. */
export function applyTraitDeltas(
  current: TraitScore[],
  deltas: Record<string, number>,
): TraitScore[] {
  return current.map((t) => ({
    traitId: t.traitId,
    score: clamp(t.score + (deltas[t.traitId] ?? 0), 0, 100),
  }));
}

const NOTE_BY_TRAIT: Record<LearningTraitId, string> = {
  visual: 'Lately you light up when we draw things out.',
  narrative: 'Lately you learn best when we turn it into a little story.',
  kinesthetic: 'Lately you do your best thinking when we act it out.',
  auditory: 'Lately you really tune in when we talk it through out loud.',
};

/** A refreshed profile note from the trait that moved up the most (null if none). */
export function noteFromDeltas(deltas: Record<string, number>): string | null {
  let best: LearningTraitId | null = null;
  let bestVal = 0;
  for (const [t, v] of Object.entries(deltas)) {
    if (v > bestVal) { bestVal = v; best = t as LearningTraitId; }
  }
  return best ? NOTE_BY_TRAIT[best] : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/profileCommit.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/profileCommit.ts apps/server/test/voice/profileCommit.test.ts
git commit -m "feat(sp3): profile-commit delta/clamp/note pure logic"
```

---

## Task 3: `systemPrompt` assembly (TDD)

**Files:**
- Create: `apps/server/src/voice/systemPrompt.ts`
- Test: `apps/server/test/voice/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/systemPrompt.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { buildSystemInstruction } from '../../src/voice/systemPrompt';

const base = {
  childName: 'Maya',
  grade: 3,
  subjectKind: 'math' as const,
  topic: 'Word problems',
  traits: [
    { traitId: 'visual' as const, label: 'Pictures & diagrams', score: 82 },
    { traitId: 'auditory' as const, label: 'Hearing it out loud', score: 41 },
  ],
};

describe('buildSystemInstruction', () => {
  it('includes the child, grade, subject, and topic', () => {
    const out = buildSystemInstruction(base);
    expect(out).toContain('Maya');
    expect(out).toContain('grade 3');
    expect(out).toContain('Math');
    expect(out).toContain('Word problems');
  });

  it('states the Socratic never-give-the-answer rule', () => {
    const out = buildSystemInstruction(base).toLowerCase();
    expect(out).toContain('never');
    expect(out).toContain('answer');
  });

  it('mentions the highest-scoring trait', () => {
    expect(buildSystemInstruction(base).toLowerCase()).toContain('pictures & diagrams'.toLowerCase());
  });

  it('instructs Pip to call the learning-signal tool', () => {
    expect(buildSystemInstruction(base)).toContain('note_learning_signal');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/systemPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/voice/systemPrompt.ts`:

```ts
import type { LearningStyleTrait, SubjectKind } from '@study-buddy/shared';

export interface SystemPromptInput {
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
  traits: LearningStyleTrait[];
}

const SUBJECT_NAME: Record<SubjectKind, string> = {
  math: 'Math', reading: 'Reading', science: 'Science',
  writing: 'Writing', spanish: 'Spanish', social: 'Social Studies',
};

export function buildSystemInstruction(i: SystemPromptInput): string {
  const top = [...i.traits].sort((a, b) => b.score - a.score)[0];
  const lean = top
    ? `${i.childName} tends to learn best through ${top.label.toLowerCase()}; lean into that when it helps.`
    : '';
  return [
    `You are Pip, a warm, patient, encouraging tutor for ${i.childName}, a grade ${i.grade} student.`,
    `You are helping with ${SUBJECT_NAME[i.subjectKind]} — specifically "${i.topic}".`,
    `SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If ${i.childName} is stuck, break the problem into one smaller step and ask again.`,
    lean,
    `Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.`,
    `If ${i.childName} goes off-topic or seems upset, gently steer back. Do not lecture.`,
    `When you notice ${i.childName} responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.`,
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/systemPrompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/systemPrompt.ts apps/server/test/voice/systemPrompt.test.ts
git commit -m "feat(sp3): Socratic system-prompt assembly"
```

---

## Task 4: `tools` — declaration + signal parsing/accumulation (TDD)

**Files:**
- Create: `apps/server/src/voice/tools.ts`
- Test: `apps/server/test/voice/tools.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/tools.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  noteLearningSignalDeclaration, parseLearningSignal, SignalAccumulator,
} from '../../src/voice/tools';

describe('noteLearningSignalDeclaration', () => {
  it('is named note_learning_signal with trait + strength params', () => {
    expect(noteLearningSignalDeclaration.name).toBe('note_learning_signal');
    const props = noteLearningSignalDeclaration.parameters?.properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['strength', 'trait']);
  });
});

describe('parseLearningSignal', () => {
  it('accepts a valid trait + strength', () => {
    expect(parseLearningSignal({ trait: 'visual', strength: 'strong' }))
      .toEqual({ trait: 'visual', strength: 'strong' });
  });
  it('rejects unknown trait', () => {
    expect(parseLearningSignal({ trait: 'taste', strength: 'weak' })).toBeNull();
  });
  it('rejects missing strength', () => {
    expect(parseLearningSignal({ trait: 'visual' })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(parseLearningSignal(null)).toBeNull();
    expect(parseLearningSignal('visual')).toBeNull();
  });
});

describe('SignalAccumulator', () => {
  it('collects valid signals and ignores invalid ones via addRaw', () => {
    const acc = new SignalAccumulator();
    expect(acc.addRaw({ trait: 'visual', strength: 'weak' })).toBe(true);
    expect(acc.addRaw({ trait: 'nope', strength: 'weak' })).toBe(false);
    expect(acc.all()).toEqual([{ trait: 'visual', strength: 'weak' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/voice/tools.ts`:

```ts
import { Type, type FunctionDeclaration } from '@google/genai';
import type {
  LearningSignal, LearningSignalStrength, LearningTraitId,
} from '@study-buddy/shared';

export const noteLearningSignalDeclaration: FunctionDeclaration = {
  name: 'note_learning_signal',
  description:
    'Record that the child responded well to a particular learning approach. ' +
    'Call this whenever you notice it; keep the conversation natural.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trait: {
        type: Type.STRING,
        enum: ['visual', 'narrative', 'kinesthetic', 'auditory'],
        description: 'Which learning style the child responded to.',
      },
      strength: {
        type: Type.STRING,
        enum: ['weak', 'strong'],
        description: 'How strong the signal was.',
      },
    },
    required: ['trait', 'strength'],
  },
};

const TRAITS: readonly string[] = ['visual', 'narrative', 'kinesthetic', 'auditory'];
const STRENGTHS: readonly string[] = ['weak', 'strong'];

/** Validate + coerce a raw tool-call arg object into a LearningSignal, or null. */
export function parseLearningSignal(args: unknown): LearningSignal | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a.trait !== 'string' || !TRAITS.includes(a.trait)) return null;
  if (typeof a.strength !== 'string' || !STRENGTHS.includes(a.strength)) return null;
  return {
    trait: a.trait as LearningTraitId,
    strength: a.strength as LearningSignalStrength,
  };
}

/** In-session accumulator for learning signals. */
export class SignalAccumulator {
  private signals: LearningSignal[] = [];
  addRaw(args: unknown): boolean {
    const s = parseLearningSignal(args);
    if (!s) return false;
    this.signals.push(s);
    return true;
  }
  all(): LearningSignal[] {
    return [...this.signals];
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/tools.test.ts`
Expected: PASS. If `Type` is not exported by the installed `@google/genai`, check the version and use the documented enum import; do not hardcode strings for `type`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/tools.ts apps/server/test/voice/tools.test.ts
git commit -m "feat(sp3): note_learning_signal tool declaration + signal accumulator"
```

---

## Task 5: `sessionRow` create/finalize (TDD against test DB)

**Files:**
- Create: `apps/server/src/voice/sessionRow.ts`
- Test: `apps/server/test/voice/sessionRow.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/sessionRow.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';

const MAYA_ID = '00000000-0000-0000-0000-000000000001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  mod = await import('../../src/voice/sessionRow');
});

describe('sessionRow', () => {
  it('creates an in_progress row and finalizes it completed', async () => {
    const id = await mod.createLiveSession(MAYA_ID, 'math', 'Word problems');
    expect(typeof id).toBe('string');

    await mod.finalizeLiveSession(id, 'completed');

    const row = await mod.getSessionById(id);
    expect(row.state).toBe('completed');
    expect(row.subjectKind).toBe('math');
    expect(row.title).toBe('Word problems');
    expect(row.endedAt).not.toBeNull();
  });

  it('finalizes a dropped session as abandoned', async () => {
    const id = await mod.createLiveSession(MAYA_ID, 'reading', "Charlotte's Web");
    await mod.finalizeLiveSession(id, 'abandoned');
    const row = await mod.getSessionById(id);
    expect(row.state).toBe('abandoned');
  });
});
```

- [ ] **Step 2: Start the test Postgres (if not already running)**

Run: `docker compose up -d postgres`
Expected: `postgres` healthy. (Tests target `localhost:5432` per `test/setup.ts`; override with `PG_TEST_PORT` if your local 5432 is occupied.)

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/sessionRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`apps/server/src/voice/sessionRow.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { SubjectKind } from '@study-buddy/shared';

export type FinalState = 'completed' | 'abandoned';

/** Insert an in_progress session row for a live voice session; returns its id. */
export async function createLiveSession(
  childId: string,
  subjectKind: SubjectKind,
  title: string,
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({ childId, subjectKind, title, state: 'in_progress' })
    .returning({ id: sessions.id });
  return row.id;
}

/** Mark a live session completed/abandoned and stamp endedAt. */
export async function finalizeLiveSession(id: string, state: FinalState): Promise<void> {
  await db
    .update(sessions)
    .set({ state, endedAt: new Date() })
    .where(eq(sessions.id, id));
}

/** Test/diagnostic helper. */
export async function getSessionById(id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/sessionRow.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/voice/sessionRow.ts apps/server/test/voice/sessionRow.test.ts
git commit -m "feat(sp3): create/finalize live session rows"
```

---

## Task 6: `profileCommit` DB write (TDD against test DB)

**Files:**
- Modify: `apps/server/src/voice/profileCommit.ts` (add `commitLearningProfile`)
- Test: `apps/server/test/voice/profileCommit.db.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/profileCommit.db.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import type { LearningSignal } from '@study-buddy/shared';

const MAYA_ID = '00000000-0000-0000-0000-000000000001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  mod = await import('../../src/voice/profileCommit');
});

describe('commitLearningProfile', () => {
  it('raises the visual score and refreshes the note', async () => {
    const before = await mod.readTraitScores(MAYA_ID); // { visual: 82, ... }
    const signals: LearningSignal[] = [
      { trait: 'visual', strength: 'strong' },
      { trait: 'visual', strength: 'weak' }, // +7 total
    ];
    await mod.commitLearningProfile(MAYA_ID, signals);

    const after = await mod.readTraitScores(MAYA_ID);
    expect(after.visual).toBe(Math.min(100, before.visual + 7));
    expect(after.auditory).toBe(before.auditory); // untouched
  });

  it('is a no-op for an empty signal list', async () => {
    const before = await mod.readTraitScores(MAYA_ID);
    await mod.commitLearningProfile(MAYA_ID, []);
    const after = await mod.readTraitScores(MAYA_ID);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/profileCommit.db.test.ts`
Expected: FAIL — `commitLearningProfile`/`readTraitScores` not exported.

- [ ] **Step 3: Implement the DB commit (append to `profileCommit.ts`)**

Add these imports at the top of `apps/server/src/voice/profileCommit.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { learningProfiles, learningProfileTraits } from '../db/schema';
import type { LearningTraitId as TraitId } from '@study-buddy/shared';
```

Append to the bottom of the same file:

```ts
/** Read the current trait scores for a child as { traitId: score }. */
export async function readTraitScores(childId: string): Promise<Record<string, number>> {
  const [profile] = await db
    .select({ id: learningProfiles.id })
    .from(learningProfiles)
    .where(eq(learningProfiles.childId, childId))
    .limit(1);
  if (!profile) return {};
  const rows = await db
    .select({ traitId: learningProfileTraits.traitId, score: learningProfileTraits.score })
    .from(learningProfileTraits)
    .where(eq(learningProfileTraits.profileId, profile.id));
  return Object.fromEntries(rows.map((r) => [r.traitId, r.score]));
}

/** Commit accumulated signals to the child's profile in one transaction. */
export async function commitLearningProfile(
  childId: string,
  signals: { trait: TraitId; strength: 'weak' | 'strong' }[],
): Promise<void> {
  if (signals.length === 0) return;
  const deltas = computeTraitDeltas(signals);
  if (Object.keys(deltas).length === 0) return;

  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: learningProfiles.id })
      .from(learningProfiles)
      .where(eq(learningProfiles.childId, childId))
      .limit(1);
    if (!profile) return;

    const current = await tx
      .select({ traitId: learningProfileTraits.traitId, score: learningProfileTraits.score })
      .from(learningProfileTraits)
      .where(eq(learningProfileTraits.profileId, profile.id));

    const updated = applyTraitDeltas(
      current.map((r) => ({ traitId: r.traitId as TraitId, score: r.score })),
      deltas,
    );

    const now = new Date();
    for (const t of updated) {
      await tx
        .update(learningProfileTraits)
        .set({ score: t.score, updatedAt: now })
        .where(and(
          eq(learningProfileTraits.profileId, profile.id),
          eq(learningProfileTraits.traitId, t.traitId),
        ));
    }

    const note = noteFromDeltas(deltas);
    if (note) {
      await tx
        .update(learningProfiles)
        .set({ note, updatedAt: now })
        .where(eq(learningProfiles.id, profile.id));
    }
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/profileCommit.db.test.ts`
Expected: PASS. (Run the pure test too: `bun test test/voice/profileCommit.test.ts` — still green.)

> **Test ordering note:** `commitLearningProfile` mutates Maya's seeded scores. Keep DB-mutating assertions relative to a freshly-read `before` (as written) so the test is order-independent.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/profileCommit.ts apps/server/test/voice/profileCommit.db.test.ts
git commit -m "feat(sp3): transactional learning-profile commit"
```

---

## Task 7: Gemini session interface + real connector + fake

**Files:**
- Create: `apps/server/src/voice/geminiSession.ts`
- Create: `apps/server/src/voice/fakeGeminiSession.ts`

> The real connector is a thin SDK wrapper verified in the manual smoke (Task 13); the interface + fake are what the relay test (Task 8) drives. No automated test hits the real API.

- [ ] **Step 1: Define the interface + events + connector type**

`apps/server/src/voice/geminiSession.ts`:

```ts
import { GoogleGenAI, Modality } from '@google/genai';
import { noteLearningSignalDeclaration } from './tools';

/** Events the relay reacts to. */
export interface GeminiEvents {
  onAudio: (pcm24k: Uint8Array) => void;
  onInputTranscript: (text: string, final: boolean) => void;
  onOutputTranscript: (text: string, final: boolean) => void;
  onInterrupted: () => void;
  onToolCall: (id: string, name: string, args: unknown) => void;
  onResumptionHandle: (handle: string) => void;
  onClose: (reason: string) => void;
  onError: (err: unknown) => void;
}

/** What the relay can do to a live session. */
export interface GeminiLiveSession {
  sendAudio(pcm16k: Uint8Array): void;
  sendText(text: string): void;
  ackTool(id: string, name: string): void;
  audioStreamEnd(): void;
  close(): Promise<void>;
}

export interface GeminiConnectOptions {
  systemInstruction: string;
  resumptionHandle?: string;
}

/** Injectable factory — real impl in prod, fake in tests. */
export type GeminiConnector = (
  opts: GeminiConnectOptions,
  events: GeminiEvents,
) => Promise<GeminiLiveSession>;

const MODEL = 'gemini-3.1-flash-live-preview';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Production connector backed by @google/genai. */
export function makeGeminiConnector(apiKey: string): GeminiConnector {
  const ai = new GoogleGenAI({ apiKey });
  return async (opts, events) => {
    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: opts.systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [noteLearningSignalDeclaration] }],
        sessionResumption: opts.resumptionHandle
          ? { handle: opts.resumptionHandle }
          : {},
      },
      callbacks: {
        onopen: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onmessage: (msg: any) => {
          const sc = msg.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData?.data) events.onAudio(fromBase64(part.inlineData.data));
            }
          }
          if (sc?.inputTranscription?.text) {
            events.onInputTranscript(sc.inputTranscription.text, !!sc.inputTranscription.finished);
          }
          if (sc?.outputTranscription?.text) {
            events.onOutputTranscript(sc.outputTranscription.text, !!sc.outputTranscription.finished);
          }
          if (sc?.interrupted) events.onInterrupted();
          if (msg.toolCall?.functionCalls) {
            for (const fc of msg.toolCall.functionCalls) {
              events.onToolCall(fc.id ?? '', fc.name ?? '', fc.args);
            }
          }
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
            events.onResumptionHandle(msg.sessionResumptionUpdate.newHandle);
          }
        },
        onerror: (e: unknown) => events.onError(e),
        onclose: (e: unknown) => events.onClose(String((e as { reason?: string })?.reason ?? 'closed')),
      },
    });

    return {
      sendAudio: (pcm) =>
        session.sendRealtimeInput({ audio: { data: toBase64(pcm), mimeType: 'audio/pcm;rate=16000' } }),
      sendText: (text) => session.sendRealtimeInput({ text }),
      ackTool: (id, name) =>
        session.sendToolResponse({ functionResponses: [{ id, name, response: { ok: true } }] }),
      audioStreamEnd: () => session.sendRealtimeInput({ audioStreamEnd: true }),
      close: async () => { session.close(); },
    };
  };
}
```

> If a field name differs in your installed SDK version (e.g. `finished` vs `isFinal`), confirm against the gemini-live-api-dev skill / current docs before adjusting. Keep all parsing inside this file.

- [ ] **Step 2: Create the fake connector for tests**

`apps/server/src/voice/fakeGeminiSession.ts`:

```ts
import type {
  GeminiConnector, GeminiEvents, GeminiLiveSession, GeminiConnectOptions,
} from './geminiSession';

/** A scripted fake: tests grab the captured events object and push messages in. */
export interface FakeHandle {
  connector: GeminiConnector;
  /** Resolves once connect() has been called and events are wired. */
  events(): Promise<GeminiEvents>;
  lastOptions(): GeminiConnectOptions | null;
  sent: { audio: Uint8Array[]; text: string[]; acks: string[]; closed: boolean; audioEnded: boolean };
}

export function makeFakeGemini(): FakeHandle {
  let captured: GeminiEvents | null = null;
  let opts: GeminiConnectOptions | null = null;
  let resolveEvents: (e: GeminiEvents) => void;
  const eventsPromise = new Promise<GeminiEvents>((r) => { resolveEvents = r; });
  const sent = { audio: [] as Uint8Array[], text: [] as string[], acks: [] as string[], closed: false, audioEnded: false };

  const session: GeminiLiveSession = {
    sendAudio: (pcm) => sent.audio.push(pcm),
    sendText: (t) => sent.text.push(t),
    ackTool: (_id, name) => sent.acks.push(name),
    audioStreamEnd: () => { sent.audioEnded = true; },
    close: async () => { sent.closed = true; },
  };

  const connector: GeminiConnector = async (o, e) => {
    opts = o; captured = e; resolveEvents(e);
    return session;
  };

  return {
    connector,
    events: () => eventsPromise,
    lastOptions: () => opts,
    sent,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/geminiSession.ts apps/server/src/voice/fakeGeminiSession.ts
git commit -m "feat(sp3): Gemini live-session interface, real connector, and test fake"
```

---

## Task 8: `relay` orchestrator (integration test with fake Gemini)

**Files:**
- Create: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts`

The relay is decoupled from the transport: it takes an outbound **sink** (send control JSON / send binary) and a `GeminiConnector`, so tests drive it without a real WebSocket.

- [ ] **Step 1: Write the failing test**

`apps/server/test/voice/relay.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { makeFakeGemini } from '../../src/voice/fakeGeminiSession';
import type { ServerControl } from '@study-buddy/shared';

const MAYA_ID = '00000000-0000-0000-0000-000000000001';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createRelay: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  ({ createRelay } = await import('../../src/voice/relay'));
});

function sink() {
  const control: ServerControl[] = [];
  const binary: Uint8Array[] = [];
  return {
    control, binary,
    sendControl: (m: ServerControl) => control.push(m),
    sendBinary: (b: Uint8Array) => binary.push(b),
  };
}

describe('voice relay', () => {
  it('start → ready, builds prompt from the child, creates a session row', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: MAYA_ID, connector: fake.connector, sink: out });

    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });

    const opts = fake.lastOptions();
    expect(opts.systemInstruction).toContain('Maya');
    expect(opts.systemInstruction).toContain('note_learning_signal');
    expect(out.control.find((m) => m.type === 'ready')).toBeTruthy();
  });

  it('demuxes Gemini audio + transcripts and forwards an interrupt', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: MAYA_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onAudio(new Uint8Array([1, 2, 3]));
    ev.onOutputTranscript('If 12 apples', false);
    ev.onInputTranscript('is it 8?', true);
    ev.onInterrupted();

    expect(out.binary).toHaveLength(1);
    expect(out.control).toContainEqual({ type: 'transcript', role: 'pip', text: 'If 12 apples', final: false });
    expect(out.control).toContainEqual({ type: 'transcript', role: 'child', text: 'is it 8?', final: true });
    expect(out.control).toContainEqual({ type: 'interrupted' });
  });

  it('acks tool calls and commits accumulated signals on end', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: MAYA_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onToolCall('call-1', 'note_learning_signal', { trait: 'visual', strength: 'strong' });
    expect(fake.sent.acks).toContain('note_learning_signal');

    const { readTraitScores } = await import('../../src/voice/profileCommit');
    const before = await readTraitScores(MAYA_ID);
    await relay.handleControl({ type: 'end' });
    const after = await readTraitScores(MAYA_ID);
    expect(after.visual).toBeGreaterThan(before.visual);
    expect(fake.sent.closed).toBe(true);
    expect(out.control.find((m) => m.type === 'status' && m.state === 'ended')).toBeTruthy();
  });

  it('forwards mic audio to Gemini', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: MAYA_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    await fake.events();
    relay.handleAudio(new Uint8Array([9, 9, 9]));
    expect(fake.sent.audio).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && bun test test/voice/relay.test.ts`
Expected: FAIL — `createRelay` not found.

- [ ] **Step 3: Implement the relay**

`apps/server/src/voice/relay.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children, learningProfiles, learningProfileTraits } from '../db/schema';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { buildSystemInstruction } from './systemPrompt';
import { SignalAccumulator } from './tools';
import { createLiveSession, finalizeLiveSession } from './sessionRow';
import { commitLearningProfile } from './profileCommit';
import type { GeminiConnector, GeminiLiveSession, GeminiEvents } from './geminiSession';

export interface RelaySink {
  sendControl: (m: ServerControl) => void;
  sendBinary: (b: Uint8Array) => void;
}

export interface RelayOptions {
  childId: string;
  connector: GeminiConnector;
  sink: RelaySink;
  softCapMs?: number; // default 10 min
}

type State = 'idle' | 'connecting' | 'live' | 'resuming' | 'ended';

const SOFT_CAP_MS = 10 * 60 * 1000;

export function createRelay(opts: RelayOptions) {
  const { childId, connector, sink } = opts;
  const signals = new SignalAccumulator();

  let state: State = 'idle';
  let session: GeminiLiveSession | null = null;
  let sessionRowId: string | null = null;
  let resumptionHandle: string | undefined;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  async function buildPrompt(subjectKind: SubjectKind, topic: string): Promise<string> {
    const [child] = await db.select().from(children).where(eq(children.id, childId)).limit(1);
    const [profile] = await db
      .select({ id: learningProfiles.id })
      .from(learningProfiles).where(eq(learningProfiles.childId, childId)).limit(1);
    const traits = profile
      ? await db
          .select({ traitId: learningProfileTraits.traitId, label: learningProfileTraits.label, score: learningProfileTraits.score })
          .from(learningProfileTraits).where(eq(learningProfileTraits.profileId, profile.id))
      : [];
    return buildSystemInstruction({
      childName: child?.name ?? 'friend',
      grade: child?.grade ?? 3,
      subjectKind, topic,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
  }

  function events(): GeminiEvents {
    return {
      onAudio: (pcm) => sink.sendBinary(pcm),
      onInputTranscript: (text, final) => sink.sendControl({ type: 'transcript', role: 'child', text, final }),
      onOutputTranscript: (text, final) => sink.sendControl({ type: 'transcript', role: 'pip', text, final }),
      onInterrupted: () => sink.sendControl({ type: 'interrupted' }),
      onToolCall: (id, name, args) => {
        if (name === 'note_learning_signal') signals.addRaw(args);
        session?.ackTool(id, name);
      },
      onResumptionHandle: (handle) => { resumptionHandle = handle; },
      onClose: () => { /* expected ~10min reset handled by transport reconnect in Task 9 */ },
      onError: () => sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip had trouble connecting.' }),
    };
  }

  async function start(subjectKind: SubjectKind, topic: string, title: string) {
    if (state !== 'idle') return;
    state = 'connecting';
    try {
      const systemInstruction = await buildPrompt(subjectKind, topic);
      session = await connector({ systemInstruction, resumptionHandle }, events());
      sessionRowId = await createLiveSession(childId, subjectKind, title);
      state = 'live';
      sink.sendControl({ type: 'ready' });
      sink.sendControl({ type: 'status', state: 'live' });
      capTimer = setTimeout(() => { void finish('completed'); }, opts.softCapMs ?? SOFT_CAP_MS);
    } catch {
      state = 'idle';
      sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip could not start.' });
    }
  }

  async function finish(finalState: 'completed' | 'abandoned') {
    if (state === 'ended') return;
    state = 'ended';
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    try { await session?.close(); } catch { /* ignore */ }
    if (sessionRowId) await finalizeLiveSession(sessionRowId, finalState);
    if (finalState === 'completed') await commitLearningProfile(childId, signals.all());
    sink.sendControl({ type: 'status', state: 'ended' });
  }

  return {
    async handleControl(msg: ClientControl) {
      switch (msg.type) {
        case 'start': await start(msg.subjectKind, msg.topic, msg.title); break;
        case 'mute': session?.audioStreamEnd(); break;
        case 'unmute': break;
        case 'end': await finish('completed'); break;
      }
    },
    handleAudio(pcm16k: Uint8Array) {
      if (state === 'live') session?.sendAudio(pcm16k);
    },
    async handleDisconnect() { await finish('abandoned'); },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && bun test test/voice/relay.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Run the whole server suite to confirm no regressions**

Run: `cd apps/server && bun test`
Expected: all SP2 + SP3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(sp3): voice relay orchestrator (transport-agnostic, fake-Gemini tested)"
```

---

## Task 9: WebSocket endpoint + Bun.serve wiring

**Files:**
- Create: `apps/server/src/voice/voiceRoute.ts`
- Modify: `apps/server/src/index.ts`

> This is the transport layer — it adapts the relay to a real Bun WebSocket. Verified in the Task 13 smoke run (a unit test can't open a real WS upgrade here).

- [ ] **Step 1: Create the WS route**

`apps/server/src/voice/voiceRoute.ts`:

```ts
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { ClientControl } from '@study-buddy/shared';
import { childContext, type ChildVariables } from '../lib/childContext';
import { createRelay } from './relay';
import { makeGeminiConnector } from './geminiSession';

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const apiKey = process.env.GEMINI_API_KEY ?? '';
const connector = makeGeminiConnector(apiKey);

export const voiceWebsocket = websocket;

export const voiceRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/voice',
  childContext,
  upgradeWebSocket((c) => {
    const childId = c.req.param('childId');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let relay: ReturnType<typeof createRelay> | null = null;

    return {
      onOpen(_evt, ws) {
        relay = createRelay({
          childId,
          connector,
          sink: {
            sendControl: (m) => ws.send(JSON.stringify(m)),
            sendBinary: (b) => ws.send(b),
          },
        });
      },
      onMessage(evt, _ws) {
        const data = evt.data;
        if (typeof data === 'string') {
          let msg: ClientControl;
          try { msg = JSON.parse(data) as ClientControl; } catch { return; }
          void relay?.handleControl(msg);
        } else {
          const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBufferView['buffer']);
          relay?.handleAudio(bytes);
        }
      },
      onClose() {
        void relay?.handleDisconnect();
      },
    };
  }),
);
```

> **Resumption note:** the relay's `onClose` (Gemini side) is where transparent resumption lives. For SP3, the relay reconnects by re-invoking the connector with the stored `resumptionHandle` and emitting `status: 'resuming'` → `live`. If you implement reconnect inside `relay.ts`, add it behind the existing `events().onClose` hook (left as a seam in Task 8) and cover it with one more fake-Gemini test (close → expect a re-connect + `resuming` status). Keep the two-failure → `connection-lost` → `abandoned` rule.

- [ ] **Step 2: Mount the route + websocket handler in `index.ts`**

Modify `apps/server/src/index.ts`:

Add imports near the others:

```ts
import { voiceRoute, voiceWebsocket } from './voice/voiceRoute';
```

Mount the route alongside the API routes (after `activityRoute`):

```ts
api.route('/children', voiceRoute);
```

Change the `Bun.serve` call to include the websocket handler:

```ts
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS. (If `hono/bun` types need `@types/bun`/`bun-types`, they are already a devDependency.)

- [ ] **Step 4: Boot the server to confirm it starts**

Run: `cd apps/server && DATABASE_URL=postgres://studybuddy:studybuddy@localhost:5432/studybuddy GEMINI_API_KEY=dummy bun run src/index.ts`
Expected: logs `[server] listening on :3001`, no crash. Stop it (Ctrl-C). (A real session needs a real key + the web client; that's Task 13.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/voiceRoute.ts apps/server/src/index.ts
git commit -m "feat(sp3): Bun WebSocket voice endpoint wired into Hono + Bun.serve"
```

---

## Task 10: Web PCM helpers (TDD)

**Files:**
- Create: `apps/web/src/voice/pcm.ts`
- Test: `apps/web/test/voice/pcm.test.ts`

> Bun runs these `.test.ts` files directly (`bun test` from `apps/web`). No new dep needed.

- [ ] **Step 1: Write the failing test**

`apps/web/test/voice/pcm.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { floatToPcm16, pcm16ToFloat, downsampleTo16k } from '../../src/voice/pcm';

describe('floatToPcm16', () => {
  it('maps [-1, 0, 1] to int16 range', () => {
    const out = floatToPcm16(new Float32Array([-1, 0, 1]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(32767);
  });
  it('clamps out-of-range input', () => {
    const out = floatToPcm16(new Float32Array([-2, 2]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(32767);
  });
});

describe('pcm16ToFloat', () => {
  it('round-trips through floatToPcm16 within tolerance', () => {
    const f = new Float32Array([-1, -0.5, 0, 0.5, 0.999]);
    const back = pcm16ToFloat(floatToPcm16(f));
    for (let i = 0; i < f.length; i++) expect(Math.abs(back[i] - f[i])).toBeLessThan(0.001);
  });
});

describe('downsampleTo16k', () => {
  it('halves a 32k stream to 16k length', () => {
    const input = new Float32Array(320); // 10ms @ 32k
    const out = downsampleTo16k(input, 32000);
    expect(out.length).toBe(160);
  });
  it('returns input unchanged when already 16k', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(Array.from(downsampleTo16k(input, 16000))).toEqual([0.1, 0.2, 0.3]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bun test test/voice/pcm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/voice/pcm.ts`:

```ts
/** Float32 [-1,1] → Int16 PCM. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Int16 PCM → Float32 [-1,1]. */
export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] < 0 ? input[i] / 0x8000 : input[i] / 0x7fff;
  }
  return out;
}

/** Linear-decimate a mono Float32 stream from `inRate` down to 16 kHz. */
export function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000) return input;
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bun test test/voice/pcm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/pcm.ts apps/web/test/voice/pcm.test.ts
git commit -m "feat(sp3): web PCM conversion + downsample helpers"
```

---

## Task 11: Voice state reducer (TDD)

**Files:**
- Create: `apps/web/src/voice/voiceReducer.ts`
- Test: `apps/web/test/voice/voiceReducer.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/test/voice/voiceReducer.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { initialVoiceState, voiceReducer } from '../../src/voice/voiceReducer';

describe('voiceReducer', () => {
  it('starts idle with empty transcript', () => {
    expect(initialVoiceState.status).toBe('idle');
    expect(initialVoiceState.turns).toEqual([]);
  });

  it('ready → live', () => {
    const s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'ready' } });
    expect(s.status).toBe('live');
  });

  it('appends a new final turn and replaces a non-final partial of the same role', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'If 12', final: false } });
    s = voiceReducer(s, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'If 12 apples', final: true } });
    expect(s.turns).toEqual([{ role: 'pip', text: 'If 12 apples' }]);
  });

  it('keeps separate turns for child vs pip', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'Hi!', final: true } });
    s = voiceReducer(s, { kind: 'server', msg: { type: 'transcript', role: 'child', text: 'Hello', final: true } });
    expect(s.turns.map((t) => t.role)).toEqual(['pip', 'child']);
  });

  it('records errors and ended status', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'error', code: 'mic-denied', message: 'x' } });
    expect(s.error).toBe('mic-denied');
    s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'status', state: 'ended' } });
    expect(s.status).toBe('ended');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bun test test/voice/voiceReducer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/voice/voiceReducer.ts`:

```ts
import type { ServerControl, VoiceErrorCode, VoiceStatus } from '@study-buddy/shared';

export interface Turn { role: 'pip' | 'child'; text: string; }
export interface VoiceState {
  status: 'idle' | 'connecting' | VoiceStatus;
  turns: Turn[];
  error: VoiceErrorCode | null;
}

export const initialVoiceState: VoiceState = { status: 'idle', turns: [], error: null };

export type VoiceAction =
  | { kind: 'server'; msg: ServerControl }
  | { kind: 'connecting' };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  if (action.kind === 'connecting') return { ...state, status: 'connecting', error: null };
  const msg = action.msg;
  switch (msg.type) {
    case 'ready':
      return { ...state, status: 'live', error: null };
    case 'status':
      return { ...state, status: msg.state };
    case 'error':
      return { ...state, error: msg.code };
    case 'interrupted':
      return state;
    case 'transcript': {
      const turns = [...state.turns];
      const last = turns[turns.length - 1];
      if (last && last.role === msg.role) {
        turns[turns.length - 1] = { role: msg.role, text: msg.text };
      } else {
        turns.push({ role: msg.role, text: msg.text });
      }
      // keep the rolling window small
      return { ...state, turns: turns.slice(-8) };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bun test test/voice/voiceReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/voiceReducer.ts apps/web/test/voice/voiceReducer.test.ts
git commit -m "feat(sp3): voice state reducer (status + rolling transcript)"
```

---

## Task 12: Web audio capture + playback + the AudioWorklet

**Files:**
- Create: `apps/web/public/pcm-capture-worklet.js`
- Create: `apps/web/src/voice/audioCapture.ts`
- Create: `apps/web/src/voice/audioPlayback.ts`

> Browser-only glue (no DOM-free unit test). The pure math is already covered by `pcm.ts`. Verified live in Task 13.

- [ ] **Step 1: Create the capture worklet**

`apps/web/public/pcm-capture-worklet.js`:

```js
// Emits raw Float32 mono frames (128 samples) at the context sample rate.
// Downsampling + PCM16 conversion happen on the main thread (see audioCapture.ts).
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
```

- [ ] **Step 2: Create the capture module**

`apps/web/src/voice/audioCapture.ts`:

```ts
import { downsampleTo16k, floatToPcm16 } from './pcm';

export interface Capture {
  stop: () => void;
}

/** Request the mic, stream 16 kHz PCM16 frames to `onFrame`. Throws on denial. */
export async function startCapture(onFrame: (pcm16: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/pcm-capture-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const down = downsampleTo16k(e.data, ctx.sampleRate);
    onFrame(floatToPcm16(down));
  };
  source.connect(node);
  // Worklet needs a destination connection to pull audio in some browsers.
  node.connect(ctx.destination);
  return {
    stop: () => {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
```

- [ ] **Step 3: Create the playback module**

`apps/web/src/voice/audioPlayback.ts`:

```ts
import { pcm16ToFloat } from './pcm';

const OUTPUT_RATE = 24000;

/** Gapless queue player for 24 kHz PCM16 chunks, with clear-on-interrupt. */
export class AudioPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private active: AudioBufferSourceNode[] = [];

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
  }

  enqueue(pcm16Bytes: Uint8Array): void {
    // Bytes → Int16 (little-endian) → Float32
    const int16 = new Int16Array(pcm16Bytes.buffer, pcm16Bytes.byteOffset, Math.floor(pcm16Bytes.byteLength / 2));
    const floats = pcm16ToFloat(int16);
    const buffer = this.ctx.createBuffer(1, floats.length, OUTPUT_RATE);
    buffer.copyToChannel(floats, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.nextStartTime);
    src.start(start);
    this.nextStartTime = start + buffer.duration;
    this.active.push(src);
    src.onended = () => { this.active = this.active.filter((s) => s !== src); };
  }

  /** Stop everything immediately (child barged in). */
  clear(): void {
    for (const s of this.active) { try { s.stop(); } catch { /* ignore */ } }
    this.active = [];
    this.nextStartTime = this.ctx.currentTime;
  }

  close(): void {
    this.clear();
    void this.ctx.close();
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS. (`AudioWorkletNode`/`AudioContext` are in the DOM lib already enabled by Vite's tsconfig.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/pcm-capture-worklet.js apps/web/src/voice/audioCapture.ts apps/web/src/voice/audioPlayback.ts
git commit -m "feat(sp3): web mic capture worklet + gapless 24k playback"
```

---

## Task 13: `useVoiceSession` hook

**Files:**
- Create: `apps/web/src/voice/useVoiceSession.ts`

> Wires WS + capture + playback + reducer. The reducer and PCM are already tested; this is integration glue verified in Task 14.

- [ ] **Step 1: Implement the hook**

`apps/web/src/voice/useVoiceSession.ts`:

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { CURRENT_CHILD_ID } from '../data';
import { voiceReducer, initialVoiceState } from './voiceReducer';
import { startCapture, type Capture } from './audioCapture';
import { AudioPlayer } from './audioPlayback';

export interface StartArgs { subjectKind: SubjectKind; topic: string; title: string; }

const WS_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

function wsUrl(childId: string): string {
  const httpBase = WS_BASE.startsWith('http')
    ? WS_BASE
    : `${location.origin}${WS_BASE}`;
  return `${httpBase.replace(/^http/, 'ws')}/children/${childId}/voice`;
}

export function useVoiceSession() {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  const send = (m: ClientControl) => wsRef.current?.send(JSON.stringify(m));

  const start = useCallback(async (args: StartArgs) => {
    dispatch({ kind: 'connecting' });
    let player: AudioPlayer;
    try {
      player = new AudioPlayer();
      playerRef.current = player;
    } catch {
      dispatch({ kind: 'server', msg: { type: 'error', code: 'gemini-unavailable', message: 'Audio unavailable.' } });
      return;
    }

    const ws = new WebSocket(wsUrl(CURRENT_CHILD_ID));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => send({ type: 'start', ...args });
    ws.onmessage = async (evt) => {
      if (typeof evt.data === 'string') {
        const msg = JSON.parse(evt.data) as ServerControl;
        if (msg.type === 'interrupted') playerRef.current?.clear();
        if (msg.type === 'ready') {
          try {
            captureRef.current = await startCapture((pcm16) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(pcm16.buffer);
            });
          } catch {
            dispatch({ kind: 'server', msg: { type: 'error', code: 'mic-denied', message: 'Mic permission denied.' } });
            send({ type: 'end' });
            return;
          }
        }
        dispatch({ kind: 'server', msg });
      } else {
        playerRef.current?.enqueue(new Uint8Array(evt.data as ArrayBuffer));
      }
    };
    ws.onerror = () => dispatch({ kind: 'server', msg: { type: 'error', code: 'connection-lost', message: 'Lost connection.' } });
    ws.onclose = () => dispatch({ kind: 'server', msg: { type: 'status', state: 'ended' } });
  }, []);

  const end = useCallback(() => {
    send({ type: 'end' });
    captureRef.current?.stop();
    playerRef.current?.close();
    wsRef.current?.close();
  }, []);

  const mute = useCallback(() => send({ type: 'mute' }), []);
  const unmute = useCallback(() => send({ type: 'unmute' }), []);

  useEffect(() => () => {
    captureRef.current?.stop();
    playerRef.current?.close();
    wsRef.current?.close();
  }, []);

  return { state, start, end, mute, unmute };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/voice/useVoiceSession.ts
git commit -m "feat(sp3): useVoiceSession hook (WS + capture + playback + reducer)"
```

---

## Task 14: Rewire the Voice screen + entry points

**Files:**
- Modify: `apps/web/src/routes/app/VoiceRoute.tsx`
- Modify: `apps/web/src/routes/app/LibraryRoute.tsx`
- Modify: `apps/web/src/routes/app/HomeRoute.tsx`
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx`

- [ ] **Step 1: Pass subject context from the Library tiles**

In `apps/web/src/routes/app/LibraryRoute.tsx`, change the subject-tile click and the free-talk card so they carry context. Replace the subject card's `onClick={() => navigate('/app/voice')}` with:

```tsx
onClick={() => navigate('/app/voice', {
  state: { subjectKind: s.kind, topic: s.topic, title: subjectLabel(s.kind) },
})}
```

And the "Just talk with Pip" card's `onClick` with (no subject yet → triggers the chooser):

```tsx
onClick={() => navigate('/app/voice', { state: { chooseSubject: true } })}
```

- [ ] **Step 2: Pass subject context from Home and Dashboard continue/assignment CTAs**

In `apps/web/src/routes/app/HomeRoute.tsx`, the Continue card button and each `AssignmentCard`'s start path should pass context. For the Continue card button:

```tsx
onClick={() => navigate('/app/voice', {
  state: { subjectKind: 'math', topic: continueSession.title, title: continueSession.title },
})}
```

> `ContinueSession` has no `subjectKind` field today; for SP3 the continue card defaults to the session title as topic. (Threading a real `subjectKind` onto `ContinueSession` is a small SP2-contract follow-up; not required here.)

In `apps/web/src/routes/dashboard/DashboardRoute.tsx`, the assignment grid "Start" button:

```tsx
onClick={() => navigate('/app/voice', {
  state: { subjectKind: a.subjectKind, topic: a.title, title: a.title },
})}
```

and the in-progress hero buttons likewise pass `{ subjectKind: 'math', topic: continueSession.title, title: continueSession.title }` (or, for the no-session hero, `{ state: { chooseSubject: true } }`).

- [ ] **Step 3: Rewire `VoiceRoute.tsx` to the live hook**

Replace the body of `apps/web/src/routes/app/VoiceRoute.tsx`'s `VoiceRoute` component (keep the `ControlBtn` / `BigMic` helper atoms and imports; add the ones below). New imports at the top:

```tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SubjectKind } from '@study-buddy/shared';
import { Pip } from '../../components/Pip';
import { Waveform } from '../../components/ui/Waveform';
import { Bubble } from '../../components/ui/Bubble';
import { ErrorState } from '../../components/atoms/ErrorState';
import { usePipColor } from '../../state/PipColorContext';
import { useVoiceSession } from '../../voice/useVoiceSession';
import { subjectLabel } from '../../theme/subjectTheme';
```

Replace the component with:

```tsx
interface VoiceNavState {
  subjectKind?: SubjectKind;
  topic?: string;
  title?: string;
  chooseSubject?: boolean;
}

const SUBJECT_CHOICES: { kind: SubjectKind; topic: string }[] = [
  { kind: 'math', topic: 'Anything in math' },
  { kind: 'reading', topic: 'Reading together' },
  { kind: 'science', topic: 'Science questions' },
  { kind: 'writing', topic: 'Writing help' },
];

export function VoiceRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pipColorValue } = usePipColor();
  const nav = (location.state ?? {}) as VoiceNavState;

  const { state, start, end, mute, unmute } = useVoiceSession();
  const [muted, setMuted] = useState(false);
  const [picked, setPicked] = useState<{ subjectKind: SubjectKind; topic: string; title: string } | null>(
    nav.subjectKind ? { subjectKind: nav.subjectKind, topic: nav.topic ?? '', title: nav.title ?? subjectLabel(nav.subjectKind) } : null,
  );

  // Auto-start once we have a subject.
  useEffect(() => {
    if (picked && state.status === 'idle') void start(picked);
  }, [picked, state.status, start]);

  // Navigate Home when the session ends.
  useEffect(() => {
    if (state.status === 'ended') navigate('/app');
  }, [state.status, navigate]);

  const accent = 'var(--color-coral)';
  const pipState = state.status === 'live' ? 'listen' : state.status === 'connecting' ? 'curious' : 'idle';

  const subjectTitle = useMemo(() => picked?.title ?? 'Talk with Pip', [picked]);

  if (state.error) {
    return (
      <ErrorState
        title={state.error === 'mic-denied' ? 'Pip needs your microphone' : 'Pip had trouble'}
        onRetry={() => navigate('/app')}
      />
    );
  }

  // Subject chooser for "just talk".
  if (!picked && nav.chooseSubject) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-bg px-8">
        <Pip size={120} state="idle" color={pipColorValue} expression="happy" />
        <div className="font-display font-extrabold text-[22px] text-ink">What should we work on?</div>
        <div className="grid grid-cols-2 gap-3">
          {SUBJECT_CHOICES.map((c) => (
            <button
              key={c.kind}
              className="rounded-[18px] border-[1.5px] border-line bg-surface px-5 py-4 font-display font-bold text-ink"
              onClick={() => setPicked({ subjectKind: c.kind, topic: c.topic, title: subjectLabel(c.kind) })}
            >
              {subjectLabel(c.kind)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: `radial-gradient(80% 60% at 50% 0%, var(--color-coral-l) 0%, var(--color-bg) 65%)` }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-[18px] py-3">
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center border-[1.5px] border-line cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => { end(); }}
          aria-label="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 5 L8 12 L15 19" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 text-center">
          <div className="font-body font-bold text-[11px] text-ink-3 uppercase tracking-[0.6px]">
            {picked ? subjectLabel(picked.subjectKind) : 'Pip'} · {picked?.topic ?? 'Live'}
          </div>
          <div className="font-display font-bold text-[16px] text-ink">{subjectTitle}</div>
        </div>
        <div className="px-3 py-[6px] rounded-full border-[1.5px] border-line font-mono text-[12px] font-bold text-ink-2"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}>
          {state.status === 'resuming' ? 'one sec…' : state.status === 'connecting' ? 'connecting…' : 'live'}
        </div>
      </div>

      {/* Pip hero + state chip */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 pt-2">
        <Pip size={180} state={pipState} color={pipColorValue} expression="happy" />
        <div className="inline-flex items-center gap-2 px-[14px] py-2 bg-surface border-[1.5px] border-line rounded-full font-body font-bold text-[13px] text-ink-2 shadow-[0_2px_0_rgba(0,0,0,0.04)]">
          {state.status === 'live' && !muted ? <Waveform color={accent} height={14} bars={4} /> : <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-ink-4)' }} />}
          <span>{muted ? 'Muted' : state.status === 'live' ? 'Listening…' : state.status === 'resuming' ? 'One sec…' : 'Connecting…'}</span>
        </div>
      </div>

      {/* Transcript bubbles (rolling) */}
      <div className="flex flex-col gap-2 px-[18px] pt-3 pb-1">
        {state.turns.slice(-2).map((t, i) => (
          <Bubble key={i} from={t.role === 'pip' ? 'pip' : 'user'}>{t.text}</Bubble>
        ))}
      </div>

      {/* Controls: Mute | BigMic | End */}
      <div className="flex items-center justify-between px-6 pt-[14px] pb-[18px]">
        <ControlBtn
          label={muted ? 'Unmute' : 'Mute'}
          onClick={() => { muted ? unmute() : mute(); setMuted((m) => !m); }}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="3" width="6" height="12" rx="3" stroke="var(--color-ink-2)" strokeWidth="2" />
              <path d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22" stroke="var(--color-ink-2)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
        <BigMic accent={accent} active={state.status === 'live' && !muted} onClick={() => { muted ? unmute() : mute(); setMuted((m) => !m); }} />
        <ControlBtn
          label="End"
          danger
          onClick={() => end()}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="var(--color-coral-d)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
```

> The static "Question 3 of 5" line, the 5 progress dots, and the hint-chip row are intentionally removed (free dialogue, hints deferred). Keep the `ControlBtn`/`BigMic` helper functions already defined in the file. If `ErrorState` doesn't accept a `title` prop, check the atom and either add an optional `title` or drop the prop — confirm against `apps/web/src/components/atoms/ErrorState.tsx`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm --filter @study-buddy/web build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/app/VoiceRoute.tsx apps/web/src/routes/app/LibraryRoute.tsx apps/web/src/routes/app/HomeRoute.tsx apps/web/src/routes/dashboard/DashboardRoute.tsx
git commit -m "feat(sp3): rewire Voice screen to live session + subject-context entry points"
```

---

## Task 15: End-to-end verification + docs

**Files:**
- Modify: `CLAUDE.md` (status), `apps/server/README.md`, `apps/web/README.md`

- [ ] **Step 1: Full automated suite**

Run: `pnpm typecheck && pnpm --filter @study-buddy/web build && (cd apps/server && bun test)`
Expected: typecheck green, web build green, server suite (SP2 + SP3 unit/integration) all PASS. Also run web pure tests: `cd apps/web && bun test`.

- [ ] **Step 2: Manual live smoke (requires a real `GEMINI_API_KEY`)**

Set `GEMINI_API_KEY` in your `.env`, then:

Run: `docker compose up`
Then in a browser at `http://localhost:5173`:
1. Open a subject from the Subjects screen → Voice screen shows "connecting…" → "live"; mic-permission prompt appears; grant it.
2. Speak a question; confirm Pip replies **with audio** and the transcript shows both turns.
3. Interrupt Pip mid-sentence; confirm Pip stops promptly (barge-in).
4. Verify Pip **guides** rather than stating the answer (Socratic rule).
5. Tap **End**; confirm it returns to Home.
6. Open "How I learn"; confirm trait scores/note reflect the session (profile commit).
7. Leave a session idle ~10 min (or temporarily set `softCapMs` low in `relay.ts` for testing); confirm Pip wraps up and the session ends.
8. (Optional) kill network briefly mid-session; confirm a short "one sec…" then recovery, or a clean `connection-lost` after retries.

Record actual outcomes (pass/fail + notes) — do not assume.

- [ ] **Step 3: Update docs**

In `CLAUDE.md`, update the Status section: SP1 + SP2 done; **SP3 (live voice tutor) implemented**. In the subsystem roadmap, mark SP3 complete and note the deferred items (recap auto-gen, transcript persistence, LLM notes, interactive hints) carry into a later effort. Add the voice WS endpoint + `GEMINI_API_KEY` to `apps/server/README.md`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md apps/server/README.md apps/web/README.md
git commit -m "docs(sp3): mark live voice tutor implemented; document voice endpoint + GEMINI_API_KEY"
```

---

## Self-Review

**Spec coverage:**
- Thin relay / narrow envelope → Tasks 1, 8, 9. ✓
- Subject-grounded free dialogue → systemPrompt (3), nav context (14). ✓
- Open-mic + barge-in → capture/playback (12), `interrupted` handling (8, 13). ✓
- Native audio in/out, 16k/24k PCM → pcm (10), capture/playback (12), connector (7). ✓
- Live transcript → reducer (11), connector transcription (7), relay demux (8), UI (14). ✓
- Function calling → tools (4), relay ack + accumulate (8). ✓
- Accumulate-and-commit profile deltas → profileCommit (2, 6), relay finish (8). ✓
- Resume + 10-min soft cap → soft cap in relay (8); resume seam documented in (9) with a follow-up test. ✓ (Note: the resume reconnect itself is left as an explicit seam in Tasks 8/9 — if the executor wants it fully covered, add the close→reconnect fake-Gemini test described in Task 9 Step 1's note.)
- sessions row lifecycle → sessionRow (5), relay (8). ✓
- Config/secret server-side only → Task 1. ✓
- Voice screen rewire + entry points + End→Home → Task 14. ✓
- Testing strategy (pure unit + integration with fake + manual smoke) → throughout; manual checklist in 15. ✓

**Placeholder scan:** no "TBD"/"add error handling here"; every code step has concrete code. The few "confirm against current SDK/atom" notes are deliberate verification prompts, not missing content.

**Type consistency:** `ClientControl`/`ServerControl`/`LearningSignal` (shared) used identically across relay, hook, reducer, tools. `GeminiConnector`/`GeminiEvents`/`GeminiLiveSession` consistent between `geminiSession.ts`, `fakeGeminiSession.ts`, and `relay.ts`. `createLiveSession`/`finalizeLiveSession`/`commitLearningProfile`/`readTraitScores` names match across tasks. `computeTraitDeltas`/`applyTraitDeltas`/`noteFromDeltas` consistent.

**Known seams handed to the executor (intentional, documented inline):**
1. Transparent Gemini resumption reconnect (the relay stores the handle and exposes the `onClose` seam; full reconnect + `resuming` status + two-failure→`connection-lost` is described in Task 9 and should get its own fake-Gemini test when implemented).
2. `ErrorState` `title` prop and `ContinueSession.subjectKind` — both flagged to confirm/adjust against the actual files during Task 14.
