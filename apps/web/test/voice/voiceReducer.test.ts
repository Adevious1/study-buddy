import { describe, expect, it } from 'bun:test';
import { initialVoiceState, voiceReducer } from '../../src/voice/voiceReducer';

describe('voiceReducer', () => {
  it('starts idle with empty transcript', () => {
    expect(initialVoiceState.status).toBe('idle');
    expect(initialVoiceState.turns).toEqual([]);
  });

  it('ready → live', () => {
    const s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'ready' } });
    expect(s.status).toBe('live');
  });

  it('appends a new final turn and replaces a non-final partial of the same role', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'If 12', final: false } });
    s = voiceReducer(s, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'If 12 apples', final: true } });
    expect(s.turns).toEqual([{ role: 'pip', text: 'If 12 apples' }]);
  });

  it('keeps separate turns for child vs pip', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'transcript', role: 'pip', text: 'Hi!', final: true } });
    s = voiceReducer(s, { kind: 'server', msg: { type: 'transcript', role: 'child', text: 'Hello', final: true } });
    expect(s.turns.map((t) => t.role)).toEqual(['pip', 'child']);
  });

  it('records errors and ended status', () => {
    let s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'error', code: 'mic-denied', message: 'x' } });
    expect(s.error).toBe('mic-denied');
    s = voiceReducer(initialVoiceState, { kind: 'server', msg: { type: 'status', state: 'ended' } });
    expect(s.status).toBe('ended');
  });
});
