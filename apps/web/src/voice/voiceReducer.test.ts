import { describe, it, expect } from 'bun:test';
import { voiceReducer, initialVoiceState, type VoiceState } from './voiceReducer';
import type { ServerControl } from '@study-buddy/shared';

const t = (role: 'pip' | 'child', text: string, final: boolean): ServerControl => ({
  type: 'transcript', role, text, final,
});

function run(msgs: ServerControl[], from: VoiceState = initialVoiceState): VoiceState {
  return msgs.reduce((s, msg) => voiceReducer(s, { kind: 'server', msg }), from);
}

describe('voiceReducer transcript accumulation', () => {
  it('appends incremental deltas into one turn (does not replace)', () => {
    const s = run([
      t('pip', 'Let me ', false),
      t('pip', 'think about ', false),
      t('pip', 'what plants need to grow?', true),
    ]);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toEqual({ role: 'pip', text: 'Let me think about what plants need to grow?', final: true });
  });

  it('starts a new turn when the role switches', () => {
    const s = run([
      t('child', 'Tell me about the moon.', true),
      t('pip', 'Great question! ', false),
      t('pip', 'What do you already know?', true),
    ]);
    expect(s.turns.map((x) => x.text)).toEqual([
      'Tell me about the moon.',
      'Great question! What do you already know?',
    ]);
  });

  it('starts a new turn for the same role after the previous one finalized', () => {
    const s = run([
      t('pip', 'First thought.', true),
      t('pip', 'Second thought.', true),
    ]);
    expect(s.turns).toHaveLength(2);
    expect(s.turns.map((x) => x.text)).toEqual(['First thought.', 'Second thought.']);
  });

  it('keeps a bounded rolling window', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => t(i % 2 === 0 ? 'child' : 'pip', `turn ${i}`, true));
    const s = run(msgs);
    expect(s.turns.length).toBeLessThanOrEqual(30);
    // newest turn is preserved
    expect(s.turns[s.turns.length - 1].text).toBe('turn 39');
  });
});

describe('ending (wrapping-up) state', () => {
  it('transitions to ending on the ending action', () => {
    const live: VoiceState = { status: 'live', turns: [], error: null, cameraOffered: false };
    const next = voiceReducer(live, { kind: 'ending' });
    expect(next.status).toBe('ending');
  });

  it('still accepts a server ended status after ending', () => {
    const ending: VoiceState = { status: 'ending', turns: [], error: null, cameraOffered: false };
    const next = voiceReducer(ending, { kind: 'server', msg: { type: 'status', state: 'ended' } });
    expect(next.status).toBe('ended');
  });
});

describe('voiceReducer basic transitions', () => {
  it('starts idle with an empty transcript', () => {
    expect(initialVoiceState.status).toBe('idle');
    expect(initialVoiceState.turns).toEqual([]);
  });

  it('goes live on ready', () => {
    const s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'ready' } });
    expect(s.status).toBe('live');
  });

  it('records an error code, and reaches ended on a server ended status', () => {
    const errored = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'error', code: 'mic-denied', message: 'x' } });
    expect(errored.error).toBe('mic-denied');
    const ended = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'status', state: 'ended' } });
    expect(ended.status).toBe('ended');
  });
});

describe('camera offer', () => {
  it('sets cameraOffered on camera-offered and clears it on camera-consumed', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'camera-offered' } });
    expect(s.cameraOffered).toBe(true);
    s = voiceReducer(s, { kind: 'camera-consumed' });
    expect(s.cameraOffered).toBe(false);
  });
  it('ignores snapshot-ack without throwing', () => {
    const s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'snapshot-ack', ok: true } });
    expect(s).toEqual(initialVoiceState);
  });
});
