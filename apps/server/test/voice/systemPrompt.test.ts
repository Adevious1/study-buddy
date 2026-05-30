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
