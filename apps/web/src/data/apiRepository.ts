import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';
import type { Repository } from './repository';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const childId = import.meta.env.VITE_CURRENT_CHILD_ID as string;

if (!childId) {
  // eslint-disable-next-line no-console
  console.warn('VITE_CURRENT_CHILD_ID is not set — API calls will 400.');
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`API ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/**
 * Like get(), but maps an HTTP 404 to null. Use for resources that are
 * legitimately absent (no in-progress session, no recap yet, no profile yet) —
 * a missing row is an expected state, not a server error.
 */
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const apiRepository: Repository = {
  getStudent:          (): Promise<Student>                 => get(`/children/${childId}`),
  getContinueSession:  (): Promise<ContinueSession | null>  => getOrNull(`/children/${childId}/sessions/continue`),
  getTodayAssignments: (): Promise<Assignment[]>            => get(`/children/${childId}/assignments/today`),
  getSubjects:         (): Promise<Subject[]>               => get(`/children/${childId}/subjects`),
  getLearningProfile:  (): Promise<LearningProfile | null>  => getOrNull(`/children/${childId}/learning-profile`),
  getWeekActivity:     (): Promise<WeekActivity>            => get(`/children/${childId}/activity?range=week`),
  getRecap:            (): Promise<RecapResult | null>      => getOrNull(`/children/${childId}/sessions/latest/recap`),
};

export const CURRENT_CHILD_ID = childId;
