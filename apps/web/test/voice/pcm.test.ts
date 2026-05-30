import { describe, expect, it } from 'bun:test';
import { floatToPcm16, pcm16ToFloat, downsampleTo16k } from '../../src/voice/pcm';

describe('floatToPcm16', () => {
  it('maps [-1, 0, 1] to int16 range', () => {
    const out = floatToPcm16(new Float32Array([-1, 0, 1]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(32767);
  });
  it('clamps out-of-range input', () => {
    const out = floatToPcm16(new Float32Array([-2, 2]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(32767);
  });
});

describe('pcm16ToFloat', () => {
  it('round-trips through floatToPcm16 within tolerance', () => {
    const f = new Float32Array([-1, -0.5, 0, 0.5, 0.999]);
    const back = pcm16ToFloat(floatToPcm16(f));
    for (let i = 0; i < f.length; i++) expect(Math.abs(back[i] - f[i])).toBeLessThan(0.001);
  });
});

describe('downsampleTo16k', () => {
  it('halves a 32k stream to 16k length', () => {
    const input = new Float32Array(320); // 10ms @ 32k
    const out = downsampleTo16k(input, 32000);
    expect(out.length).toBe(160);
  });
  it('returns input unchanged when already 16k', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(input, 16000)).toBe(input); // same reference, untouched
  });
});
