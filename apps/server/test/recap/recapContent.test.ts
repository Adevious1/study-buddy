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

  it('clamps solvedSelf to not exceed solvedTotal', () => {
    const r = parseRecapContent({ ...valid, solvedSelf: 3, solvedTotal: 1 });
    expect(r!.solvedSelf).toBe(1);
    expect(r!.solvedTotal).toBe(1);
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
