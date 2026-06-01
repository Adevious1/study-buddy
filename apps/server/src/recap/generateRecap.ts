import { GoogleGenAI } from '@google/genai';
import type { SubjectKind, TranscriptTurn } from '@study-buddy/shared';
import { buildRecapInstruction } from './recapTemplate';
import {
  parseRecapContent, fallbackRecap, transcriptToScript,
  RECAP_RESPONSE_SCHEMA, type RecapContent,
} from './recapContent';

/** Non-streaming text model for the post-session recap summary. */
const RECAP_MODEL = 'gemini-3.5-flash';

/**
 * Generation is bounded so a slow/hung call can never block the session-end path.
 * 30s gives headroom for a cold call + structured-output latency; the warm call is
 * ~7s, but the first call after a live session (fresh connection, possible network
 * contention) can spike, and a too-tight bound silently degrades to the fallback.
 */
const RECAP_TIMEOUT_MS = 30_000;

export interface RecapGenInput {
  turns: TranscriptTurn[];
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
}

/**
 * Injectable summarizer: given the rendered system instruction and the transcript
 * script, return the raw (JSON-parsed) model output. Real impl calls Gemini; tests
 * pass a fake. May throw — generateRecap catches and falls back.
 */
export type RecapGenerator = (instruction: string, transcriptScript: string) => Promise<unknown>;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('recap-timeout')), ms);
    timer.unref?.();
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Produce a recap from the transcript. Always resolves to a usable RecapContent:
 * the model output when it is valid and timely, otherwise an encouraging fallback.
 */
export async function generateRecap(
  input: RecapGenInput,
  generator: RecapGenerator | null,
  timeoutMs: number = RECAP_TIMEOUT_MS,
): Promise<RecapContent> {
  if (!generator) return fallbackRecap();
  const startedAt = Date.now();
  try {
    const instruction = await buildRecapInstruction(input);
    const script = transcriptToScript(input.turns, input.childName);
    const raw = await withTimeout(generator(instruction, script), timeoutMs);
    const parsed = parseRecapContent(raw);
    if (!parsed) {
      console.warn(`[recap] model output failed validation after ${Date.now() - startedAt}ms; using fallback`);
      return fallbackRecap();
    }
    console.info(`[recap] generated in ${Date.now() - startedAt}ms`);
    return parsed;
  } catch (err) {
    console.warn(`[recap] generation failed after ${Date.now() - startedAt}ms (${(err as Error)?.message ?? String(err)}); using fallback`);
    return fallbackRecap();
  }
}

/** Production generator backed by @google/genai (non-streaming, structured output). */
export function makeGeminiRecapGenerator(apiKey: string): RecapGenerator {
  const ai = new GoogleGenAI({ apiKey });
  return async (instruction, transcriptScript) => {
    const res = await ai.models.generateContent({
      model: RECAP_MODEL,
      contents: transcriptScript,
      config: {
        systemInstruction: instruction,
        responseMimeType: 'application/json',
        responseSchema: RECAP_RESPONSE_SCHEMA,
      },
    });
    return JSON.parse(res.text ?? '{}');
  };
}
