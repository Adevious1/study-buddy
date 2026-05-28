import type { Student } from '@study-buddy/shared';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function ageOnDate(birthDate: string, reference: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = reference.getUTCFullYear() - y;
  const beforeBirthday =
    reference.getUTCMonth() + 1 < m ||
    (reference.getUTCMonth() + 1 === m && reference.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function formatStartedWithPip(startedWithPipOn: string): string {
  const [, m] = startedWithPipOn.split('-').map(Number);
  return MONTH_SHORT[m - 1] ?? '';
}

export function formatStudentSubtitle(s: Pick<Student, 'birthDate' | 'grade' | 'startedWithPipOn'>): string {
  const age = ageOnDate(s.birthDate);
  const since = formatStartedWithPip(s.startedWithPipOn);
  return `Age ${age} · Grade ${s.grade} · Learning with Pip since ${since}`;
}
