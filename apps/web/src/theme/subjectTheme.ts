import type { SubjectKind } from '@study-buddy/shared';

export interface SubjectTheme {
  label: string;
  /** CSS color value or theme token reference */
  color: string;
  /** soft variant for backgrounds */
  soft: string;
  /** short theme token name used by AssignmentCard (e.g. "mint" / "mint-l") */
  token: string;
  softToken: string;
}

const themes: Record<SubjectKind, SubjectTheme> = {
  math:    { label: 'Math',           color: 'var(--color-lavender)', soft: 'var(--color-lavender-l)', token: 'lavender', softToken: 'lavender-l' },
  reading: { label: 'Reading',        color: 'var(--color-mint)',     soft: 'var(--color-mint-l)',     token: 'mint',     softToken: 'mint-l' },
  science: { label: 'Science',        color: 'var(--color-coral)',    soft: 'var(--color-coral-l)',    token: 'coral',    softToken: 'coral-l' },
  writing: { label: 'Writing',        color: 'var(--color-sun)',      soft: 'var(--color-sun-l)',      token: 'sun',      softToken: 'sun-l' },
  spanish: { label: 'Spanish',        color: '#5DB7FF',               soft: '#D6ECFF',                 token: 'spanish-c', softToken: 'spanish-c-l' },
  social:  { label: 'Social Studies', color: '#E07AB3',               soft: '#FAD5EA',                 token: 'social-c', softToken: 'social-c-l' },
};

export function subjectTheme(kind: SubjectKind): SubjectTheme {
  return themes[kind];
}

export function subjectLabel(kind: SubjectKind): string {
  return themes[kind].label;
}
