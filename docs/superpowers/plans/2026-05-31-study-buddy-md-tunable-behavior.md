# Tunable Pip Behavior via `study-buddy.md` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Pip's voice system prompt out of hardcoded TypeScript into a hot-reloaded, checked-in `apps/server/study-buddy.md` with placeholder tokens, falling back to an in-code built-in template — so behavior can be tuned by editing prose, with no rebuild or restart.

**Architecture:** `systemPrompt.ts` keeps a `BUILTIN_TEMPLATE` string (the markdown, used as both fallback and canonical reference). A pure `renderTemplate(tpl, values)` substitutes `{{tokens}}`, strips markdown heading lines, and collapses blank lines. `loadTemplate()` reads `study-buddy.md` fresh each call (the hot-reload) and falls back to the built-in on any error. `buildSystemInstruction()` becomes `async`: it computes derived values (subject display name, `traitLean`), loads + renders. The rendered built-in output is **byte-identical** to today's prompt.

**Tech Stack:** TypeScript, Bun (runtime + `bun:test`), Node `fs/promises`. No new dependencies.

---

## Spec

`docs/superpowers/specs/2026-05-31-study-buddy-md-tunable-behavior-design.md`

## File Structure

- **Modify** `apps/server/src/voice/systemPrompt.ts` — replace the hardcoded array
  with `BUILTIN_TEMPLATE` + `renderTemplate` + `loadTemplate` + an async
  `buildSystemInstruction`. Single responsibility: build the system instruction
  string. Stays small (~80 lines).
- **Create** `apps/server/study-buddy.md` — the editable, hot-reloaded template.
  Content equals `BUILTIN_TEMPLATE`.
- **Create** `apps/server/src/voice/systemPrompt.test.ts` — pure unit tests (no DB):
  faithful-port byte-equality, token substitution, heading stripping, unknown-token
  passthrough, file load, fallback.
- **Modify** `apps/server/src/voice/relay.ts:47` — add `await` (now that
  `buildSystemInstruction` is async). `buildPrompt` is already async and already
  `return`s the call, so this is a one-keyword change.

## Reference: today's exact output

`buildSystemInstruction` currently returns these lines joined by `\n`, with empty
lines filtered out. For a child named `Maya`, grade `3`, subject `math`, topic
`Fractions`, top trait label `Pictures`:

```
You are Pip, a warm, patient, encouraging tutor for Maya, a grade 3 student.
You are helping with Math — specifically "Fractions".
SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If Maya is stuck, break the problem into one smaller step and ask again.
Maya tends to learn best through pictures; lean into that when it helps.
Always speak and listen in English (US). If Maya uses another language or you mishear, gently continue in simple English.
Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.
If Maya goes off-topic or seems upset, gently steer back. Do not lecture.
When you notice Maya responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.
```

With **no traits**, the `traitLean` line is absent (7 lines instead of 8). The new
implementation must reproduce both cases byte-for-byte.

---

### Task 1: Build the new `systemPrompt.ts` (pure functions: template + render)

