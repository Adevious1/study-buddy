import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { learningProfiles, learningProfileTraits } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const learningProfileRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/learning-profile',
  async (c) => {
    const child = c.get('child');
    const [profile] = await db
      .select()
      .from(learningProfiles)
      .where(eq(learningProfiles.childId, child.id))
      .limit(1);
    if (!profile) {
      return c.json(
        { error: { code: 'no_learning_profile', message: 'No learning profile yet' } },
        404,
      );
    }
    const traits = await db
      .select()
      .from(learningProfileTraits)
      .where(eq(learningProfileTraits.profileId, profile.id));
    return c.json({
      note: profile.note,
      traits: traits.map((t) => ({ traitId: t.traitId, label: t.label, score: t.score })),
    });
  },
);
