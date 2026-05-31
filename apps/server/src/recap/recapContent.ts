import { Type } from '@google/genai';
import type { RecapItem, TranscriptTurn } from '@study-buddy/shared';

/** Fixed display maximum for the recap star row. */
export const STARS_MAX = 3;

/** The recap fields the LLM produces; durationSeconds/subjectKind come from the row. */
export interface RecapContent {
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: RecapItem[];
  insightTitle: string;
  insightBody: string;
  insightBadge: string;
}

/** Structured-output schema handed to Gemini. starsMax is set in code, not by the model. */
export const RECAP_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    figuredOut: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ok: { type: Type.BOOLEAN },
          text: { type: Type.STRING },
        },
        required: ['ok', 'text'],
      },
    },
    solvedSelf: { type: Type.INTEGER },
    solvedTotal: { type: Type.INTEGER },
    starsEarned: { type: Type.INTEGER },
    insightTitle: { type: Type.STRING },
    insightBody: { type: Type.STRING },
    insightBadge: { type: Type.STRING },
  },
  required: [
    'figuredOut', 'solvedSelf', 'solvedTotal', 'starsEarned',
    'insightTitle', 'insightBody', 'insightBadge',
  ],
};

const clampInt = (n: unknown, lo: number, hi: number): number | null => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

const nonEmptyString = (s: unknown): s is string => typeof s === 'string' && s.length > 0;

function parseFiguredOut(raw: unknown): RecapItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RecapItem[] = [];
  for (const it of raw) {
    if (it && typeof it === 'object'
      && typeof (it as Record<string, unknown>).ok === 'boolean'
      && nonEmptyString((it as Record<string, unknown>).text)) {
      items.push({ ok: (it as { ok: boolean }).ok, text: (it as { text: string }).text });
    }
  }
  return items;
}

/**
 * Validate + coerce a raw (JSON-parsed) model response into RecapContent, or null
 * if it is structurally unusable (the caller then falls back). starsEarned is
 * clamped to 1..STARS_MAX; figuredOut drops malformed items.
 */
export function parseRecapContent(raw: unknown): RecapContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;

  const starsEarned = clampInt(a.starsEarned, 1, STARS_MAX);
  const solvedSelf = clampInt(a.solvedSelf, 0, 1000);
  const solvedTotal = clampInt(a.solvedTotal, 0, 1000);
  if (starsEarned === null || solvedSelf === null || solvedTotal === null) return null;
  if (!nonEmptyString(a.insightTitle) || !nonEmptyString(a.insightBody) || !nonEmptyString(a.insightBadge)) {
    return null;
  }

  return {
    starsEarned,
    starsMax: STARS_MAX,
    solvedSelf,
    solvedTotal,
    figuredOut: parseFiguredOut(a.figuredOut),
    insightTitle: a.insightTitle,
    insightBody: a.insightBody,
    insightBadge: a.insightBadge,
  };
}

/** A safe, warm recap used when generation fails, times out, or returns garbage. */
export function fallbackRecap(): RecapContent {
  return {
    starsEarned: 1,
    starsMax: STARS_MAX,
    solvedSelf: 0,
    solvedTotal: 0,
    figuredOut: [{ ok: true, text: 'We had a great session together!' }],
    insightTitle: 'Nice effort today',
    insightBody: 'You showed up and gave it a try — that is how learning grows.',
    insightBadge: 'GREAT EFFORT',
  };
}

/** Serialize the transcript into a readable script for the summarizer's input. */
export function transcriptToScript(turns: TranscriptTurn[], childName: string): string {
  return turns
    .map((t) => `${t.role === 'pip' ? 'Pip' : childName}: ${t.text}`)
    .join('\n');
}
