import { describe, it, expect } from 'bun:test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BUILTIN_TEMPLATE,
  renderTemplate,
  loadTemplate,
  buildSystemInstruction,
} from '../../src/voice/systemPrompt';
import type { SystemPromptInput } from '../../src/voice/systemPrompt';

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

  it('keeps a content line that starts with "#" but is not an ATX heading', () => {
    // "#1 rule" has no space after the hash, so it is content, not a heading.
    const out = renderTemplate('## Real heading\n#1 rule: never give the answer', {});
    expect(out).toBe('#1 rule: never give the answer');
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

// Run `fn` with STUDY_BUDDY_PROMPT_PATH pointed at a missing file, so
// buildSystemInstruction/loadTemplate exercise the in-code BUILTIN_TEMPLATE
// fallback rather than the (intentionally diverged) shipped study-buddy.md.
async function withBuiltinFallback<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.STUDY_BUDDY_PROMPT_PATH;
  process.env.STUDY_BUDDY_PROMPT_PATH = join(tmpdir(), 'sb-builtin-fallback-xyz.md');
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STUDY_BUDDY_PROMPT_PATH;
    else process.env.STUDY_BUDDY_PROMPT_PATH = prev;
  }
}

describe('buildSystemInstruction (built-in template)', () => {
  it('reproduces the previous output byte-for-byte (with a trait)', async () => {
    const out = await withBuiltinFallback(() => buildSystemInstruction(inputWithTrait));
    expect(out).toBe(EXPECTED_WITH_TRAIT);
  });

  it('omits the learning-style line when there are no traits', async () => {
    const out = await withBuiltinFallback(() => buildSystemInstruction(inputNoTrait));
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

  // The shipped study-buddy.md is intentionally tuned and may diverge from the
  // in-code BUILTIN_TEMPLATE (which stays as the safe fallback). So instead of
  // byte-identity we assert structural invariants the file must always satisfy.
  it('the shipped study-buddy.md is present and contains all five tokens', async () => {
    const raw = await readFile(join(import.meta.dir, '..', '..', 'study-buddy.md'), 'utf8');
    for (const t of ['{{childName}}', '{{grade}}', '{{subject}}', '{{topic}}', '{{traitLean}}']) {
      expect(raw).toContain(t);
    }
  });

  it('the shipped study-buddy.md renders with every token substituted', async () => {
    const prev = process.env.STUDY_BUDDY_PROMPT_PATH;
    // From apps/server/test/voice/ up to apps/server/study-buddy.md
    process.env.STUDY_BUDDY_PROMPT_PATH = join(import.meta.dir, '..', '..', 'study-buddy.md');
    try {
      const out = await buildSystemInstruction(inputWithTrait);
      // No unsubstituted {{...}} placeholders survive into the prompt.
      expect(out).not.toMatch(/\{\{.*?\}\}/);
      // Live data landed.
      expect(out).toContain('Maya');
      expect(out).toContain('Math');
      expect(out).toContain('Fractions');
      // The non-negotiable Socratic guardrail and the learning-signal tool
      // instruction must always be present, however the file is tuned.
      expect(out).toContain('NEVER state the final answer');
      expect(out).toContain('note_learning_signal');
    } finally {
      if (prev === undefined) delete process.env.STUDY_BUDDY_PROMPT_PATH;
      else process.env.STUDY_BUDDY_PROMPT_PATH = prev;
    }
  });
});
