import { GoogleGenAI } from '@google/genai';
import type { SubjectKind, TranscriptTurn } from '@study-buddy/shared';
import { buildRecapInstruction } from './recapTemplate';
import {
  parseRecapContent, fallbackRecap, transcriptToScript,
  RECAP_RESPONSE_SCHEMA, type RecapContent,
} from './recapContent';

// ─── Recap models — update these as Gemini ships newer models ──────────────────
/** Primary non-streaming model for the post-session recap summary. */
const RECAP_PRIMARY_MODEL = 'gemini-3.5-flash';
/** Backup model, tried when the primary is transiently unavailable (e.g. a 503 surge). */
const RECAP_BACKUP_MODEL = 'gemini-3.1-flash-lite';
/**
 * Attempt order for one generation: try the primary, retry the primary once, then
 * fall over to the backup model. The first success wins; only if all fail do we use
 * the encouraging placeholder. Keeps a real recap flowing through a transient
 * primary-model outage.
 */
const RECAP_MODEL_PLAN: readonly string[] = [
  RECAP_PRIMARY_MODEL,
  RECAP_PRIMARY_MODEL,
  RECAP_BACKUP_MODEL,
];
// ───────────────────────────────────────────────────────────────────────────────

/** Per-model-attempt ceiling so one slow/hung call can't stall the whole plan. */
const PER_ATTEMPT_TIMEOUT_MS = 15_000;
/** Overall ceiling around a generation (backstop over the full plan). */
const RECAP_TIMEOUT_MS = 45_000;
/**
 * Below this many turns (or with no child turn at all) there is nothing real to
 * summarize — asking the model anyway invites confabulated achievements (observed
 * live: a 13-second, 0-turn session got a recap claiming "solved 3 of 4").
 */
const MIN_TRANSCRIPT_TURNS = 4;

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

/** A single model call (one model, one attempt). May throw / time out. */
export type ModelCall = (model: string, instruction: string, transcriptScript: string) => Promise<unknown>;

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
  const childSpoke = input.turns.some((t) => t.role === 'child');
  if (input.turns.length < MIN_TRANSCRIPT_TURNS || !childSpoke) {
    console.info(`[recap] transcript too thin (${input.turns.length} turns, childSpoke=${childSpoke}); using fallback`);
    return fallbackRecap();
  }
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

/**
 * Wrap a single-model call into a RecapGenerator that walks RECAP_MODEL_PLAN:
 * try each model in order, return the first success; if every attempt fails, throw
 * the last error (generateRecap then uses the encouraging fallback).
 */
export function makeRecapGeneratorFromModelCall(
  call: ModelCall,
  plan: readonly string[] = RECAP_MODEL_PLAN,
): RecapGenerator {
  return async (instruction, transcriptScript) => {
    let lastErr: unknown = new Error('no recap model attempted');
    for (let i = 0; i < plan.length; i++) {
      try {
        return await call(plan[i], instruction, transcriptScript);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[recap] model ${plan[i]} (attempt ${i + 1}/${plan.length}) failed: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }
    throw lastErr;
  };
}

/** Production generator backed by @google/genai (non-streaming, structured output, plan-aware). */
export function makeGeminiRecapGenerator(apiKey: string): RecapGenerator {
  const ai = new GoogleGenAI({ apiKey });
  const call: ModelCall = async (model, instruction, transcriptScript) => {
    const res = await withTimeout(
      ai.models.generateContent({
        model,
        contents: transcriptScript,
        config: {
          systemInstruction: instruction,
          responseMimeType: 'application/json',
          responseSchema: RECAP_RESPONSE_SCHEMA,
        },
      }),
      PER_ATTEMPT_TIMEOUT_MS,
    );
    return JSON.parse(res.text ?? '{}');
  };
  return makeRecapGeneratorFromModelCall(call);
}
