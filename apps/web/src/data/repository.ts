import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult, SnapshotMeta,
} from '@study-buddy/shared';

export interface Repository {
  getStudent(): Promise<Student>;
  /** null when there is no in-progress session yet (a normal, expected state). */
  getContinueSession(): Promise<ContinueSession | null>;
  getTodayAssignments(): Promise<Assignment[]>;
  getSubjects(): Promise<Subject[]>;
  /** null when the child has no learning profile yet. */
  getLearningProfile(): Promise<LearningProfile | null>;
  getWeekActivity(): Promise<WeekActivity>;
  /** null when the child has no completed session to recap yet. */
  getRecap(): Promise<RecapResult | null>;
  /** Recent snapshots the child showed Pip; [] when none. */
  getRecentSnapshots(): Promise<SnapshotMeta[]>;
}
