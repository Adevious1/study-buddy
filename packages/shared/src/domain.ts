// Shared domain contracts. Imported by the web app now and by the server later.

export type PipColor = 'coral' | 'mint' | 'lavender' | 'sun' | 'sky';

export type SubjectKind =
  | 'math' | 'reading' | 'science' | 'writing' | 'spanish' | 'social';

export interface Student {
  id: string;
  name: string;
  ageLabel: string;        // e.g. "Age 8 · Grade 3 · Learning with Pip since Feb"
  pipColor: PipColor;
  streakDays: number;
  starsToday: number;
  starsTodayMax: number;
}

export interface Assignment {
  id: string;
  subject: string;         // display label, e.g. "Reading"
  title: string;           // e.g. "Charlotte's Web, Ch. 3"
  minutes: number;
  stars: number;
  totalStars: number;
  iconKind: SubjectKind;
  /** theme color token name for the icon tile, e.g. "mint" */
  color: string;
  /** soft theme color token name, e.g. "mint-l" */
  softColor: string;
}

export interface ContinueSession {
  title: string;           // "Fractions with pizza"
  progressLabel: string;   // "We stopped at question 3 of 5"
  questionIndex: number;   // 3
  questionTotal: number;   // 5
}

export interface Subject {
  kind: SubjectKind;
  label: string;
  topic: string;
  color: string;           // theme token or hex
  soft: string;            // theme token or hex
}

export interface LearningStyleTrait {
  id: string;
  label: string;           // "Pictures & diagrams"
  score: number;           // 0..100
  color: string;           // theme token, e.g. "lavender"
}

export interface LearningProfile {
  traits: LearningStyleTrait[];
  note: string;            // the explanatory line under the bars
}

export interface WeekActivity {
  /** Mon..Sun, each 0..100 height percentage for the bar chart */
  bars: number[];
  totalLabel: string;      // "1h 12m"
  deltaLabel: string;      // "+18m"
  /** which weekday indexes are "done" (filled) in the streak row */
  doneDays: number[];
  todayIndex: number;
}

export interface RecapItem {
  ok: boolean;             // true = figured out, false = try again tomorrow
  text: string;
}

export interface RecapResult {
  minutes: number;
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: RecapItem[];
  insightTitle: string;    // "You're a picture person!"
  insightBody: string;
  insightBadge: string;    // "VISUAL +1"
}