**Files:**
- Modify: `apps/server/src/voice/systemPrompt.ts`
- Test: `apps/server/src/voice/systemPrompt.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/voice/systemPrompt.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import {
  BUILTIN_TEMPLATE,
  renderTemplate,
  buildSystemInstruction,
} from './systemPrompt';
import type { SystemPromptInput } from './systemPrompt';

// The exact string the previous hardcoded implementation produced.
const EXPECTED_WITH_TRAIT = [
  'You are Pip, a warm, patient, encouraging tutor for Maya, a grade 3 student.',
  'You are helping with Math — specifically "Fractions".',
  'SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If Maya is stuck, break the problem into one smaller step and ask again.',
  'Maya tends to learn best through pictures; lean into that when it helps.',
  'Always speak and listen in English (US). If Maya uses another language or you mishear, gently continue in simple English.',
  'Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.',
  'If Maya goes off-topic or seems upset, gently steer back. Do not lecture.',
  'When you notice Maya responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.',
].join('\n');

const EXPECTED_NO_TRAIT = [
  'You are Pip, a warm, patient, encouraging tutor for Maya, a grade 3 student.',
  'You are helping with Math — specifically "Fractions".',
  'SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If Maya is stuck, break the problem into one smaller step and ask again.',
  'Always speak and listen in English (US). If Maya uses another language or you mishear, gently continue in simple English.',
  'Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.',
  'If Maya goes off-topic or seems upset, gently steer back. Do not lecture.',
  'When you notice Maya responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.',
].join('\n');

const inputWithTrait: SystemPromptInput = {
  childName: 'Maya',
  grade: 3,
  subjectKind: 'math',
  topic: 'Fractions',
  traits: [
    { traitId: 'kinesthetic', label: 'Hands-on', score: 2 },
    { traitId: 'visual', label: 'Pictures', score: 5 },
  ],
};

const inputNoTrait: SystemPromptInput = {
  childName: 'Maya',
  grade: 3,
  subjectKind: 'math',
  topic: 'Fractions',
  traits: [],
};

describe('renderTemplate', () => {
  it('substitutes known tokens', () => {
    const out = renderTemplate('Hi {{childName}}, grade {{grade}}.', {
      childName: 'Maya',
      grade: '3',
    });
    expect(out).toBe('Hi Maya, grade 3.');
  });

  it('strips markdown heading lines', () => {
    const out = renderTemplate('# Title\n## Section\nbody text', {});
    expect(out).toBe('body text');
  });

  it('collapses blank lines left by an empty token', () => {
    const out = renderTemplate('line one\n{{empty}}\nline two', { empty: '' });
    expect(out).toBe('line one\nline two');
  });

  it('leaves unknown/misspelled tokens literal', () => {
    const out = renderTemplate('Hi {{grdae}}', { grade: '3' });
    expect(out).toBe('Hi {{grdae}}');
  });
});

describe('buildSystemInstruction (built-in template)', () => {
  it('reproduces the previous output byte-for-byte (with a trait)', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).toBe(EXPECTED_WITH_TRAIT);
  });

  it('omits the learning-style line when there are no traits', async () => {
    const out = await buildSystemInstruction(inputNoTrait);
    expect(out).toBe(EXPECTED_NO_TRAIT);
  });
});

describe('BUILTIN_TEMPLATE', () => {
  it('contains all five tokens', () => {
    for (const t of ['{{childName}}', '{{grade}}', '{{subject}}', '{{topic}}', '{{traitLean}}']) {
      expect(BUILTIN_TEMPLATE).toContain(t);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && bun test src/voice/systemPrompt.test.ts`
Expected: FAIL — `BUILTIN_TEMPLATE` / `renderTemplate` are not exported yet, and
`buildSystemInstruction` is not async.

- [ ] **Step 3: Rewrite `systemPrompt.ts`**

Replace the entire contents of `apps/server/src/voice/systemPrompt.ts` with:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/**
 * Canonical Pip behavior. This is both the fallback (when study-buddy.md is
 * missing/unreadable) and the reference for what the file should contain.
 * Headings (`#` lines) are for human readability and are stripped before the
 * instruction is sent to Gemini.
 */
export const BUILTIN_TEMPLATE = `# Pip — Study Buddy Behavior

## Persona
You are Pip, a warm, patient, encouraging tutor for {{childName}}, a grade {{grade}} student.
You are helping with {{subject}} — specifically "{{topic}}".

## Socratic Rules (most important)
SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If {{childName}} is stuck, break the problem into one smaller step and ask again.

## Learning Style
{{traitLean}}

## Language
Always speak and listen in English (US). If {{childName}} uses another language or you mishear, gently continue in simple English.

## Tone
Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.

## Staying on track
If {{childName}} goes off-topic or seems upset, gently steer back. Do not lecture.

## Learning-signal tool (do not mention to the child)
When you notice {{childName}} responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.
`;

