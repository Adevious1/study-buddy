import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children, learningProfiles, learningProfileTraits } from '../db/schema';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { buildSystemInstruction } from './systemPrompt';
import { SignalAccumulator } from './tools';
import { createLiveSession, finalizeLiveSession, countSessionsForChild } from './sessionRow';
import { commitLearningProfile } from './profileCommit';
import { TranscriptAccumulator, stripTextArtifact } from './transcript';
import { generateRecap, type RecapGenerator } from '../recap/generateRecap';
import type { GeminiConnector, GeminiLiveSession, GeminiEvents } from './geminiSession';
import { saveSnapshot } from './snapshots';

export interface RelaySink {
  sendControl: (m: ServerControl) => void;
  sendBinary: (b: Uint8Array) => void;
}

export interface RelayOptions {
  childId: string;
  connector: GeminiConnector;
  sink: RelaySink;
  softCapMs?: number; // default 10 min
  recapGenerator?: RecapGenerator | null;
}

type State = 'idle' | 'connecting' | 'live' | 'resuming' | 'ended';

const SOFT_CAP_MS = 10 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 2_000_000; // ~2MB decoded; a 1024px q0.85 JPEG is far smaller

export function createRelay(opts: RelayOptions) {
  const { childId, connector, sink } = opts;
  const signals = new SignalAccumulator();
  const transcript = new TranscriptAccumulator();
  let childName = 'friend';
  let childGrade = 3;
  let meta: { subjectKind: SubjectKind; topic: string } | null = null;

  let state: State = 'idle';
  let session: GeminiLiveSession | null = null;
  let sessionRowId: string | null = null;
  let resumptionHandle: string | undefined;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  // True while a Pip turn is mid-stream (deltas still arriving); the leading
  // "Text " artifact is only stripped on the first delta of each turn.
  let pipTurnOpen = false;

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
    childName = child?.name ?? 'friend';
    childGrade = child?.grade ?? 3;
    // Count existing sessions BEFORE createLiveSession inserts this one, so a
    // brand-new child (zero rows) gets Pip's one-time self-introduction.
    const priorSessions = await countSessionsForChild(childId);
    return await buildSystemInstruction({
      childName,
      grade: childGrade,
      subjectKind, topic,
      firstSession: priorSessions === 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      traits: traits as any,
    });
  }

  function events(): GeminiEvents {
    return {
      onAudio: (pcm) => sink.sendBinary(pcm),
      onInputTranscript: (text, final) => {
        transcript.add('child', text, final);
        sink.sendControl({ type: 'transcript', role: 'child', text, final });
      },
      onOutputTranscript: (text, final) => {
        // Gemini's native-audio output transcription occasionally prefixes a
        // stray "Text " token at the very start of a turn. Strip it only on the
        // first delta of each Pip turn so a legitimate later "Text" is untouched.
        const clean = pipTurnOpen ? text : stripTextArtifact(text);
        pipTurnOpen = !final;
        transcript.add('pip', clean, final);
        sink.sendControl({ type: 'transcript', role: 'pip', text: clean, final });
      },
      onInterrupted: () => {
        // An interrupt cuts off Pip's turn; the next output is a fresh turn,
        // so re-arm the leading-"Text " strip for its first delta.
        pipTurnOpen = false;
        sink.sendControl({ type: 'interrupted' });
      },
      onToolCall: (id, name, args) => {
        if (name === 'note_learning_signal') signals.addRaw(args);
        if (name === 'offer_camera') sink.sendControl({ type: 'camera-offered' });
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
    meta = { subjectKind, topic };
    try {
      const systemInstruction = await buildPrompt(subjectKind, topic);
      session = await connector({ systemInstruction, resumptionHandle }, events());
      sessionRowId = await createLiveSession(childId, subjectKind, title);
      // If the child ended/left while we were still connecting, finish() has
      // already run (it saw a null sessionRowId and skipped the DB). Do NOT go
      // live: close the freshly-opened Gemini session and finalize the orphaned
      // row as abandoned. Otherwise late ready/live messages would flip the
      // client out of its wrapping-up screen and re-open the mic.
      if ((state as State) === 'ended') {
        try { await session?.close(); } catch { /* ignore */ }
        try { await finalizeLiveSession(sessionRowId, 'abandoned'); } catch { /* ignore */ }
        return;
      }
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
    const turns = transcript.turns();
    // If a DB write below throws, the row stays in_progress (never surfaces as a
    // recap) and the child sees their previous completed recap — acceptable
    // degradation. The finally still emits 'ended' so the client always advances.
    try {
      if (sessionRowId) {
        if (finalState === 'completed') {
          const recap = await generateRecap(
            {
              turns,
              childName,
              grade: childGrade,
              subjectKind: meta?.subjectKind ?? 'math',
              topic: meta?.topic ?? '',
            },
            opts.recapGenerator ?? null,
          );
          await finalizeLiveSession(sessionRowId, 'completed', { transcript: turns, recap });
          await commitLearningProfile(childId, signals.all());
        } else {
          await finalizeLiveSession(sessionRowId, 'abandoned', { transcript: turns });
        }
      }
    } finally {
      // Always tell the client the session ended, even if a DB write failed —
      // the browser's wrapping-up screen waits for this to navigate to the recap.
      sink.sendControl({ type: 'status', state: 'ended' });
    }
  }

  async function handleSnapshot(mime: string, data: string) {
    if (state !== 'live' || !session || !sessionRowId) return;
    if (mime !== 'image/jpeg') { sink.sendControl({ type: 'snapshot-ack', ok: false }); return; }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_BYTES) {
      sink.sendControl({ type: 'snapshot-ack', ok: false });
      return;
    }
    // Forward to Pip first (the conversational value); persistence is best-effort.
    session.sendImage(data);
    try {
      await saveSnapshot(sessionRowId, childId, bytes, mime);
    } catch (e) {
      console.error('[snapshot] save failed', e);
    }
    sink.sendControl({ type: 'snapshot-ack', ok: true });
  }

  return {
    async handleControl(msg: ClientControl) {
      switch (msg.type) {
        case 'start': await start(msg.subjectKind, msg.topic, msg.title); break;
        case 'mute': session?.audioStreamEnd(); break;
        case 'unmute': break;
        case 'snapshot': await handleSnapshot(msg.mime, msg.data); break;
        case 'end': await finish('completed'); break;
      }
    },
    handleAudio(pcm16k: Uint8Array) {
      if (state === 'live') session?.sendAudio(pcm16k);
    },
    async handleDisconnect() { await finish('abandoned'); },
  };
}
