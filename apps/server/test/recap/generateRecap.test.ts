import { describe, it, expect } from 'bun:test';
import {
  generateRecap, makeRecapGeneratorFromModelCall,
  type RecapGenerator, type ModelCall,
} from '../../src/recap/generateRecap';
import { fallbackRecap, STARS_MAX } from '../../src/recap/recapContent';
import type { TranscriptTurn } from '@study-buddy/shared';

const turns: TranscriptTurn[] = [
  { role: 'pip', text: 'What is 2 plus 3?' },
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
    const r = await generateRecap(input, gen);
    expect(r.starsEarned).toBe(3);
    expect(r.starsMax).toBe(STARS_MAX);
    expect(r.figuredOut[0].text).toBe('You added 2 and 3');
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
    expect(seenScript).toBe('Pip: What is 2 plus 3?\nMaya: Five!');
  });

  it('falls back when the generator throws', async () => {
    const gen: RecapGenerator = async () => { throw new Error('boom'); };
    const r = await generateRecap(input, gen);
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when the generator returns garbage', async () => {
    const gen: RecapGenerator = async () => ({ nope: true });
    const r = await generateRecap(input, gen);
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when the generator exceeds the timeout', async () => {
    const gen: RecapGenerator = () => new Promise((resolve) => setTimeout(() => resolve(goodRaw), 50));
    const r = await generateRecap(input, gen, 10); // 10ms timeout < 50ms generator
    expect(r).toEqual(fallbackRecap());
  });

  it('falls back when no generator is provided', async () => {
    const r = await generateRecap(input, null);
    expect(r).toEqual(fallbackRecap());
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
    const r = await generateRecap(input, gen);
    expect(r).toEqual(fallbackRecap());
  });
});