/** Where the editable template lives; overridable for tests/deploys. */
function templatePath(): string {
  return process.env.STUDY_BUDDY_PROMPT_PATH ?? join(import.meta.dir, '..', '..', 'study-buddy.md');
}

/** Read study-buddy.md fresh (hot-reload); fall back to the built-in on any error. */
export async function loadTemplate(): Promise<string> {
  try {
    return await readFile(templatePath(), 'utf8');
  } catch (err) {
    console.warn(`[systemPrompt] could not read ${templatePath()}; using built-in template`, err);
    return BUILTIN_TEMPLATE;
  }
}

/**
 * Substitute {{tokens}}, strip markdown heading lines, and collapse the blank
 * lines left behind by stripped headings and empty tokens. Unknown tokens are
 * left literal. Output is plain newline-joined instruction text.
 */
export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const substituted = tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
  return substituted
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => !/^\s*#/.test(line)) // drop markdown headings
    .filter((line) => line.length > 0) // drop blank lines
    .join('\n');
}

function traitLean(input: SystemPromptInput): string {
  const top = [...input.traits].sort((a, b) => b.score - a.score)[0];
  return top
    ? `${input.childName} tends to learn best through ${top.label.toLowerCase()}; lean into that when it helps.`
    : '';
}

export async function buildSystemInstruction(input: SystemPromptInput): Promise<string> {
  const tpl = await loadTemplate();
  return renderTemplate(tpl, {
    childName: input.childName,
    grade: String(input.grade),
    subject: SUBJECT_NAME[input.subjectKind],
    topic: input.topic,
    traitLean: traitLean(input),
  });
}
```

Note: the built-in puts each instruction on its own line; the blank-line filter in
`renderTemplate` removes the inter-section blank lines and the empty `{{traitLean}}`
line, yielding exactly the previous newline-joined output.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && bun test src/voice/systemPrompt.test.ts`
Expected: PASS — all describe blocks green (byte-equality with and without traits).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/systemPrompt.ts apps/server/src/voice/systemPrompt.test.ts
git commit -m "feat(voice): template-driven system prompt with built-in fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the hot-reloaded `study-buddy.md` file + load/fallback tests

