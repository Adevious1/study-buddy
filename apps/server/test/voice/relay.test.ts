import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from './fixtures';
import { makeFakeGemini } from '../../src/voice/fakeGeminiSession';
import type { ServerControl } from '@study-buddy/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createRelay: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
  ({ createRelay } = await import('../../src/voice/relay'));
});

function sink() {
  const control: ServerControl[] = [];
  const binary: Uint8Array[] = [];
  return {
    control, binary,
    sendControl: (m: ServerControl) => control.push(m),
    sendBinary: (b: Uint8Array) => binary.push(b),
  };
}

describe('voice relay', () => {
  it('start → ready, builds prompt from the child, creates a session row', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });

    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });

    const opts = fake.lastOptions()!;
    expect(opts.systemInstruction).toContain('VoiceTester');
    expect(opts.systemInstruction).toContain('note_learning_signal');
    expect(out.control.find((m) => m.type === 'ready')).toBeTruthy();
  });

  it('demuxes Gemini audio + transcripts and forwards an interrupt', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onAudio(new Uint8Array([1, 2, 3]));
    ev.onOutputTranscript('If 12 apples', false);
    ev.onInputTranscript('is it 8?', true);
    ev.onInterrupted();

    expect(out.binary).toHaveLength(1);
    expect(out.control).toContainEqual({ type: 'transcript', role: 'pip', text: 'If 12 apples', final: false });
    expect(out.control).toContainEqual({ type: 'transcript', role: 'child', text: 'is it 8?', final: true });
    expect(out.control).toContainEqual({ type: 'interrupted' });
  });

  it('acks tool calls and commits accumulated signals on end', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onToolCall('call-1', 'note_learning_signal', { trait: 'visual', strength: 'strong' });
    expect(fake.sent.acks).toContain('note_learning_signal');

    const { readTraitScores } = await import('../../src/voice/profileCommit');
    const before = await readTraitScores(VOICE_TEST_CHILD_ID);
    await relay.handleControl({ type: 'end' });
    const after = await readTraitScores(VOICE_TEST_CHILD_ID);
    expect(after.visual).toBeGreaterThan(before.visual);
    expect(fake.sent.closed).toBe(true);
    expect(out.control.find((m) => m.type === 'status' && m.state === 'ended')).toBeTruthy();
  });

  it('forwards mic audio to Gemini', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    await fake.events();
    relay.handleAudio(new Uint8Array([9, 9, 9]));
    expect(fake.sent.audio).toHaveLength(1);
  });
});
