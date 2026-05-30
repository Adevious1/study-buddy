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
