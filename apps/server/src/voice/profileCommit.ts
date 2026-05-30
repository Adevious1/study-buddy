import { and, eq } from 'drizzle-orm';
import type { LearningSignal, LearningTraitId } from '@study-buddy/shared';
import { db } from '../db/client';
import { learningProfiles, learningProfileTraits } from '../db/schema';

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

/** Read the current trait scores for a child as { traitId: score }. */
export async function readTraitScores(childId: string): Promise<Record<string, number>> {
  const [profile] = await db
    .select({ id: learningProfiles.id })
    .from(learningProfiles)
    .where(eq(learningProfiles.childId, childId))
    .limit(1);
  if (!profile) return {};
  const rows = await db
    .select({ traitId: learningProfileTraits.traitId, score: learningProfileTraits.score })
    .from(learningProfileTraits)
    .where(eq(learningProfileTraits.profileId, profile.id));
  return Object.fromEntries(rows.map((r) => [r.traitId, r.score]));
}

/** Commit accumulated signals to the child's profile in one transaction. */
export async function commitLearningProfile(
  childId: string,
  signals: { trait: LearningTraitId; strength: 'weak' | 'strong' }[],
): Promise<void> {
  if (signals.length === 0) return;
  const deltas = computeTraitDeltas(signals);
  if (Object.keys(deltas).length === 0) return;

  await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ id: learningProfiles.id })
      .from(learningProfiles)
      .where(eq(learningProfiles.childId, childId))
      .limit(1);
    if (!profile) return;

    const current = await tx
      .select({ traitId: learningProfileTraits.traitId, score: learningProfileTraits.score })
      .from(learningProfileTraits)
      .where(eq(learningProfileTraits.profileId, profile.id));

    const updated = applyTraitDeltas(
      current.map((r) => ({ traitId: r.traitId as LearningTraitId, score: r.score })),
      deltas,
    );

    const now = new Date();
    for (const t of updated) {
      await tx
        .update(learningProfileTraits)
        .set({ score: t.score, updatedAt: now })
        .where(and(
          eq(learningProfileTraits.profileId, profile.id),
          eq(learningProfileTraits.traitId, t.traitId),
        ));
    }

    const note = noteFromDeltas(deltas);
    if (note) {
      await tx
        .update(learningProfiles)
        .set({ note, updatedAt: now })
        .where(eq(learningProfiles.id, profile.id));
    }
  });
}
