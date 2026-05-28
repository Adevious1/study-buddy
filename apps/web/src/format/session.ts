import type { ContinueSession } from '@study-buddy/shared';

export function formatProgressLabel(
  s: Pick<ContinueSession, 'questionIndex' | 'questionTotal'>,
): string {
  return `We stopped at question ${s.questionIndex} of ${s.questionTotal}`;
}
