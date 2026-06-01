import { readFile } from 'node:fs/promises';
import type { SubjectKind } from '@study-buddy/shared';

/** Display label for each subject, used when rendering Gemini instructions. */
export const SUBJECT_NAME: Record<SubjectKind, string> = {
  math: 'Math', reading: 'Reading', science: 'Science',
  writing: 'Writing', spanish: 'Spanish', social: 'Social Studies',
};

/**
 * Substitute {{tokens}}, strip ATX markdown heading lines, and drop blank lines
 * left behind by stripped headings and empty tokens. Unknown tokens are left
 * literal. Output is plain newline-joined instruction text.
 */
export function renderTemplate(tpl: string, values: Record<string, string>): string {
  const substituted = tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
  return substituted
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    // Drop ATX markdown headings (1-6 '#' followed by a space). The space
    // requirement is deliberate: a content line that happens to start with '#'
    // (e.g. "#1 rule: ...") is NOT a heading and must survive.
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Read a template file (hot-reload); fall back to a built-in on any read error. */
export async function loadTemplateFile(path: string, builtin: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    console.warn(`[promptTemplate] could not read ${path}; using built-in template`, err);
    return builtin;
  }
}
