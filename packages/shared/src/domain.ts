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
  notes?: string | null;
  scheduledDate?: string; // YYYY-MM-DD; present on the management list
}

/** Guardian-authored assignment creation payload (client ⇄ server contract). */
export interface NewAssignmentInput {
  subjectKind: SubjectKind;
  title: string;
  scheduledDate: string; // YYYY-MM-DD
  minutes: number;
  notes?: string;
}

/** All fields optional — an edit patch. */
export type AssignmentPatch = Partial<NewAssignmentInput>;

export interface ContinueSession {
  id: string;
  subjectKind: SubjectKind;
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

// --- Auth / API contracts ---

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';

export interface Entitlement {
  entitled: boolean;
  status: BillingStatus | null;
  trialEndsAt: string;            // ISO
  currentPeriodEnd: string | null;
}

export interface ChildProfileSummary {
  id: string;
  name: string;
  grade: number;
  pipColor: PipColor;
  birthDate: string; // YYYY-MM-DD
}

export interface MeResponse {
  guardian: { id: string; email: string; name: string };
  children: ChildProfileSummary[];
  hasPin: boolean;
  entitlement: Entitlement;
}

export interface CreateChildInput {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: number;
  pipColor: PipColor;
  /** Explicit parental consent to processing the child's data. Always true — the literal type forces the checkbox. */
  consent: true;
}

export interface UpdateChildInput {
  name?: string;
  birthDate?: string; // YYYY-MM-DD
  grade?: number;
  pipColor?: PipColor;
}