**Files:**
- Create: `apps/server/study-buddy.md`
- Test: `apps/server/src/voice/systemPrompt.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append to the test file)**

Append to `apps/server/src/voice/systemPrompt.test.ts`:

```typescript
import { loadTemplate } from './systemPrompt';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadTemplate', () => {
  it('reads the file at STUDY_BUDDY_PROMPT_PATH', async () => {
    const p = join(tmpdir(), `sb-prompt-${process.pid}.md`);
    await writeFile(p, '# H\nhello {{childName}}', 'utf8');
    const prev = process.env.STUDY_BUDDY_PROMPT_PATH;
    process.env.STUDY_BUDDY_PROMPT_PATH = p;
    try {
      const tpl = await loadTemplate();
      expect(tpl).toBe('# H\nhello {{childName}}');
    } finally {
      if (prev === undefined) delete process.env.STUDY_BUDDY_PROMPT_PATH;
      else process.env.STUDY_BUDDY_PROMPT_PATH = prev;
      await rm(p, { force: true });
    }
  });

  it('falls back to the built-in template when the file is unreadable', async () => {
    const prev = process.env.STUDY_BUDDY_PROMPT_PATH;
    process.env.STUDY_BUDDY_PROMPT_PATH = join(tmpdir(), 'sb-does-not-exist-xyz.md');
    try {
      const tpl = await loadTemplate();
      expect(tpl).toBe(BUILTIN_TEMPLATE);
    } finally {
      if (prev === undefined) delete process.env.STUDY_BUDDY_PROMPT_PATH;
      else process.env.STUDY_BUDDY_PROMPT_PATH = prev;
    }
  });

  it('the shipped study-buddy.md renders byte-identical to the built-in', async () => {
    const prev = process.env.STUDY_BUDDY_PROMPT_PATH;
    process.env.STUDY_BUDDY_PROMPT_PATH = join(import.meta.dir, '..', '..', 'study-buddy.md');
    try {
      const out = await buildSystemInstruction(inputWithTrait);
      expect(out).toBe(EXPECTED_WITH_TRAIT);
    } finally {
      if (prev === undefined) delete process.env.STUDY_BUDDY_PROMPT_PATH;
      else process.env.STUDY_BUDDY_PROMPT_PATH = prev;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && bun test src/voice/systemPrompt.test.ts`
Expected: the "shipped study-buddy.md" test FAILS (file does not exist yet → falls
back to built-in, which happens to match... so confirm it fails on the
`STUDY_BUDDY_PROMPT_PATH` read). The other two should pass. If all pass because the
fallback masks the missing file, that is acceptable — the next step makes the file
real and the test meaningful.

- [ ] **Step 3: Create `apps/server/study-buddy.md`**

Create the file with content identical to `BUILTIN_TEMPLATE` (without the
TypeScript backticks):

```markdown
# Pip — Study Buddy Behavior

## Persona
You are Pip, a warm, patient, encouraging tutor for {{childName}}, a grade {{grade}} student.
You are helping with {{subject}} — specifically "{{topic}}".

## Socratic Rules (most important)
SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If {{childName}} is stuck, break the problem into one smaller step and ask again.

## Learning Style
{{traitLean}}

## Language
Always speak and listen in English (US). If {{childName}} uses another language or you mishear, gently continue in simple English.

## Tone
Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.

## Staying on track
If {{childName}} goes off-topic or seems upset, gently steer back. Do not lecture.

## Learning-signal tool (do not mention to the child)
When you notice {{childName}} responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && bun test src/voice/systemPrompt.test.ts`
Expected: PASS — all load/fallback tests green; the shipped-file test confirms the
real `study-buddy.md` renders byte-identical to the built-in.

- [ ] **Step 5: Commit**

```bash
git add apps/server/study-buddy.md apps/server/src/voice/systemPrompt.test.ts
git commit -m "feat(voice): ship editable study-buddy.md (hot-reloaded template)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the async prompt into the relay

**Files:**
- Modify: `apps/server/src/voice/relay.ts:47`

- [ ] **Step 1: Update the call site**

In `apps/server/src/voice/relay.ts`, the `buildPrompt` helper currently ends with:

```typescript
    return buildSystemInstruction({
      childName: child?.name ?? 'friend',
      grade: child?.grade ?? 3,
      subjectKind, topic,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
```

Change `return` to `return await` (the function is already `async` and the caller
at line 76 already `await`s `buildPrompt`):

```typescript
    return await buildSystemInstruction({
      childName: child?.name ?? 'friend',
      grade: child?.grade ?? 3,
      subjectKind, topic,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/server && bun run typecheck`
Expected: clean (no errors). This proves `buildSystemInstruction`'s new
`Promise<string>` return type flows correctly through `buildPrompt` → the
`await buildPrompt(...)` at line 76.

- [ ] **Step 3: Run the full server test suite**

Start the throwaway Postgres if needed, then:

```bash
export PATH="/usr/local/bin:$PATH"
docker ps --filter name=sb-test-pg --format '{{.Names}}' | grep -q sb-test-pg || docker start sb-test-pg
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

Expected: all suites PASS (the new systemPrompt tests + existing relay/tools/profileCommit).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/voice/relay.ts
git commit -m "feat(voice): await async system-prompt builder in relay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verify hot-reload end-to-end against the running stack

**Files:** none (verification only)

- [ ] **Step 1: Restart the server container**

```bash
export PATH="/usr/local/bin:$PATH"
docker compose restart server
```

Wait for health: `docker compose ps server` shows `healthy` (and
`curl -s http://localhost:3001/healthz` → `{"ok":true,"db":"up"}`).

- [ ] **Step 2: Confirm the file is visible inside the container (bind mount)**

```bash
export PATH="/usr/local/bin:$PATH"
docker compose exec -T server sh -c 'head -1 /app/apps/server/study-buddy.md'
```

Expected: `# Pip — Study Buddy Behavior`. This proves the bind mount exposes the
host file to the running server.

- [ ] **Step 3: Prove hot-reload — render the prompt from inside the container before and after an edit**

The relay reads the template per session, so reload requires no restart. Verify the
loader picks up an edit with a one-off script run in-container:

```bash
export PATH="/usr/local/bin:$PATH"
# Render with the current file:
docker compose exec -T server sh -c 'cd /app/apps/server && bun -e "import { loadTemplate } from \"./src/voice/systemPrompt\"; console.log((await loadTemplate()).includes(\"PROBE-MARKER\") ? \"HAS-MARKER\" : \"NO-MARKER\")"'
# Expected: NO-MARKER

# Edit the file on the HOST (append a harmless comment line):
printf '\n<!-- PROBE-MARKER -->\n' >> apps/server/study-buddy.md

# Render again — no restart:
docker compose exec -T server sh -c 'cd /app/apps/server && bun -e "import { loadTemplate } from \"./src/voice/systemPrompt\"; console.log((await loadTemplate()).includes(\"PROBE-MARKER\") ? \"HAS-MARKER\" : \"NO-MARKER\")"'
# Expected: HAS-MARKER  ← proves hot-reload with no restart
```

- [ ] **Step 4: Revert the probe edit**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy
git checkout apps/server/study-buddy.md   # drop the PROBE-MARKER line
git status --short                         # clean (ignoring .claude/)
```

- [ ] **Step 5: Update CLAUDE.md status note**

Add a line under SP3 in `CLAUDE.md` noting Pip's behavior is now editable via
`apps/server/study-buddy.md` (hot-reloaded; falls back to the in-code built-in).
Commit:

```bash
git add CLAUDE.md
git commit -m "docs: note study-buddy.md tunable Pip behavior

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- File location `apps/server/study-buddy.md` + bind-mount rationale → Task 2 (create), Task 4 (verify mount). ✓
- Faithful port, byte-identical → Task 1 byte-equality tests (with/without trait). ✓
- Labeled sections in the file → Task 2 file content (Persona/Socratic/Learning Style/Language/Tone/Staying on track/Learning-signal). ✓
- Placeholder tokens, substituted at session start → Task 1 `renderTemplate` + `buildSystemInstruction`. ✓
- Headings stripped before sending → Task 1 `renderTemplate` heading filter + test. ✓
- Fall back to built-in on error → Task 1 `loadTemplate` + Task 2 fallback test. ✓
- Unknown token left literal → Task 1 passthrough test. ✓
- `traitLean` empty → line removed → Task 1 no-trait byte-equality test. ✓
- `STUDY_BUDDY_PROMPT_PATH` override → Task 1 `templatePath` + Task 2 load test. ✓
- `relay.ts` one-keyword change → Task 3. ✓
- Verification (typecheck, bun test on 5433, restart, hot-reload proof) → Tasks 3 & 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step
shows complete code. ✓

**Type consistency:** `SystemPromptInput` unchanged from current source (childName,
grade, subjectKind, topic, traits). `LearningStyleTrait` has `{ traitId, label,
score }` (confirmed in `packages/shared/src/domain.ts:46-47`) — matches the test
fixtures. `buildSystemInstruction` returns `Promise<string>` consistently in Tasks
1 and 3. `renderTemplate(tpl, values)` and `loadTemplate()` signatures match across
tasks. ✓
