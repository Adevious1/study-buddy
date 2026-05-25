import type {
  Student,
  ContinueSession,
  Assignment,
  Subject,
  LearningProfile,
  WeekActivity,
  RecapResult,
} from '@study-buddy/shared';

export const student: Student = {
  id: 'maya-001',
  name: 'Maya',
  ageLabel: 'Age 8 · Grade 3 · Learning with Pip since Feb',
  pipColor: 'coral',
  streakDays: 5,
  starsToday: 3,
  starsTodayMax: 4,
};

export const continueSession: ContinueSession = {
  title: 'Fractions with pizza',
  progressLabel: 'We stopped at question 3 of 5',
  questionIndex: 3,
  questionTotal: 5,
};

export const todayAssignments: Assignment[] = [
  {
    id: 'assignment-reading',
    subject: 'Reading',
    title: "Charlotte's Web, Ch. 3",
    minutes: 10,
    stars: 0,
    totalStars: 3,
    iconKind: 'reading',
    color: 'mint',
    softColor: 'mint-l',
  },
  {
    id: 'assignment-math',
    subject: 'Math',
    title: 'Word problems',
    minutes: 15,
    stars: 2,
    totalStars: 3,
    iconKind: 'math',
    color: 'lavender',
    softColor: 'lavender-l',
  },
  {
    id: 'assignment-spelling',
    subject: 'Spelling',
    title: '-tion words',
    minutes: 5,
    stars: 0,
    totalStars: 3,
    iconKind: 'writing',
    color: 'sun',
    softColor: 'sun-l',
  },
];

export const subjects: Subject[] = [
  {
    kind: 'math',
    label: 'Math',
    topic: 'Word problems',
    color: 'var(--color-lavender)',
    soft: 'var(--color-lavender-l)',
  },
  {
    kind: 'reading',
    label: 'Reading',
    topic: "Charlotte's Web",
    color: 'var(--color-mint)',
    soft: 'var(--color-mint-l)',
  },
  {
    kind: 'science',
    label: 'Science',
    topic: 'Plants & light',
    color: 'var(--color-coral)',
    soft: 'var(--color-coral-l)',
  },
  {
    kind: 'writing',
    label: 'Writing',
    topic: 'Story ideas',
    color: 'var(--color-sun)',
    soft: 'var(--color-sun-l)',
  },
  {
    kind: 'spanish',
    label: 'Spanish',
    topic: '20 new words',
    color: '#5DB7FF',
    soft: '#D6ECFF',
  },
  {
    kind: 'social',
    label: 'Social Studies',
    topic: 'Our community',
    color: '#E07AB3',
    soft: '#FAD5EA',
  },
];

export const learningProfile: LearningProfile = {
  traits: [
    {
      id: 'visual',
      label: 'Pictures & diagrams',
      score: 82,
      color: 'lavender',
    },
    {
      id: 'narrative',
      label: 'Stories & examples',
      score: 68,
      color: 'mint',
    },
    {
      id: 'kinesthetic',
      label: 'Hands-on practice',
      score: 54,
      color: 'coral',
    },
    {
      id: 'auditory',
      label: 'Hearing it out loud',
      score: 41,
      color: 'sun',
    },
  ],
  note: "Pip updates this from your sessions — it's how each new conversation gets a little more \"you\".",
};

export const weekActivity: WeekActivity = {
  bars: [60, 35, 80, 20, 75, 0, 0],
  totalLabel: '1h 12m',
  deltaLabel: '+18m',
  doneDays: [0, 1, 2, 3, 4],
  todayIndex: 4,
};

export const recap: RecapResult = {
  minutes: 14,
  starsEarned: 2,
  starsMax: 3,
  solvedSelf: 4,
  solvedTotal: 5,
  figuredOut: [
    { ok: true, text: 'Sharing means dividing equally' },
    { ok: true, text: '12 ÷ 4 = 3' },
    { ok: true, text: 'Drawing groups helps with division' },
    { ok: false, text: 'When the leftover is tricky — try again tomorrow' },
  ],
  insightTitle: "You're a picture person!",
  insightBody:
    'You solved it faster when we drew the apples. Next time Pip will start with a picture.',
  insightBadge: 'VISUAL +1',
};
