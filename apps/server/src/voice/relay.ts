import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children, learningProfiles, learningProfileTraits } from '../db/schema';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { buildSystemInstruction } from './systemPrompt';
import { SignalAccumulator } from './tools';
import { createLiveSession, finalizeLiveSession } from './sessionRow';
import { commitLearningProfile } from './profileCommit';
import type { GeminiConnector, GeminiLiveSession, GeminiEvents } from './geminiSession';

export interface RelaySink {
  sendControl: (m: ServerControl) => void;
  sendBinary: (b: Uint8Array) => void;
}

export interface RelayOptions {
  childId: string;
  connector: GeminiConnector;
  sink: RelaySink;
  softCapMs?: number; // default 10 min
}

type State = 'idle' | 'connecting' | 'live' | 'resuming' | 'ended';

const SOFT_CAP_MS = 10 * 60 * 1000;

export function createRelay(opts: RelayOptions) {
  const { childId, connector, sink } = opts;
  const signals = new SignalAccumulator();

  let state: State = 'idle';
  let session: GeminiLiveSession | null = null;
  let sessionRowId: string | null = null;
  let resumptionHandle: string | undefined;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  async function buildPrompt(subjectKind: SubjectKind, topic: string): Promise<string> {
    const [child] = await db.select().from(children).where(eq(children.id, childId)).limit(1);
    const [profile] = await db
      .select({ id: learningProfiles.id })
      .from(learningProfiles).where(eq(learningProfiles.childId, childId)).limit(1);
    const traits = profile
      ? await db
          .select({ traitId: learningProfileTraits.traitId, label: learningProfileTraits.label, score: learningProfileTraits.score })
          .from(learningProfileTraits).where(eq(learningProfileTraits.profileId, profile.id))
      : [];
    return buildSystemInstruction({
      childName: child?.name ?? 'friend',
      grade: child?.grade ?? 3,
      subjectKind, topic,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
  }

  function events(): GeminiEvents {
    return {
      onAudio: (pcm) => sink.sendBinary(pcm),
      onInputTranscript: (text, final) => sink.sendControl({ type: 'transcript', role: 'child', text, final }),
      onOutputTranscript: (text, final) => sink.sendControl({ type: 'transcript', role: 'pip', text, final }),
      onInterrupted: () => sink.sendControl({ type: 'interrupted' }),
      onToolCall: (id, name, args) => {
        if (name === 'note_learning_signal') signals.addRaw(args);
        session?.ackTool(id, name);
      },
      onResumptionHandle: (handle) => { resumptionHandle = handle; },
      onClose: () => { /* expected ~10min reset; transport reconnect handled in a later task */ },
      onError: () => sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip had trouble connecting.' }),
    };
  }

  async function start(subjectKind: SubjectKind, topic: string, title: string) {
    if (state !== 'idle') return;
    state = 'connecting';
    try {
      const systemInstruction = await buildPrompt(subjectKind, topic);
      session = await connector({ systemInstruction, resumptionHandle }, events());
      sessionRowId = await createLiveSession(childId, subjectKind, title);
      state = 'live';
      sink.sendControl({ type: 'ready' });
      sink.sendControl({ type: 'status', state: 'live' });
      capTimer = setTimeout(() => { void finish('completed'); }, opts.softCapMs ?? SOFT_CAP_MS);
      // Do not let the soft-cap timer keep the process alive on its own (matters in tests).
      capTimer.unref?.();
    } catch {
      state = 'idle';
      sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip could not start.' });
    }
  }

  async function finish(finalState: 'completed' | 'abandoned') {
    if (state === 'ended') return;
    state = 'ended';
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    try { await session?.close(); } catch { /* ignore */ }
    if (sessionRowId) await finalizeLiveSession(sessionRowId, finalState);
    if (finalState === 'completed') await commitLearningProfile(childId, signals.all());
    sink.sendControl({ type: 'status', state: 'ended' });
  }

  return {
    async handleControl(msg: ClientControl) {
      switch (msg.type) {
        case 'start': await start(msg.subjectKind, msg.topic, msg.title); break;
        case 'mute': session?.audioStreamEnd(); break;
        case 'unmute': break;
        case 'end': await finish('completed'); break;
      }
    },
    handleAudio(pcm16k: Uint8Array) {
      if (state === 'live') session?.sendAudio(pcm16k);
    },
    async handleDisconnect() { await finish('abandoned'); },
  };
}
