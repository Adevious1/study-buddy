# Session Recap (SP6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the end of a completed voice session, persist the transcript, generate a warm child-facing recap with one non-streaming Gemini call, write it to the existing recap columns, and route the child to the already-built `/app/recap` screen.

**Architecture:** The live voice loop is untouched. The relay accumulates transcript turns server-side; on `finish('completed')` it generates a recap (timeout-bounded, with a graceful fallback), then writes transcript + recap columns in the same update that flips the row to `completed`. The client keeps the WebSocket open after End, shows a "wrapping up" screen, and navigates to the recap only when the server's `ended` status arrives (recap already written). The recap prompt is an externalized, hot-reloaded, drift-guarded template mirroring `study-buddy.md`.

**Tech Stack:** Bun + Hono + Drizzle/Postgres (server), `@google/genai` v1 (`gemini-3-flash-preview`, non-streaming structured output), React + Vite (web), `bun:test` (server + web unit tests).

**Spec:** `docs/superpowers/specs/2026-05-31-study-buddy-session-recap-design.md`

---

## Conventions for the engineer

- Run from repo root: `/Users/judeadeva/GithubProjects/Adevious/study-buddy`. Ensure `export PATH="/usr/local/bin:$PATH"` (docker lives there; macOS has no `timeout`).
- **Server tests run on the host** against a throwaway Postgres on **5433**:
  `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
  Start the test PG first if stopped: `docker start sb-test-pg` (create it if it does not exist — see the `running-server-db-tests` memory). Run a single file by appending its path, e.g. `… bun test test/recap/recapContent.test.ts`.
- **Server typecheck:** `cd apps/server && bun run typecheck`
- **Web typecheck/build:** `pnpm --filter @study-buddy/web typecheck` and `pnpm --filter @study-buddy/web build`
- **Web unit tests:** `cd apps/web && bun test`
- Work on a branch `sp6-session-recap` (prior subsystems used per-feature branches). **Do not push or merge** — the user integrates manually.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Branch + shared `TranscriptTurn` type

**Files:**
- Modify: `packages/shared/src/voice.ts`
- Verify export: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy
git checkout -b sp6-session-recap
```

- [ ] **Step 2: Add the `TranscriptTurn` type**

In `packages/shared/src/voice.ts`, append after the `LearningSignal` interface (end of file):

```typescript
/** One finalized turn of a session transcript, persisted and fed to the recap summarizer. */
export interface TranscriptTurn {
  role: 'pip' | 'child';
  text: string;
}
```

- [ ] **Step 3: Confirm it is re-exported**

Run: `grep -n "voice" packages/shared/src/index.ts`
Expected: a line like `export * from './voice';`. If `voice` is not re-exported there, add `export * from './voice';`. (It is already imported by the server, so it almost certainly is.)

- [ ] **Step 4: Typecheck the shared package compiles**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS (this also compiles `@study-buddy/shared` as a dependency).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/voice.ts packages/shared/src/index.ts
git commit -m "feat(shared): add TranscriptTurn type for session recap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `TranscriptAccumulator` (pure, server-side transcript folding)

Mirrors the browser `voiceReducer` delta-folding, but keeps the full transcript (no 30-turn cap) and emits `{ role, text }` turns.

**Files:**
- Modify: `apps/server/src/voice/transcript.ts`
- Test: `apps/server/test/voice/transcript.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/voice/transcript.test.ts`:

```typescript
import { TranscriptAccumulator } from '../../src/voice/transcript';

describe('TranscriptAccumulator', () => {
  it('folds incremental deltas of the same role into one turn', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'If 12 ', false);
    acc.add('pip', 'apples', true);
    expect(acc.turns()).toEqual([{ role: 'pip', text: 'If 12 apples' }]);
  });

  it('starts a new turn when the role switches', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'How many?', true);
    acc.add('child', 'is it 8?', true);
    expect(acc.turns()).toEqual([
      { role: 'pip', text: 'How many?' },
      { role: 'child', text: 'is it 8?' },
    ]);
  });

  it('starts a new turn after a turn is finalized even for the same role', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'First.', true);
    acc.add('pip', 'Second.', true);
    expect(acc.turns()).toEqual([
      { role: 'pip', text: 'First.' },
      { role: 'pip', text: 'Second.' },
    ]);
  });

  it('includes an open (not-yet-final) turn in its snapshot', () => {
    const acc = new TranscriptAccumulator();
    acc.add('child', 'um', false);
    expect(acc.turns()).toEqual([{ role: 'child', text: 'um' }]);
  });

  it('ignores empty deltas', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', '', false);
    expect(acc.turns()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/transcript.test.ts`
Expected: FAIL — `TranscriptAccumulator is not a constructor` / not exported.

- [ ] **Step 3: Implement the accumulator**

Append to `apps/server/src/voice/transcript.ts`:

```typescript
import type { TranscriptTurn } from '@study-buddy/shared';

/**
 * Folds role-tagged transcript deltas (the same stream the relay forwards to the
 * browser) into ordered, finalized turns for persistence and recap generation.
 * Pure and in-memory: one instance per live session. Mirrors the browser
 * voiceReducer's accumulation, but keeps the whole transcript.
 */
export class TranscriptAccumulator {
  private all: TranscriptTurn[] = [];
  private open = false; // whether the last turn is still accumulating deltas

  /** Append a transcript delta. `final` closes the current turn. Empty text is ignored. */
  add(role: 'pip' | 'child', text: string, final: boolean): void {
    if (text.length === 0) {
      if (final) this.open = false;
      return;
    }
    const last = this.all[this.all.length - 1];
    if (this.open && last && last.role === role) {
      last.text += text;
    } else {
      this.all.push({ role, text });
    }
    this.open = !final;
  }

  /** A snapshot of all turns so far (including any still-open turn). */
  turns(): TranscriptTurn[] {
    return this.all.map((t) => ({ ...t }));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/transcript.test.ts`
