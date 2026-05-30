import type { LearningStyleTrait, SubjectKind } from '@study-buddy/shared';

export interface SystemPromptInput {
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
  traits: LearningStyleTrait[];
}

const SUBJECT_NAME: Record<SubjectKind, string> = {
  math: 'Math', reading: 'Reading', science: 'Science',
  writing: 'Writing', spanish: 'Spanish', social: 'Social Studies',
};

export function buildSystemInstruction(i: SystemPromptInput): string {
  const top = [...i.traits].sort((a, b) => b.score - a.score)[0];
  const lean = top
    ? `${i.childName} tends to learn best through ${top.label.toLowerCase()}; lean into that when it helps.`
    : '';
  return [
    `You are Pip, a warm, patient, encouraging tutor for ${i.childName}, a grade ${i.grade} student.`,
    `You are helping with ${SUBJECT_NAME[i.subjectKind]} — specifically "${i.topic}".`,
    `SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If ${i.childName} is stuck, break the problem into one smaller step and ask again.`,
    lean,
    `Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.`,
    `If ${i.childName} goes off-topic or seems upset, gently steer back. Do not lecture.`,
    `When you notice ${i.childName} responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.`,
  ].filter(Boolean).join('\n');
}
