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
    const raw = await readFile(SHIPPED_RECAP_PATH, 'utf8');
    expect(raw).toBe(BUILTIN_RECAP_TEMPLATE);
  });
});
