import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LearningStyleTrait, SubjectKind } from '@study-buddy/shared';

export interface SystemPromptInput {
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
  traits: LearningStyleTrait[];
  /** True only on the child's very first session ever; gates Pip's self-intro. */
  firstSession: boolean;
}

const SUBJECT_NAME: Record<SubjectKind, string> = {
  math: 'Math', reading: 'Reading', science: 'Science',
  writing: 'Writing', spanish: 'Spanish', social: 'Social Studies',
};

/**
 * Canonical Pip behavior. This is both the fallback (when study-buddy.md is
 * missing/unreadable) and the reference for what the file should contain.
 * Headings (`#` lines) are for human readability and are stripped before the
 * instruction is sent to Gemini.
 */
export const BUILTIN_TEMPLATE = `# Pip — Study Buddy Behavior

## Persona
You are Pip, a warm, patient, encouraging tutor for {{childName}}, a grade {{grade}} student.
You are helping with {{subject}} — specifically "{{topic}}".

## Socratic Rules (most important)
SOCRATIC RULE (most important): guide with questions and small hints. NEVER state the final answer. If {{childName}} is stuck, break the problem into one smaller step and ask again.

## Learning Style
{{traitLean}}

## Language
Always speak and listen in English (US). If {{childName}} uses another language or you mishear, gently continue in simple English.

## Tone
Speak in short, friendly, spoken sentences a young child can follow. Be cheerful and concrete.

## Staying on track
If {{childName}} goes off-topic or seems upset, gently steer back. Do not lecture.

## Learning-signal tool (do not mention to the child)
When you notice {{childName}} responding well to a way of learning — drawing/pictures = visual, stories/examples = narrative, hands-on/acting it out = kinesthetic, talking it through = auditory — call the note_learning_signal tool. Keep talking naturally and never mention the tool.
`;

/** Where the editable template lives; overridable for tests/deploys. */
function templatePath(): string {
  return process.env.STUDY_BUDDY_PROMPT_PATH ?? join(import.meta.dir, '..', '..', 'study-buddy.md');
}

/** Read study-buddy.md fresh (hot-reload); fall back to the built-in on any error. */
export async function loadTemplate(): Promise<string> {
  try {
    return await readFile(templatePath(), 'utf8');
  } catch (err) {
    console.warn(`[systemPrompt] could not read ${templatePath()}; using built-in template`, err);
    return BUILTIN_TEMPLATE;
  }
}

/**
 * Substitute {{tokens}}, strip markdown heading lines, and collapse the blank
 * lines left behind by stripped headings and empty tokens. Unknown tokens are
 * left literal. Output is plain newline-joined instruction text.
 */
export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const substituted = tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
  return substituted
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    // Drop ATX markdown headings (1-6 '#' followed by a space). The space
    // requirement is deliberate: a hand-edited instruction line that happens to
    // start with '#' (e.g. "#1 rule: ...") is NOT a heading and must survive.
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .filter((line) => line.length > 0) // drop blank lines
    .join('\n');
}

function traitLean(input: SystemPromptInput): string {
  const top = [...input.traits].sort((a, b) => b.score - a.score)[0];
  return top
    ? `${input.childName} tends to learn best through ${top.label.toLowerCase()}; lean into that when it helps.`
    : '';
}

/**
 * The `{{intro}}` value. On a child's first-ever session, Pip introduces itself
 * once. On every later session the child already knows Pip, so we explicitly
 * suppress the re-introduction (an explicit "do not" suppresses it far more
 * reliably than silence).
 */
function intro(input: SystemPromptInput): string {
  return input.firstSession
    ? `This is the very first time you are meeting ${input.childName}. Say a brief, warm hello and introduce yourself as Pip — just this once.`
    : `${input.childName} already knows you as Pip. Do NOT introduce yourself or say "I'm Pip" again — just greet them warmly by name and get started.`;
}

export async function buildSystemInstruction(input: SystemPromptInput): Promise<string> {
  const tpl = await loadTemplate();
  return renderTemplate(tpl, {
    childName: input.childName,
    grade: String(input.grade),
    subject: SUBJECT_NAME[input.subjectKind],
    topic: input.topic,
    traitLean: traitLean(input),
    intro: intro(input),
  });
}
