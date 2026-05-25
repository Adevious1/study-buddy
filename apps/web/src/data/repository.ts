import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';

export interface Repository {
  getStudent(): Promise<Student>;
  getContinueSession(): Promise<ContinueSession>;
  getTodayAssignments(): Promise<Assignment[]>;
  getSubjects(): Promise<Subject[]>;
  getLearningProfile(): Promise<LearningProfile>;
  getWeekActivity(): Promise<WeekActivity>;
  getRecap(): Promise<RecapResult>;
}