Expected: PASS (all `stripTextArtifact` + `TranscriptAccumulator` tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/transcript.ts apps/server/test/voice/transcript.test.ts
git commit -m "feat(voice): add TranscriptAccumulator for server-side transcript capture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract a shared template helper

`renderTemplate` and the file-load-with-fallback logic currently live only in `systemPrompt.ts`. Extract them so the recap prompt reuses them without duplication. Keep `systemPrompt.ts`'s public surface identical so its test stays green.

**Files:**
- Create: `apps/server/src/lib/promptTemplate.ts`
- Modify: `apps/server/src/voice/systemPrompt.ts`
- Existing test (must stay green): `apps/server/test/voice/systemPrompt.test.ts`

- [ ] **Step 1: Create the shared helper**

Create `apps/server/src/lib/promptTemplate.ts`:

```typescript
import { readFile } from 'node:fs/promises';

/**
 * Substitute {{tokens}}, strip ATX markdown heading lines, and drop blank lines
 * left behind by stripped headings and empty tokens. Unknown tokens are left
 * literal. Output is plain newline-joined instruction text.
 */
export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const substituted = tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
  return substituted
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    // Drop ATX markdown headings (1-6 '#' followed by a space). The space
    // requirement is deliberate: a content line that happens to start with '#'
    // (e.g. "#1 rule: ...") is NOT a heading and must survive.
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Read a template file (hot-reload); fall back to a built-in on any read error. */
export async function loadTemplateFile(path: string, builtin: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    console.warn(`[promptTemplate] could not read ${path}; using built-in template`, err);
    return builtin;
  }
}
```

- [ ] **Step 2: Refactor `systemPrompt.ts` to use it**

In `apps/server/src/voice/systemPrompt.ts`:

Replace the imports at the top:

```typescript
import { join } from 'node:path';
import type { LearningStyleTrait, SubjectKind } from '@study-buddy/shared';
import { renderTemplate, loadTemplateFile } from '../lib/promptTemplate';

export { renderTemplate }; // re-exported so existing importers/tests are unaffected
```

(Remove the old `import { readFile } from 'node:fs/promises';` line.)

Delete the in-file `renderTemplate` function (the whole `export function renderTemplate(...) { ... }` block).

Replace the `loadTemplate` function body so it delegates:

```typescript
/** Read study-buddy.md fresh (hot-reload); fall back to the built-in on any error. */
export async function loadTemplate(): Promise<string> {
  return loadTemplateFile(templatePath(), BUILTIN_TEMPLATE);
}
```

Leave `BUILTIN_TEMPLATE`, `templatePath()`, `traitLean()`, `intro()`, and `buildSystemInstruction()` unchanged.

- [ ] **Step 3: Run the existing prompt test to verify the refactor is behavior-preserving**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: PASS (all `renderTemplate`, `buildSystemInstruction`, `intro`, `BUILTIN_TEMPLATE`, `loadTemplate` tests — including the byte-identity drift guard).

- [ ] **Step 4: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/promptTemplate.ts apps/server/src/voice/systemPrompt.ts
git commit -m "refactor(server): extract shared promptTemplate helper from systemPrompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Externalized, drift-guarded recap prompt template

**Files:**
- Create: `apps/server/src/recap/recapTemplate.ts`
- Create: `apps/server/study-buddy-recap.md`
- Test: `apps/server/test/recap/recapTemplate.test.ts`

- [ ] **Step 1: Create the template module**

Create `apps/server/src/recap/recapTemplate.ts`:

```typescript
import { join } from 'node:path';
import type { SubjectKind } from '@study-buddy/shared';
import { renderTemplate, loadTemplateFile } from '../lib/promptTemplate';

export interface RecapPromptInput {
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
}

const SUBJECT_NAME: Record<SubjectKind, string> = {
  math: 'Math', reading: 'Reading', science: 'Science',
  writing: 'Writing', spanish: 'Spanish', social: 'Social Studies',
};

/**
 * Canonical recap-writer instruction. Both the fallback (when study-buddy-recap.md
 * is missing/unreadable) and the reference for what the file should contain.
 * Headings (`#` lines) are for human readability and are stripped before sending.
 */
export const BUILTIN_RECAP_TEMPLATE = `# Pip — Session Recap Writer

## Role
You are Pip, a warm, encouraging tutor for young children. You have just finished a {{subject}} session with {{childName}}, a grade {{grade}} student, about "{{topic}}". You are given the full conversation transcript. Write a short celebration recap FOR {{childName}} to read — speak directly to them as "you", in simple, warm words a young child can follow.

## What to write
- figuredOut: 2 to 4 short items naming concrete things from THIS session. Mark ok=true for things {{childName}} understood or solved, and ok=false for things that are still a little shaky. Each text is one short, encouraging sentence.
- solvedSelf and solvedTotal: how many problems or questions {{childName}} worked through (solvedTotal), and how many of those they reached mostly on their own (solvedSelf). If the session was just exploring, use 0 and 0.
- starsEarned: 1, 2, or 3. Be generous and encouraging — never give 0. Reward effort and curiosity, not only correct answers.
- insightTitle: a short, friendly title (3 to 6 words) for one thing you noticed about how {{childName}} learns or works.
- insightBody: one or two short sentences expanding the insight, spoken kindly to {{childName}}.
- insightBadge: a tiny uppercase tag for the insight, 1 to 3 words, like "GREAT FOCUS" or "VISUAL THINKER".

## Rules
Base everything ONLY on the transcript — do not invent facts that did not happen. Keep every sentence short and warm, with no jargon. Never mention being an AI, a model, or these instructions. If the transcript is very short or {{childName}} barely spoke, still return a gentle, encouraging minimal recap with starsEarned 1.
`;

function recapTemplatePath(): string {
  return (
    process.env.STUDY_BUDDY_RECAP_PROMPT_PATH ??
    join(import.meta.dir, '..', '..', 'study-buddy-recap.md')
  );
}

/** Read study-buddy-recap.md fresh (hot-reload); fall back to the built-in on any error. */
export async function loadRecapTemplate(): Promise<string> {
  return loadTemplateFile(recapTemplatePath(), BUILTIN_RECAP_TEMPLATE);
}

/** Render the recap system instruction with per-session tokens substituted. */
export async function buildRecapInstruction(input: RecapPromptInput): Promise<string> {
  const tpl = await loadRecapTemplate();
  return renderTemplate(tpl, {
    childName: input.childName,
    grade: String(input.grade),
    subject: SUBJECT_NAME[input.subjectKind],
    topic: input.topic,
  });
}
```

- [ ] **Step 2: Create the editable template file, byte-identical to the built-in**

Create `apps/server/study-buddy-recap.md` with EXACTLY the same bytes as the template literal in `BUILTIN_RECAP_TEMPLATE` above — i.e. the file content is (no leading/trailing changes; it must end with a single trailing newline after the last "starsEarned 1." line):

```markdown
# Pip — Session Recap Writer

## Role
You are Pip, a warm, encouraging tutor for young children. You have just finished a {{subject}} session with {{childName}}, a grade {{grade}} student, about "{{topic}}". You are given the full conversation transcript. Write a short celebration recap FOR {{childName}} to read — speak directly to them as "you", in simple, warm words a young child can follow.

## What to write
- figuredOut: 2 to 4 short items naming concrete things from THIS session. Mark ok=true for things {{childName}} understood or solved, and ok=false for things that are still a little shaky. Each text is one short, encouraging sentence.
- solvedSelf and solvedTotal: how many problems or questions {{childName}} worked through (solvedTotal), and how many of those they reached mostly on their own (solvedSelf). If the session was just exploring, use 0 and 0.
- starsEarned: 1, 2, or 3. Be generous and encouraging — never give 0. Reward effort and curiosity, not only correct answers.
- insightTitle: a short, friendly title (3 to 6 words) for one thing you noticed about how {{childName}} learns or works.
- insightBody: one or two short sentences expanding the insight, spoken kindly to {{childName}}.
- insightBadge: a tiny uppercase tag for the insight, 1 to 3 words, like "GREAT FOCUS" or "VISUAL THINKER".

## Rules
Base everything ONLY on the transcript — do not invent facts that did not happen. Keep every sentence short and warm, with no jargon. Never mention being an AI, a model, or these instructions. If the transcript is very short or {{childName}} barely spoke, still return a gentle, encouraging minimal recap with starsEarned 1.
```

- [ ] **Step 3: Write the tests**

Create `apps/server/test/recap/recapTemplate.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILTIN_RECAP_TEMPLATE,
  buildRecapInstruction,
} from '../../src/recap/recapTemplate';

