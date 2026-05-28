import { Hono } from 'hono';
import type { ChildVariables } from '../lib/childContext';

export const childrenRoute = new Hono<{ Variables: ChildVariables }>().get('/:childId', (c) => {
  const child = c.get('child');
  return c.json({
    id: child.id,
    name: child.name,
    birthDate: child.birthDate,
    grade: child.grade,
    pipColor: child.pipColor,
    startedWithPipOn: child.startedWithPipOn,
    streakDays: child.streakDays,
    starsToday: child.starsToday,
    starsTodayMax: child.starsTodayMax,
  });
});
