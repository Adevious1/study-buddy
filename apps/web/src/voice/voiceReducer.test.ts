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
