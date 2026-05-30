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
