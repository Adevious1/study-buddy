import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from './fixtures';
import { makeFakeGemini } from '../../src/voice/fakeGeminiSession';
import { makeFakeRecapGenerator } from '../../src/recap/fakeRecapGenerator';
import type { ServerControl } from '@study-buddy/shared';
import { listRecentSnapshotsForChild } from '../../src/voice/snapshots';
import type { GeminiConnector } from '../../src/voice/geminiSession';

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

/** Let the relay's async reconnect (which awaits connectGemini) settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

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

  it('does not go live (and cleans up) if the session ends while still connecting', async () => {
    // A connector we resolve manually, to interleave end() between connect start and finish.
    let resolveConnect: ((s: unknown) => void) | null = null;
    let connectorInvoked!: () => void;
    // connectorReadyP resolves once start() actually calls connector(), i.e. after
    // buildPrompt's DB work completes and start() is blocked inside the connector await.
    const connectorReadyP = new Promise<void>((r) => { connectorInvoked = r; });
    const fakeSession = {
      closed: false,
      sendAudio() {}, sendText() {}, ackTool() {}, audioStreamEnd() {},
      close: async () => { fakeSession.closed = true; },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connector = (_opts: any, _events: any) => new Promise((r) => {
      resolveConnect = r as (s: unknown) => void;
      connectorInvoked();
    });
    const out = sink();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: connector as any, sink: out });

    const startP = relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'X', title: 'X' });
    // Wait until the connector has been invoked (start() is now inside connector await).
    await connectorReadyP;
    // End arrives while start() is still awaiting the connector.
    await relay.handleControl({ type: 'end' });
    // Now the connector resolves — start() must detect the ended state and bail.
    resolveConnect!(fakeSession);
    await startP;

    expect(out.control.some((m) => m.type === 'ready')).toBe(false);
    expect(out.control.some((m) => m.type === 'status' && m.state === 'live')).toBe(false);
    expect(fakeSession.closed).toBe(true);
  });

  it('accumulates the transcript and persists a recap on completed end', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const recapGen = makeFakeRecapGenerator({
      figuredOut: [{ ok: true, text: 'You added 12 apples' }],
      solvedSelf: 1, solvedTotal: 2, starsEarned: 2,
      insightTitle: 'Careful counter', insightBody: 'You counted slowly and surely.', insightBadge: 'CAREFUL',
    });
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out, recapGenerator: recapGen,
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onOutputTranscript('If 12 apples', false);
    ev.onOutputTranscript(' are shared?', true);
    ev.onInputTranscript('six each', true);

    await relay.handleControl({ type: 'end' });

    // The summarizer saw the assembled transcript script.
    expect(recapGen.calls).toHaveLength(1);
    expect(recapGen.calls[0].script).toContain('Pip: If 12 apples are shared?');
    expect(recapGen.calls[0].script).toContain('VoiceTester: six each');

    // The latest completed row holds the persisted recap + transcript.
    const { db } = await import('../../src/db/client');
    const { sessions } = await import('../../src/db/schema');
    const { and, desc, eq } = await import('drizzle-orm');
    const [row] = await db.select().from(sessions)
      .where(and(eq(sessions.childId, VOICE_TEST_CHILD_ID), eq(sessions.state, 'completed')))
      .orderBy(desc(sessions.endedAt)).limit(1);
    expect(row.starsEarned).toBe(2);
    expect(row.starsMax).toBe(3);
    expect(row.insightBadge).toBe('CAREFUL');
    expect(row.transcript).toEqual([
      { role: 'pip', text: 'If 12 apples are shared?' },
      { role: 'child', text: 'six each' },
    ]);
  });

  it('forwards a snapshot to the live session and persists it', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x10, 0x20]).toString('base64');
    await relay.handleControl({ type: 'snapshot', mime: 'image/jpeg', data: jpeg });

    expect(fake.sent.images).toHaveLength(1);
    expect(fake.sent.images[0]).toBe(jpeg);
    expect(out.control).toContainEqual({ type: 'snapshot-ack', ok: true });

    const list = await listRecentSnapshotsForChild(VOICE_TEST_CHILD_ID, 24);
    expect(list.length).toBeGreaterThan(0);
  });

  it('rejects a non-jpeg snapshot without forwarding it', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });

    // relay is typed `any` so no TS error; this exercises runtime validation of mime
    await relay.handleControl({ type: 'snapshot', mime: 'image/png', data: 'AAAA' });

    expect(fake.sent.images).toHaveLength(0);
    expect(out.control).toContainEqual({ type: 'snapshot-ack', ok: false });
  });

  it('emits camera-offered and acks the tool when Pip calls offer_camera', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });
    const ev = await fake.events();

    ev.onToolCall('call-1', 'offer_camera', {});

    expect(out.control).toContainEqual({ type: 'camera-offered' });
    expect(fake.sent.acks).toContain('offer_camera');
  });

  it('acks ok:false (and does not crash) when sendImage throws', async () => {
    const out = sink();
    const throwingConnector: GeminiConnector = async () => ({
      sendAudio() {}, sendImage() { throw new Error('ws closed'); }, sendText() {},
      ackTool() {}, audioStreamEnd() {}, close: async () => {},
    });
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: throwingConnector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Shapes', title: 'Shapes' });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x10]).toString('base64');
    await relay.handleControl({ type: 'snapshot', mime: 'image/jpeg', data: jpeg });
    expect(out.control).toContainEqual({ type: 'snapshot-ack', ok: false });
    expect(out.control.find((m) => m.type === 'snapshot-ack' && m.ok === true)).toBeFalsy();
  });

  it('reconnects with the resumption handle on an unexpected Gemini close', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onResumptionHandle('handle-xyz');
    ev.onClose('reset');
    await tick();

    expect(fake.connectCount()).toBe(2);
    expect(fake.optionsLog()[1].resumptionHandle).toBe('handle-xyz');
    const statuses = out.control.filter((m) => m.type === 'status').map((m) => (m as { state: string }).state);
    expect(statuses).toContain('resuming');
    expect(statuses[statuses.length - 1]).toBe('live');
  });

  it('does not reconnect when Gemini closes after the session has ended', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();
    ev.onResumptionHandle('h');

    await relay.handleControl({ type: 'end' }); // finish(): state -> 'ended', closes session
    ev.onClose('reset');                        // the close finish() triggered
    await tick();

    expect(fake.connectCount()).toBe(1); // never reconnected
  });

  it('ends gracefully (no reconnect) when Gemini closes before any resumption handle', async () => {
    const fake = makeFakeGemini();
    const out = sink();
    const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    const ev = await fake.events();

    ev.onClose('reset'); // no handle was ever delivered
    await tick();

    expect(fake.connectCount()).toBe(1); // no reconnect attempted
    expect(out.control.find((m) => m.type === 'status' && (m as { state: string }).state === 'ended')).toBeTruthy();
  });

  it('after exhausting reconnect retries, emits connection-lost and finalizes the session', async () => {
    let calls = 0;
    let captured: import('../../src/voice/geminiSession').GeminiEvents | null = null;
    const session = {
      sendAudio() {}, sendImage() {}, sendText() {}, ackTool() {}, audioStreamEnd() {},
      close: async () => {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connector = async (_o: any, e: any) => {
      calls += 1;
      if (calls === 1) { captured = e; return session as any; }
      throw new Error('gemini down'); // every reconnect fails
    };
    const out = sink();
    const relay = createRelay({
      childId: VOICE_TEST_CHILD_ID, connector: connector as never, sink: out,
      reconnectBackoffsMs: [1, 1], // fast retries
    });
    await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Word problems', title: 'Word problems' });
    captured!.onResumptionHandle('h');
    captured!.onClose('reset');
    // 3 attempts + 2×1ms backoffs, then finish() does real DB writes before 'ended'.
    await new Promise((r) => setTimeout(r, 200));

    expect(out.control.find((m) => m.type === 'error' && (m as { code: string }).code === 'connection-lost')).toBeTruthy();
    expect(out.control.find((m) => m.type === 'status' && (m as { state: string }).state === 'ended')).toBeTruthy();
  });
});