const SHIPPED_RECAP_PATH = join(import.meta.dir, '..', '..', 'study-buddy-recap.md');

describe('buildRecapInstruction', () => {
  it('substitutes every token and strips headings', async () => {
    const out = await buildRecapInstruction({
      childName: 'Maya', grade: 3, subjectKind: 'math', topic: 'Fractions',
    });
    expect(out).not.toMatch(/\{\{.*?\}\}/);   // no unsubstituted placeholders
    expect(out).not.toMatch(/^#/m);           // no markdown headings survive
    expect(out).toContain('Maya');
    expect(out).toContain('grade 3');
    expect(out).toContain('Math');
    expect(out).toContain('Fractions');
    expect(out).toContain('starsEarned');
  });
});

describe('BUILTIN_RECAP_TEMPLATE', () => {
  it('contains all four tokens', () => {
    for (const t of ['{{childName}}', '{{grade}}', '{{subject}}', '{{topic}}']) {
      expect(BUILTIN_RECAP_TEMPLATE).toContain(t);
    }
  });

  it('the shipped study-buddy-recap.md is byte-identical to BUILTIN_RECAP_TEMPLATE', async () => {
    // The file is the editable copy; BUILTIN_RECAP_TEMPLATE is its in-code mirror
    // and fallback. They must stay in lockstep — this guard fails loudly on drift.
    const raw = await readFile(SHIPPED_RECAP_PATH, 'utf8');
    expect(raw).toBe(BUILTIN_RECAP_TEMPLATE);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/recapTemplate.test.ts`
Expected: PASS. If the byte-identity test fails, the file and the literal differ — most likely a trailing-newline or smart-dash mismatch. Re-copy so they match exactly (the literal uses an em dash `—`; make sure the `.md` uses the same character).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/recap/recapTemplate.ts apps/server/study-buddy-recap.md apps/server/test/recap/recapTemplate.test.ts
git commit -m "feat(recap): externalized, drift-guarded recap prompt template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Recap content — type, response schema, validation, fallback, transcript script

Pure, no network. `RecapContent` is the server-internal shape written to the DB.

**Files:**
- Create: `apps/server/src/recap/recapContent.ts`
- Test: `apps/server/test/recap/recapContent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/recap/recapContent.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import {
  parseRecapContent,
  fallbackRecap,
  transcriptToScript,
  STARS_MAX,
} from '../../src/recap/recapContent';

const valid = {
  figuredOut: [{ ok: true, text: 'You added the fractions' }, { ok: false, text: 'Borrowing is still tricky' }],
  solvedSelf: 2,
  solvedTotal: 3,
  starsEarned: 3,
  insightTitle: 'Great focus today',
  insightBody: 'You stuck with the hard parts.',
  insightBadge: 'FOCUSED',
};

describe('parseRecapContent', () => {
  it('accepts a well-formed object and stamps starsMax', () => {
    const r = parseRecapContent(valid);
    expect(r).not.toBeNull();
    expect(r!.starsMax).toBe(STARS_MAX);
    expect(r!.solvedSelf).toBe(2);
    expect(r!.figuredOut).toHaveLength(2);
    expect(r!.insightBadge).toBe('FOCUSED');
  });

  it('clamps starsEarned into 1..STARS_MAX', () => {
    expect(parseRecapContent({ ...valid, starsEarned: 0 })!.starsEarned).toBe(1);
    expect(parseRecapContent({ ...valid, starsEarned: 9 })!.starsEarned).toBe(STARS_MAX);
  });

  it('drops malformed figuredOut items and keeps valid ones', () => {
    const r = parseRecapContent({
      ...valid,
      figuredOut: [{ ok: true, text: 'kept' }, { ok: 'nope', text: 5 }, { ok: false, text: '' }],
    });
    expect(r!.figuredOut).toEqual([{ ok: true, text: 'kept' }]);
  });

  it('returns null when required fields are missing or wrong-typed', () => {
    expect(parseRecapContent(null)).toBeNull();
    expect(parseRecapContent({})).toBeNull();
    expect(parseRecapContent({ ...valid, insightTitle: 123 })).toBeNull();
    expect(parseRecapContent({ ...valid, solvedSelf: 'two' })).toBeNull();
  });
});

describe('fallbackRecap', () => {
  it('is a safe, encouraging, well-formed recap', () => {
    const r = fallbackRecap();
    expect(r.starsEarned).toBeGreaterThanOrEqual(1);
    expect(r.starsMax).toBe(STARS_MAX);
    expect(r.figuredOut.length).toBeGreaterThanOrEqual(1);
    expect(r.insightTitle.length).toBeGreaterThan(0);
  });
});

describe('transcriptToScript', () => {
  it('renders a readable Pip/child script', () => {
    const out = transcriptToScript(
      [{ role: 'pip', text: 'How many?' }, { role: 'child', text: 'Eight!' }],
      'Maya',
    );
    expect(out).toBe('Pip: How many?\nMaya: Eight!');
  });

  it('returns an empty string for an empty transcript', () => {
    expect(transcriptToScript([], 'Maya')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/recapContent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/server/src/recap/recapContent.ts`:

```typescript
import { Type } from '@google/genai';
import type { RecapItem, TranscriptTurn } from '@study-buddy/shared';

/** Fixed display maximum for the recap star row. */
export const STARS_MAX = 3;

/** The recap fields the LLM produces; durationSeconds/subjectKind come from the row. */
export interface RecapContent {
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: RecapItem[];
  insightTitle: string;
  insightBody: string;
  insightBadge: string;
}

/** Structured-output schema handed to Gemini. starsMax is set in code, not by the model. */
export const RECAP_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    figuredOut: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ok: { type: Type.BOOLEAN },
          text: { type: Type.STRING },
        },
        required: ['ok', 'text'],
      },
    },
    solvedSelf: { type: Type.INTEGER },
    solvedTotal: { type: Type.INTEGER },
    starsEarned: { type: Type.INTEGER },
    insightTitle: { type: Type.STRING },
    insightBody: { type: Type.STRING },
    insightBadge: { type: Type.STRING },
  },
  required: [
    'figuredOut', 'solvedSelf', 'solvedTotal', 'starsEarned',
    'insightTitle', 'insightBody', 'insightBadge',
  ],
};

const clampInt = (n: unknown, lo: number, hi: number): number | null => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

const nonEmptyString = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

function parseFiguredOut(raw: unknown): RecapItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RecapItem[] = [];
  for (const it of raw) {
    if (it && typeof it === 'object'
      && typeof (it as Record<string, unknown>).ok === 'boolean'
      && nonEmptyString((it as Record<string, unknown>).text)) {
      items.push({ ok: (it as { ok: boolean }).ok, text: (it as { text: string }).text });
    }
  }
  return items;
}

/**
 * Validate + coerce a raw (JSON-parsed) model response into RecapContent, or null
 * if it is structurally unusable (the caller then falls back). starsEarned is
 * clamped to 1..STARS_MAX; figuredOut drops malformed items.
 */
export function parseRecapContent(raw: unknown): RecapContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;

  const starsEarned = clampInt(a.starsEarned, 1, STARS_MAX);
  const solvedSelf = clampInt(a.solvedSelf, 0, 1000);
  const solvedTotal = clampInt(a.solvedTotal, 0, 1000);
  if (starsEarned === null || solvedSelf === null || solvedTotal === null) return null;
  if (!nonEmptyString(a.insightTitle) || !nonEmptyString(a.insightBody) || !nonEmptyString(a.insightBadge)) {
    return null;
  }

  return {
    starsEarned,
    starsMax: STARS_MAX,
    solvedSelf,
    solvedTotal,
    figuredOut: parseFiguredOut(a.figuredOut),
    insightTitle: a.insightTitle,
    insightBody: a.insightBody,
    insightBadge: a.insightBadge,
  };
}

/** A safe, warm recap used when generation fails, times out, or returns garbage. */
export function fallbackRecap(): RecapContent {
  return {
    starsEarned: 1,
    starsMax: STARS_MAX,
    solvedSelf: 0,
    solvedTotal: 0,
    figuredOut: [{ ok: true, text: 'We had a great session together!' }],
    insightTitle: 'Nice effort today',
    insightBody: 'You showed up and gave it a try — that is how learning grows.',
    insightBadge: 'GREAT EFFORT',
  };
}

/** Serialize the transcript into a readable script for the summarizer's input. */
export function transcriptToScript(turns: TranscriptTurn[], childName: string): string {
  return turns
    .map((t) => `${t.role === 'pip' ? 'Pip' : childName}: ${t.text}`)
    .join('\n');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/recapContent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/recap/recapContent.ts apps/server/test/recap/recapContent.test.ts
git commit -m "feat(recap): recap content schema, validation, fallback, transcript script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `generateRecap` orchestrator + Gemini generator + fake

**Files:**
- Create: `apps/server/src/recap/generateRecap.ts`
- Create: `apps/server/src/recap/fakeRecapGenerator.ts`
- Test: `apps/server/test/recap/generateRecap.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/recap/generateRecap.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { generateRecap, type RecapGenerator } from '../../src/recap/generateRecap';
import { fallbackRecap, STARS_MAX } from '../../src/recap/recapContent';
import type { TranscriptTurn } from '@study-buddy/shared';

const turns: TranscriptTurn[] = [
  { role: 'pip', text: 'What is 2 plus 3?' },
  { role: 'child', text: 'Five!' },
];
const input = { turns, childName: 'Maya', grade: 3, subjectKind: 'math' as const, topic: 'Adding' };

const goodRaw = {
  figuredOut: [{ ok: true, text: 'You added 2 and 3' }],
  solvedSelf: 1, solvedTotal: 1, starsEarned: 3,
  insightTitle: 'Quick adder', insightBody: 'You found it fast.', insightBadge: 'QUICK',
};

describe('generateRecap', () => {
  it('returns parsed content when the generator succeeds', async () => {
    const gen: RecapGenerator = async () => goodRaw;
    const r = await generateRecap(input, gen);
    expect(r.starsEarned).toBe(3);
    expect(r.starsMax).toBe(STARS_MAX);
    expect(r.figuredOut[0].text).toBe('You added 2 and 3');
  });

  it('passes the rendered instruction and transcript script to the generator', async () => {
    let seenInstruction = '';
    let seenScript = '';
    const gen: RecapGenerator = async (instruction, script) => {
      seenInstruction = instruction; seenScript = script; return goodRaw;
    };
    await generateRecap(input, gen);
    expect(seenInstruction).toContain('Maya');
    expect(seenInstruction).not.toMatch(/\{\{.*?\}\}/);
    expect(seenScript).toBe('Pip: What is 2 plus 3?\nMaya: Five!');
  });

  it('falls back when the generator throws', async () => {
    const gen: RecapGenerator = async () => { throw new Error('boom'); };
    const r = await generateRecap(input, gen);
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when the generator returns garbage', async () => {
    const gen: RecapGenerator = async () => ({ nope: true });
    const r = await generateRecap(input, gen);
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when the generator exceeds the timeout', async () => {
    const gen: RecapGenerator = () => new Promise((resolve) => setTimeout(() => resolve(goodRaw), 50));
    const r = await generateRecap(input, gen, 10); // 10ms timeout < 50ms generator
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when no generator is provided', async () => {
    const r = await generateRecap(input, null);
    expect(r).toEqual(fallbackRecap());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/generateRecap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator + Gemini generator**

Create `apps/server/src/recap/generateRecap.ts`:

```typescript
import { GoogleGenAI } from '@google/genai';
import type { SubjectKind, TranscriptTurn } from '@study-buddy/shared';
import { buildRecapInstruction } from './recapTemplate';
import {
  parseRecapContent, fallbackRecap, transcriptToScript,
  RECAP_RESPONSE_SCHEMA, type RecapContent,
} from './recapContent';

/** Non-streaming text model for the post-session recap summary. */
const RECAP_MODEL = 'gemini-3-flash-preview';

/** Generation is bounded so a slow/hung call can never block the session-end path. */
const RECAP_TIMEOUT_MS = 15_000;

export interface RecapGenInput {
  turns: TranscriptTurn[];
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
}

/**
 * Injectable summarizer: given the rendered system instruction and the transcript
 * script, return the raw (JSON-parsed) model output. Real impl calls Gemini; tests
 * pass a fake. May throw — generateRecap catches and falls back.
 */
export type RecapGenerator = (instruction: string, transcriptScript: string) => Promise<unknown>;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('recap-timeout')), ms);
    timer.unref?.();
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Produce a recap from the transcript. Always resolves to a usable RecapContent:
 * the model output when it is valid and timely, otherwise an encouraging fallback.
 */
export async function generateRecap(
  input: RecapGenInput,
  generator: RecapGenerator | null,
  timeoutMs: number = RECAP_TIMEOUT_MS,
): Promise<RecapContent> {
  if (!generator) return fallbackRecap();
  try {
    const instruction = await buildRecapInstruction(input);
    const script = transcriptToScript(input.turns, input.childName);
    const raw = await withTimeout(generator(instruction, script), timeoutMs);
    return parseRecapContent(raw) ?? fallbackRecap();
  } catch {
    return fallbackRecap();
  }
}

/** Production generator backed by @google/genai (non-streaming, structured output). */
export function makeGeminiRecapGenerator(apiKey: string): RecapGenerator {
  const ai = new GoogleGenAI({ apiKey });
  return async (instruction, transcriptScript) => {
    const res = await ai.models.generateContent({
      model: RECAP_MODEL,
      contents: transcriptScript,
      config: {
        systemInstruction: instruction,
        responseMimeType: 'application/json',
        responseSchema: RECAP_RESPONSE_SCHEMA,
      },
    });
    return JSON.parse(res.text ?? '{}');
  };
}
```

- [ ] **Step 4: Implement the test fake**

Create `apps/server/src/recap/fakeRecapGenerator.ts`:

```typescript
import type { RecapGenerator } from './generateRecap';

/** A scripted recap generator for tests: returns a fixed raw object, records inputs. */
export function makeFakeRecapGenerator(raw: unknown): RecapGenerator & {
  calls: { instruction: string; script: string }[];
} {
  const calls: { instruction: string; script: string }[] = [];
  const gen = (async (instruction: string, script: string) => {
    calls.push({ instruction, script });
    return raw;
  }) as RecapGenerator & { calls: typeof calls };
  gen.calls = calls;
  return gen;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/generateRecap.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 6: Typecheck (verifies the `@google/genai` generateContent shape compiles)**

Run: `cd apps/server && bun run typecheck`
Expected: PASS. If `config.responseSchema` or `responseMimeType` type-errors against the installed `@google/genai` (`^1.0.0`), check the exact field names with `mcp__plugin_context7_context7` (resolve `@google/genai`, query "generateContent responseSchema structured output") and adjust — the structured-output config keys are the only thing that could differ by SDK minor.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/recap/generateRecap.ts apps/server/src/recap/fakeRecapGenerator.ts apps/server/test/recap/generateRecap.test.ts
git commit -m "feat(recap): generateRecap orchestrator with Gemini generator + timeout fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Schema migration — `transcript` column

**Files:**
- Modify: `apps/server/src/db/schema.ts:150` (the `sessions` table, after `figuredOut`)
- Create (generated): `apps/server/drizzle/0003_*.sql`

- [ ] **Step 1: Add the column to the schema**

In `apps/server/src/db/schema.ts`, inside the `sessions` table column block, add a `transcript` line right after the `figuredOut` column:

```typescript
    figuredOut: jsonb('figured_out'),
    transcript: jsonb('transcript'),
    insightTitle: text('insight_title'),
```

(`jsonb` is already imported.)

- [ ] **Step 2: Generate the migration**

Run: `cd apps/server && bun run db:generate`
Expected: prints a new migration file `drizzle/0003_<name>.sql` containing `ALTER TABLE "sessions" ADD COLUMN "transcript" jsonb;`. (`drizzle-kit generate` diffs against the stored snapshot — no DB connection needed.)

- [ ] **Step 3: Verify the generated SQL**

Run: `ls apps/server/drizzle/0003_*.sql && cat apps/server/drizzle/0003_*.sql`
Expected: a single `ADD COLUMN "transcript" jsonb` statement. If it contains anything else (e.g. unrelated drops), STOP and investigate — the snapshot may be stale.

- [ ] **Step 4: Apply it to the test DB and typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS. (The test DB migration is applied automatically by `migrateAndSeedTestDb` on the next test run.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/
git commit -m "feat(db): add sessions.transcript jsonb column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Persist transcript + recap in `finalizeLiveSession`

**Files:**
- Modify: `apps/server/src/voice/sessionRow.ts`
- Test: `apps/server/test/voice/sessionRow.test.ts`

- [ ] **Step 1: Write the failing test**

Append a test to `apps/server/test/voice/sessionRow.test.ts` (inside the existing `describe('sessionRow', ...)` block):

```typescript
  it('persists transcript + recap columns when finalizing completed', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Adding');
    await mod.finalizeLiveSession(id, 'completed', {
      transcript: [
        { role: 'pip', text: 'What is 2 plus 3?' },
        { role: 'child', text: 'Five!' },
      ],
      recap: {
        starsEarned: 3, starsMax: 3, solvedSelf: 1, solvedTotal: 1,
        figuredOut: [{ ok: true, text: 'You added 2 and 3' }],
        insightTitle: 'Quick adder', insightBody: 'Fast work.', insightBadge: 'QUICK',
      },
    });

    const row = await mod.getSessionById(id);
    expect(row.state).toBe('completed');
    expect(row.starsEarned).toBe(3);
    expect(row.starsMax).toBe(3);
    expect(row.solvedSelf).toBe(1);
    expect(row.figuredOut).toEqual([{ ok: true, text: 'You added 2 and 3' }]);
    expect(row.insightBadge).toBe('QUICK');
    expect(row.transcript).toEqual([
      { role: 'pip', text: 'What is 2 plus 3?' },
      { role: 'child', text: 'Five!' },
    ]);
  });

  it('persists transcript only (no recap) when finalizing abandoned', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'reading', 'A book');
    await mod.finalizeLiveSession(id, 'abandoned', {
      transcript: [{ role: 'child', text: 'bye' }],
    });
    const row = await mod.getSessionById(id);
    expect(row.state).toBe('abandoned');
    expect(row.transcript).toEqual([{ role: 'child', text: 'bye' }]);
    expect(row.starsEarned).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/sessionRow.test.ts`
Expected: FAIL — `finalizeLiveSession` ignores the 3rd arg; `row.transcript` is null / undefined.

- [ ] **Step 3: Implement**

In `apps/server/src/voice/sessionRow.ts`, add imports and extend `finalizeLiveSession`. Replace the existing `finalizeLiveSession` with:

```typescript
import type { SubjectKind, TranscriptTurn } from '@study-buddy/shared';
import type { RecapContent } from '../recap/recapContent';

export interface FinalizeExtra {
  transcript?: TranscriptTurn[];
  recap?: RecapContent;
}

/** Mark a live session completed/abandoned, stamp endedAt, and persist transcript + recap. */
export async function finalizeLiveSession(
  id: string,
  state: FinalState,
  extra: FinalizeExtra = {},
): Promise<void> {
  await db
    .update(sessions)
    .set({
      state,
      endedAt: new Date(),
      ...(extra.transcript ? { transcript: extra.transcript } : {}),
      ...(extra.recap
        ? {
            starsEarned: extra.recap.starsEarned,
            starsMax: extra.recap.starsMax,
            solvedSelf: extra.recap.solvedSelf,
            solvedTotal: extra.recap.solvedTotal,
            figuredOut: extra.recap.figuredOut,
            insightTitle: extra.recap.insightTitle,
            insightBody: extra.recap.insightBody,
            insightBadge: extra.recap.insightBadge,
          }
        : {}),
    })
    .where(eq(sessions.id, id));
}
```

(Keep the existing `import { SubjectKind } from '@study-buddy/shared'` consolidated — the `createLiveSession` signature still uses `SubjectKind`. Ensure there is exactly one import of it.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/sessionRow.test.ts`
Expected: PASS (existing two tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/sessionRow.ts apps/server/test/voice/sessionRow.test.ts
git commit -m "feat(voice): persist transcript + recap columns in finalizeLiveSession

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire the relay — accumulate, generate, persist

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Modify: `apps/server/src/voice/voiceRoute.ts`
- Test: `apps/server/test/voice/relay.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/voice/relay.test.ts` (inside `describe('voice relay', ...)`). Add the import near the other imports at the top of the file:

```typescript
import { makeFakeRecapGenerator } from '../../src/recap/fakeRecapGenerator';
```

Then the test:

```typescript
  it('accumulates the transcript and persists a recap on completed end', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const recapGen = makeFakeRecapGenerator({
      figuredOut: [{ ok: true, text: 'You added 12 apples' }],
      solvedSelf: 1, solvedTotal: 2, starsEarned: 2,
      insightTitle: 'Careful counter', insightBody: 'You counted slowly and surely.', insightBadge: 'CAREFUL',
    });
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out, recapGenerator: recapGen,
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onOutputTranscript('If 12 apples', false);
    ev.onOutputTranscript(' are shared?', true);
    ev.onInputTranscript('six each', true);

    await relay.handleControl({ type: 'end' });

    // The summarizer saw the assembled transcript script.
    expect(recapGen.calls).toHaveLength(1);
    expect(recapGen.calls[0].script).toContain('Pip: If 12 apples are shared?');
    expect(recapGen.calls[0].script).toContain('VoiceTester: six each');

    // The latest completed row holds the persisted recap + transcript.
    const { db } = await import('../../src/db/client');
    const { sessions } = await import('../../src/db/schema');
    const { and, desc, eq } = await import('drizzle-orm');
    const [row] = await db.select().from(sessions)
      .where(and(eq(sessions.childId, VOICE_TEST_CHILD_ID), eq(sessions.state, 'completed')))
      .orderBy(desc(sessions.endedAt)).limit(1);
    expect(row.starsEarned).toBe(2);
    expect(row.starsMax).toBe(3);
    expect(row.insightBadge).toBe('CAREFUL');
    expect(row.transcript).toEqual([
      { role: 'pip', text: 'If 12 apples are shared?' },
      { role: 'child', text: 'six each' },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: FAIL — `recapGenerator` option ignored; transcript not accumulated; recap columns null.

- [ ] **Step 3: Implement the relay changes**

In `apps/server/src/voice/relay.ts`:

(a) Add imports at the top:

```typescript
import { TranscriptAccumulator } from './transcript';
import { generateRecap, type RecapGenerator } from '../recap/generateRecap';
```

(b) Extend `RelayOptions`:

```typescript
export interface RelayOptions {
  childId: string;
  connector: GeminiConnector;
  sink: RelaySink;
  softCapMs?: number; // default 10 min
  recapGenerator?: RecapGenerator | null;
}
```

(c) Add session-scoped state near the other `let` declarations in `createRelay`:

```typescript
  const transcript = new TranscriptAccumulator();
  let childName = 'friend';
  let childGrade = 3;
  let meta: { subjectKind: SubjectKind; topic: string } | null = null;
```

(d) In `buildPrompt`, capture the child name/grade into the closure. Change the two lines that read `child?.name` / `child?.grade` so they also assign:

```typescript
    childName = child?.name ?? 'friend';
    childGrade = child?.grade ?? 3;
    // Count existing sessions BEFORE createLiveSession inserts this one ...
    const priorSessions = await countSessionsForChild(childId);
    return await buildSystemInstruction({
      childName,
      grade: childGrade,
      subjectKind, topic,
      firstSession: priorSessions === 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
```

(e) In `events()`, feed the accumulator the same cleaned text that is forwarded. Update the two transcript handlers:

```typescript
      onInputTranscript: (text, final) => {
        transcript.add('child', text, final);
        sink.sendControl({ type: 'transcript', role: 'child', text, final });
      },
      onOutputTranscript: (text, final) => {
        const clean = pipTurnOpen ? text : stripTextArtifact(text);
        pipTurnOpen = !final;
        transcript.add('pip', clean, final);
        sink.sendControl({ type: 'transcript', role: 'pip', text: clean, final });
      },
```

(f) In `start()`, record `meta` (right after `state = 'connecting';`):

```typescript
    state = 'connecting';
    meta = { subjectKind, topic };
```

(g) Replace the `finish` function body with the recap-generating version:

```typescript
  async function finish(finalState: 'completed' | 'abandoned') {
    if (state === 'ended') return;
    state = 'ended';
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    try { await session?.close(); } catch { /* ignore */ }
    const turns = transcript.turns();
    if (sessionRowId) {
      if (finalState === 'completed') {
        const recap = await generateRecap(
          {
            turns,
            childName,
            grade: childGrade,
            subjectKind: meta?.subjectKind ?? 'math',
            topic: meta?.topic ?? '',
          },
          opts.recapGenerator ?? null,
        );
        await finalizeLiveSession(sessionRowId, 'completed', { transcript: turns, recap });
        await commitLearningProfile(childId, signals.all());
      } else {
        await finalizeLiveSession(sessionRowId, 'abandoned', { transcript: turns });
      }
    }
    sink.sendControl({ type: 'status', state: 'ended' });
  }
```

- [ ] **Step 4: Wire the production generator in `voiceRoute.ts`**

In `apps/server/src/voice/voiceRoute.ts`:

Add the import:

```typescript
import { makeGeminiRecapGenerator } from '../recap/generateRecap';
```

Add the generator next to the connector:

```typescript
const connector = makeGeminiConnector(apiKey);
const recapGenerator = makeGeminiRecapGenerator(apiKey);
```

Pass it into `createRelay` inside `onOpen`:

```typescript
        relay = createRelay({
          childId,
          connector,
          recapGenerator,
          sink: {
            sendControl: (m) => ws.send(JSON.stringify(m)),
            sendBinary: (b) => ws.send(b as Uint8Array<ArrayBuffer>),
          },
        });
```

- [ ] **Step 5: Run the full voice test suite**

Run: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/`
Expected: PASS — the new relay test plus all existing relay/sessionRow/transcript/systemPrompt/profileCommit/tools tests. (Existing relay tests that omit `recapGenerator` now write a fallback recap on end; they assert `ended` + profile commit, which still hold.)

- [ ] **Step 6: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/src/voice/voiceRoute.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(voice): generate + persist recap on completed session end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Client reducer — `ending` (wrapping-up) state

**Files:**
- Modify: `apps/web/src/voice/voiceReducer.ts`
- Test: `apps/web/src/voice/voiceReducer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/voice/voiceReducer.test.ts`:

```typescript
describe('ending (wrapping-up) state', () => {
  it('transitions to ending on the ending action', () => {
    const live: VoiceState = { status: 'live', turns: [], error: null };
    const next = voiceReducer(live, { kind: 'ending' });
    expect(next.status).toBe('ending');
  });

  it('still accepts a server ended status after ending', () => {
    const ending: VoiceState = { status: 'ending', turns: [], error: null };
    const next = voiceReducer(ending, { kind: 'server', msg: { type: 'status', state: 'ended' } });
    expect(next.status).toBe('ended');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && bun test src/voice/voiceReducer.test.ts`
Expected: FAIL — `{ kind: 'ending' }` is not an allowed action type; `status` cannot be `'ending'`.

- [ ] **Step 3: Implement**

In `apps/web/src/voice/voiceReducer.ts`:

Widen the status union:

```typescript
export interface VoiceState {
  status: 'idle' | 'connecting' | 'ending' | VoiceStatus;
  turns: Turn[];
  error: VoiceErrorCode | null;
}
```

Add the action:

```typescript
export type VoiceAction =
  | { kind: 'server'; msg: ServerControl }
  | { kind: 'connecting' }
  | { kind: 'ending' };
```

Handle it at the top of `voiceReducer` (next to the `connecting` guard):

```typescript
  if (action.kind === 'connecting') return { ...state, status: 'connecting', error: null };
  if (action.kind === 'ending') return { ...state, status: 'ending' };
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && bun test src/voice/voiceReducer.test.ts`
Expected: PASS (existing transcript tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/voice/voiceReducer.ts apps/web/src/voice/voiceReducer.test.ts
git commit -m "feat(web): add ending (wrapping-up) voice state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Client hook — keep the socket open after End, await server `ended`

**Files:**
- Modify: `apps/web/src/voice/useVoiceSession.ts`

(Not unit-tested — hook timing over a live WebSocket. Verified by typecheck/build here and the manual smoke in Task 13.)

- [ ] **Step 1: Add a reveal-timeout ref and clear it in teardown**

In `apps/web/src/voice/useVoiceSession.ts`, add a constant near the top (under `WS_BASE`):

```typescript
// Safety net: if the relay never confirms the session ended (crash/network),
// stop waiting after this long so the child is never stuck "wrapping up".
const RECAP_REVEAL_TIMEOUT_MS = 20_000;
```

Add a ref alongside the others in `useVoiceSession`:

```typescript
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

In `teardown`, clear it (add at the start of the `teardown` callback body):

```typescript
  const teardown = useCallback(() => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    captureRef.current?.stop();
    captureRef.current = null;
    // ...rest unchanged
```

- [ ] **Step 2: Rewrite `end()` to keep the socket open and show "wrapping up"**

Replace the existing `end` callback with:

```typescript
  const end = useCallback(() => {
    // Tell the relay to finish. KEEP the socket open so we receive its final
    // 'ended' status once the recap is generated, then navigate to the recap.
    send({ type: 'end' });
    // Stop the mic immediately (visual + privacy) without closing the socket.
    captureRef.current?.stop();
    captureRef.current = null;
    dispatch({ kind: 'ending' });
    if (!revealTimerRef.current) {
      revealTimerRef.current = setTimeout(() => {
        teardown();
        dispatch({ kind: 'server', msg: { type: 'status', state: 'ended' } });
      }, RECAP_REVEAL_TIMEOUT_MS);
    }
  }, [teardown]);
```

> Note: the prior `end()` closed the socket and dispatched `ended` immediately. The relay's `handleDisconnect` (abandoned) path is unaffected — it still fires only if the socket closes before the graceful `end` is processed, and `finish()` no-ops once already ended.

- [ ] **Step 3: Typecheck + build the web app**

Run: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/voice/useVoiceSession.ts
git commit -m "feat(web): keep voice socket open after End to await server recap-ready

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Client route — wrapping-up screen + navigate to `/app/recap`

**Files:**
- Modify: `apps/web/src/routes/app/VoiceRoute.tsx`

- [ ] **Step 1: Navigate to the recap on a went-live ended session**

In `apps/web/src/routes/app/VoiceRoute.tsx`, replace the ended-navigation effect (the one currently doing `navigate('/app')`):

```typescript
  // When a session that truly went live ends cleanly, the recap is now written —
  // take the child to it. A session that never connected returns Home instead.
  useEffect(() => {
    if (state.status !== 'ended' || state.error) return;
    navigate(wentLiveRef.current ? '/app/recap' : '/app');
  }, [state.status, state.error, navigate]);
```

- [ ] **Step 2: Add the wrapping-up screen**

Add this block just before the final `return (` of the component (after the `if (!picked && nav.chooseSubject) { ... }` block):

```tsx
  if (state.status === 'ending') {
    // Only a session that truly went live has a recap being written. A cancel
    // during "Connecting…" ends quickly and routes Home, so show a quiet
    // placeholder rather than a misleading "writing your recap" for that case.
    return wentLiveRef.current ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg px-8 text-center">
        <Pip size={120} state="think" color={pipColorValue} expression="happy" />
        <div className="font-display font-extrabold text-[22px] text-ink">
          Putting together what you learned…
        </div>
        <div className="font-body font-semibold text-[14px] text-ink-2">
          Pip is writing your recap. One moment!
        </div>
      </div>
    ) : (
      <div className="flex-1 bg-bg" />
    );
  }
```

(`Pip`, `pipColorValue`, `wentLiveRef`, and `state` are already in scope. `state="think"` is the same Pip pose used for the connecting state.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/app/VoiceRoute.tsx
git commit -m "feat(web): wrapping-up screen + route to recap on session end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Manual smoke doc + status docs

**Files:**
- Create: `docs/superpowers/SP6-manual-smoke.md`
- Modify: `CLAUDE.md` (Status section + roadmap)
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Write the smoke doc**

Create `docs/superpowers/SP6-manual-smoke.md` with: prerequisites (running stack with `GEMINI_API_KEY`, the migration applied via `docker compose restart server`), and the steps below. Content:

```markdown
# SP6 — Session Recap manual smoke

**Prereqs:** full stack up (`docker compose up`), `GEMINI_API_KEY` set, and the
`transcript` migration applied (the server applies migrations on boot via
`docker-entrypoint.sh`; if you changed schema since the last boot, run
`docker compose restart server`). Needs a real microphone + a human — Playwright
cannot produce real mic audio.

## Happy path (completed → recap)
1. Sign in (`parent@studybuddy.dev` / `studybuddy`), pick a child, enter the app.
2. Start a voice session and have a short real tutoring exchange (work one small
   problem; let Pip guide you to it).
3. Tap **End**.
   - ✅ The "Putting together what you learned…" screen shows immediately.
   - ✅ After a few seconds you land on the recap at `/app/recap`, populated:
     stars (out of 3), "Solved it yourself" count, a "What we figured out" list
     reflecting the actual session, and a "Pip noticed…" insight.
4. Reload `/app/recap` — the same recap loads (it is persisted).

## Persistence check (DB)
- `docker compose exec -T postgres psql -U studybuddy -d studybuddy -c "select state, stars_earned, jsonb_array_length(transcript) as turns, insight_badge from sessions order by ended_at desc nulls last limit 3;"`
  - ✅ Latest completed row has non-null `stars_earned`, `insight_badge`, and a
    `turns` count > 0.

## Tunable prompt check
- Edit `apps/server/study-buddy-recap.md` (e.g. change the insightBadge guidance),
  save, run a new session, End. ✅ Next recap reflects the edit with no restart
  (the file is bind-mounted and read fresh each session). Revert the edit
  afterward, or the drift-guard test will fail until `BUILTIN_RECAP_TEMPLATE`
  matches.

## Fallback check (optional)
- Temporarily set an invalid `GEMINI_API_KEY` for the server, restart, run a
  session, End. ✅ The recap still renders a graceful, encouraging fallback
  (1 star, "We had a great session together!", "GREAT EFFORT") rather than a
  broken/empty screen. Restore the key afterward.

## Abandoned path
- Start a session, then navigate away / close the tab instead of tapping End.
  ✅ No recap is generated for that session (the `/app/recap` still shows the last
  *completed* session), but its transcript IS persisted (`state = 'abandoned'`,
  `transcript` non-null, recap columns null).

## Privacy note
Transcripts are now stored PII. For a real product, add retention/redaction.
This is acceptable for the dev project.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In `CLAUDE.md`, update the **Status** section to note SP6 and add a roadmap entry. Specifically:
- In the Status intro line, add SP6 alongside the others (e.g. "SP6 (session recap)").
- Add a short SP6 paragraph describing: post-session non-streaming Gemini summary (`gemini-3-flash-preview`) writing the existing recap columns; `transcript` jsonb persistence; the externalized, drift-guarded `study-buddy-recap.md`; generate-then-reveal UX (wrapping-up screen → `/app/recap`); graceful fallback; abandoned sessions persist transcript but get no recap.
- Add `SP6-manual-smoke.md` to the smoke-doc list as 🟡 pending a human mic run.
- Add item 6 to the subsystem roadmap: **Session recap** ✓ _done_.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

Refresh the "where things stand" notes to mention SP6 (recap + transcript persistence) on the `sp6-session-recap` branch, awaiting the live mic smoke.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/SP6-manual-smoke.md CLAUDE.md docs/HANDOFF.md
git commit -m "docs(sp6): session recap smoke doc + status updates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full server suite (host, test PG on 5433)**

Run: `docker start sb-test-pg 2>/dev/null; cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: ALL pass (the prior ~83 plus the new recap/transcript/sessionRow/relay tests). Paste the final pass/fail counts.

- [ ] **Step 2: Server typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: PASS, no output.

- [ ] **Step 3: Web unit tests**

Run: `cd apps/web && bun test`
Expected: PASS.

- [ ] **Step 4: Web typecheck + build**

Run: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: PASS.

- [ ] **Step 5: Apply the migration to the running stack and restart**

Run: `export PATH="/usr/local/bin:$PATH"; docker compose restart server && docker compose logs server --tail=30`
Expected: the entrypoint runs `drizzle-kit migrate` cleanly (the `0003` transcript migration applies); server reports healthy. (This readies the stack for the Task 13 human smoke.)

- [ ] **Step 6: Report**

Summarize: test counts, typecheck/build results, and that the stack is ready for the manual mic smoke. Do NOT mark SP6 "verified" — that waits on the human mic run (Task 13). Leave the branch unpushed for the user to integrate.

---

## Notes for the implementer

- **Why keep the socket open after End (Task 11):** the recap is written inside the relay's `finish()` *before* it emits `status: ended`. If the client closed the socket on End (the old behavior), that signal would never arrive and the recap screen would race the write. Waiting for `ended` is the readiness mechanism — no polling column needed.
- **Why the row flips to `completed` only after recap columns are written (Task 8/9):** the recap endpoint filters `state = 'completed'`, so writing state + recap in one `UPDATE` means a concurrent reader never sees a completed-but-empty row.
- **Fallback everywhere (Task 6):** `generateRecap` never throws — a bad/slow/absent model yields `fallbackRecap()`. So `finish()` always persists a usable recap and the child never hits a broken screen.
- **Drift guard (Task 4):** if you edit `study-buddy-recap.md`, update `BUILTIN_RECAP_TEMPLATE` to match byte-for-byte, or the guard test fails (this is intentional — the file and its in-code fallback must stay in lockstep, exactly like `study-buddy.md`).
```
