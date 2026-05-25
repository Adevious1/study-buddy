import type { Repository } from './repository';
import * as fx from './fixtures';

const ok = <T>(value: T): Promise<T> => Promise.resolve(value);

export const mockRepository: Repository = {
  getStudent: () => ok(fx.student),
  getContinueSession: () => ok(fx.continueSession),
  getTodayAssignments: () => ok(fx.todayAssignments),
  getSubjects: () => ok(fx.subjects),
  getLearningProfile: () => ok(fx.learningProfile),
  getWeekActivity: () => ok(fx.weekActivity),
  getRecap: () => ok(fx.recap),
};
