import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';
import type { Repository } from './repository';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

const STORAGE_KEY = 'sb.activeChildId';
let activeChildId: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

export function setActiveChildId(id: string | null): void {
  activeChildId = id;
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
}
export function getActiveChildId(): string {
  if (!activeChildId) throw new Error('No active child selected');
  return activeChildId;
}
export function peekActiveChildId(): string | null {
  return activeChildId;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`API ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const apiRepository: Repository = {
  getStudent:          (): Promise<Student>                => get(`/children/${getActiveChildId()}`),
  getContinueSession:  (): Promise<ContinueSession | null> => getOrNull(`/children/${getActiveChildId()}/sessions/continue`),
  getTodayAssignments: (): Promise<Assignment[]>           => get(`/children/${getActiveChildId()}/assignments/today`),
  getSubjects:         (): Promise<Subject[]>              => get(`/children/${getActiveChildId()}/subjects`),
  getLearningProfile:  (): Promise<LearningProfile | null> => getOrNull(`/children/${getActiveChildId()}/learning-profile`),
  getWeekActivity:     (): Promise<WeekActivity>           => get(`/children/${getActiveChildId()}/activity?range=week`),
  getRecap:            (): Promise<RecapResult | null>     => getOrNull(`/children/${getActiveChildId()}/sessions/latest/recap`),
};
