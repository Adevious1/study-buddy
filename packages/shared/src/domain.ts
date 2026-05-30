// Shared domain contracts. Imported by the web app and the server.

export type PipColor = 'coral' | 'mint' | 'lavender' | 'sun' | 'sky';

export type SubjectKind =
  | 'math' | 'reading' | 'science' | 'writing' | 'spanish' | 'social';

export type LearningTraitId = 'visual' | 'narrative' | 'kinesthetic' | 'auditory';

export interface Student {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) */
  birthDate: string;
  grade: number;
  pipColor: PipColor;
  /** ISO date (YYYY-MM-DD) */
  startedWithPipOn: string;
  streakDays: number;
  starsToday: number;
  starsTodayMax: number;
}

export interface Assignment {
  id: string;
  subjectKind: SubjectKind;
  title: string;
  minutes: number;
  stars: number;
  totalStars: number;
}

export interface ContinueSession {
  id: string;
  title: string;
  questionIndex: number;
  questionTotal: number;
}

export interface Subject {
  kind: SubjectKind;
  topic: string;
}

export interface LearningStyleTrait {
  traitId: LearningTraitId;
  label: string;
  /** 0..100 */
  score: number;
}

export interface LearningProfile {
  traits: LearningStyleTrait[];
  note: string;
}

export interface WeekActivity {
  /** Mon..Sun, each 0..100 height percentage for the bar chart */
  bars: number[];
  totalSeconds: number;
  /** signed: positive = more than last week */
  deltaSeconds: number;
  /** which weekday indexes are "done" (filled) in the streak row */
  doneDays: number[];
  todayIndex: number;
}

export interface RecapItem {
  ok: boolean;
  text: string;
}

export interface RecapResult {
  subjectKind: SubjectKind;
  durationSeconds: number;
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: RecapItem[];
  insightTitle: string;
  insightBody: string;
  insightBadge: string;
}
