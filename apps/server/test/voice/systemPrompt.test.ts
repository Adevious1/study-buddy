import { describe, it, expect } from 'bun:test';
import {
  BUILTIN_TEMPLATE,
  renderTemplate,
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
