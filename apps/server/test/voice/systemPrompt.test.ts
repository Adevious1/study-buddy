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

const inputWithTrait: SystemPromptInput = {
  childName: 'Maya',
  grade: 3,
  subjectKind: 'math',
  topic: 'Fractions',
  firstSession: false,
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
  firstSession: false,
  traits: [],
};

const SHIPPED_PROMPT_PATH = join(import.meta.dir, '..', '..', 'study-buddy.md');

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

describe('buildSystemInstruction (built-in template, default path)', () => {
  // With study-buddy.md the canonical baseline (byte-identical to BUILTIN_TEMPLATE),
  // the default path reads the shipped file; both render the same prompt.
  it('substitutes every token and keeps the Socratic + tool guardrails', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).not.toMatch(/\{\{.*?\}\}/); // no unsubstituted placeholders
    expect(out).toContain('Maya');
    expect(out).toContain('grade 3');
    expect(out).toContain('Math');
    expect(out).toContain('Fractions');
    expect(out).toContain('NEVER state the final answer');
    expect(out).toContain('note_learning_signal');
  });

  it('includes the learning-style lean line when a trait is present', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).toContain('Maya tends to learn best through pictures; lean into that when it helps.');
  });

  it('omits the learning-style lean line when there are no traits', async () => {
    const out = await buildSystemInstruction(inputNoTrait);
    expect(out).not.toContain('tends to learn best through');
    expect(out).not.toMatch(/\{\{.*?\}\}/);
  });

  it('strips markdown headings so no "##" survives into the prompt', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).not.toMatch(/^#/m);
  });

  it('includes the private director-cue rule', async () => {
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).toContain('director cue');
    expect(out).toContain('not the child speaking');
  });

  it('forbids claiming to see a picture before one actually arrives (anti-confabulation)', async () => {
    // Regression guard for the SP7 smoke finding: the native-audio model would
    // role-play "I can see it now!" the moment the child mentioned the camera,
    // before any image was forwarded. The prompt must explicitly forbid that.
    const out = await buildSystemInstruction(inputWithTrait);
    expect(out).toContain('Until a picture has truly arrived, you have not seen anything');
    expect(out).toContain('NEVER say "I can see it"');
  });
});

describe('intro token (first-session gating)', () => {
  it('introduces Pip on the child\'s first-ever session', async () => {
    const out = await buildSystemInstruction({ ...inputNoTrait, firstSession: true });
    expect(out).toContain('first time');
    expect(out).toContain('introduce yourself as Pip');
  });

  it('suppresses the self-intro on later sessions', async () => {
    const out = await buildSystemInstruction({ ...inputNoTrait, firstSession: false });
    expect(out).toContain('already knows you as Pip');
    expect(out).toContain('Do NOT introduce yourself');
  });
});

describe('BUILTIN_TEMPLATE', () => {
  it('contains all six tokens', () => {
    for (const t of ['{{childName}}', '{{grade}}', '{{subject}}', '{{topic}}', '{{intro}}', '{{traitLean}}']) {
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

  it('the shipped study-buddy.md is the canonical baseline: byte-identical to BUILTIN_TEMPLATE', async () => {
    // study-buddy.md is the editable copy; BUILTIN_TEMPLATE is its in-code mirror
    // and fallback. They must stay in lockstep — this guard fails loudly on drift.
    const raw = await readFile(SHIPPED_PROMPT_PATH, 'utf8');
    expect(raw).toBe(BUILTIN_TEMPLATE);
  });
});
