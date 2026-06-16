import { describe, it, expect } from 'bun:test';
import {
  generateRecap, makeRecapGeneratorFromModelCall,
  type RecapGenerator, type ModelCall,
} from '../../src/recap/generateRecap';
import { fallbackRecap, STARS_MAX } from '../../src/recap/recapContent';
import type { TranscriptTurn } from '@study-buddy/shared';

const turns: TranscriptTurn[] = [
  { role: 'pip', text: 'What is 2 plus 3?' },
  { role: 'child', text: 'Hmm, let me think.' },
  { role: 'pip', text: 'Take your time!' },
  { role: 'child', text: 'Five!' },
];
const input = { turns, childName: 'Maya', grade: 3, subjectKind: 'math' as const, topic: 'Adding' };

const goodRaw = {
  figuredOut: [{ ok: true, text: 'You added 2 and 3' }],
  solvedSelf: 1, solvedTotal: 1, starsEarned: 3,
  insightTitle: 'Quick adder', insightBody: 'You found it fast.', insightBadge: 'QUICK',
};

describe('generateRecap', () => {
  it('returns parsed content when the generator succeeds', async () => {
    const gen: RecapGenerator = async () => goodRaw;
    const result = await generateRecap(input, gen);
    expect(result.source).toBe('model');
    expect(result.content.starsEarned).toBe(3);
    expect(result.content.starsMax).toBe(STARS_MAX);
    expect(result.content.figuredOut[0].text).toBe('You added 2 and 3');
    expect(result.reason).toBeUndefined();
  });

  it('passes the rendered instruction and transcript script to the generator', async () => {
    let seenInstruction = '';
    let seenScript = '';
    const gen: RecapGenerator = async (instruction, script) => {
      seenInstruction = instruction; seenScript = script; return goodRaw;
    };
    await generateRecap(input, gen);
    expect(seenInstruction).toContain('Maya');
    expect(seenInstruction).not.toMatch(/\{\{.*?\}\}/);
    expect(seenScript).toBe(
      'Pip: What is 2 plus 3?\nMaya: Hmm, let me think.\nPip: Take your time!\nMaya: Five!',
    );
  });

  it('falls back when the generator throws', async () => {
    const gen: RecapGenerator = async () => { throw new Error('boom'); };
    const result = await generateRecap(input, gen);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('generation-failed');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back when the generator returns garbage', async () => {
    const gen: RecapGenerator = async () => ({ nope: true });
    const result = await generateRecap(input, gen);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('invalid-output');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back when the generator exceeds the timeout', async () => {
    const gen: RecapGenerator = () => new Promise((resolve) => setTimeout(() => resolve(goodRaw), 50));
    const result = await generateRecap(input, gen, 10); // 10ms timeout < 50ms generator
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('timeout');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back when no generator is provided', async () => {
    const result = await generateRecap(input, null);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('no-generator');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back WITHOUT calling the model on an empty transcript', async () => {
    let called = false;
    const gen: RecapGenerator = async () => { called = true; return goodRaw; };
    const result = await generateRecap({ ...input, turns: [] }, gen);
    expect(called).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('thin-transcript');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back WITHOUT calling the model on a too-thin transcript', async () => {
    let called = false;
    const gen: RecapGenerator = async () => { called = true; return goodRaw; };
    const thin: TranscriptTurn[] = [
      { role: 'pip', text: 'Hi!' },
      { role: 'child', text: 'Bye.' },
    ];
    const result = await generateRecap({ ...input, turns: thin }, gen);
    expect(called).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('thin-transcript');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('falls back WITHOUT calling the model when the child never spoke', async () => {
    let called = false;
    const gen: RecapGenerator = async () => { called = true; return goodRaw; };
    const pipOnly: TranscriptTurn[] = [
      { role: 'pip', text: 'Hello?' },
      { role: 'pip', text: 'Are you there?' },
      { role: 'pip', text: 'I will wait.' },
      { role: 'pip', text: 'Goodbye!' },
    ];
    const result = await generateRecap({ ...input, turns: pipOnly }, gen);
    expect(called).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('thin-transcript');
    expect(result.content).toEqual(fallbackRecap());
  });

  it('labels a timeout fallback with reason "timeout"', async () => {
    const hang: RecapGenerator = () => new Promise(() => {});
    const result = await generateRecap(input, hang, 50);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('timeout');
    expect(result.content).toEqual(fallbackRecap());
  });
});

describe('makeRecapGeneratorFromModelCall (retry + backup plan)', () => {
  it('uses only the primary model when the first attempt succeeds', async () => {
    const seen: string[] = [];
    const call: ModelCall = async (model) => { seen.push(model); return goodRaw; };
    const gen = makeRecapGeneratorFromModelCall(call, ['primary', 'primary', 'backup']);
    const r = await gen('inst', 'script');
    expect(r).toEqual(goodRaw);
    expect(seen).toEqual(['primary']);
  });

  it('retries the primary, then falls over to the backup model', async () => {
    const seen: string[] = [];
    const call: ModelCall = async (model) => {
      seen.push(model);
      if (model === 'primary') throw new Error('503 high demand');
      return { from: model };
    };
    const gen = makeRecapGeneratorFromModelCall(call, ['primary', 'primary', 'backup']);
    const r = await gen('inst', 'script');
    expect(r).toEqual({ from: 'backup' });
    expect(seen).toEqual(['primary', 'primary', 'backup']);
  });

  it('forwards the instruction and transcript to each attempt', async () => {
    const calls: Array<{ model: string; instruction: string; script: string }> = [];
    const call: ModelCall = async (model, instruction, script) => {
      calls.push({ model, instruction, script });
      throw new Error('down');
    };
    const gen = makeRecapGeneratorFromModelCall(call, ['a', 'b']);
    await gen('the-instruction', 'the-script').catch(() => {});
    expect(calls.map((c) => c.model)).toEqual(['a', 'b']);
    expect(calls.every((c) => c.instruction === 'the-instruction' && c.script === 'the-script')).toBe(true);
  });

  it('throws the last error when every attempt fails (generateRecap then falls back)', async () => {
    const call: ModelCall = async () => { throw new Error('all-models-down'); };
    const gen = makeRecapGeneratorFromModelCall(call, ['a', 'b']);
    await expect(gen('inst', 'script')).rejects.toThrow('all-models-down');
    // composed with generateRecap, a fully-failed plan yields the encouraging fallback
    const result = await generateRecap(input, gen);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('generation-failed');
    expect(result.content).toEqual(fallbackRecap());
  });
});
