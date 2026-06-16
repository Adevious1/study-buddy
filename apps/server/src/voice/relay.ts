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
import { reportError, reportSignal } from '../observability/reportError';
import type { RelayRegistry, Drainable } from './relayRegistry';

export interface RelaySink {
  sendControl: (m: ServerControl) => void;
  sendBinary: (b: Uint8Array) => void;
}

export interface RelayOptions {
  childId: string;
  connector: GeminiConnector;
  sink: RelaySink;
  softCapMs?: number; // default 15 min
  nudgeLeadMs?: number; // default 2 min before the cap
  reconnectBackoffsMs?: number[]; // default [500, 1500]
  recapGenerator?: RecapGenerator | null;
  registry?: RelayRegistry;
}

type State = 'idle' | 'connecting' | 'live' | 'resuming' | 'ended';

const SOFT_CAP_MS = 15 * 60 * 1000; // hard session cap (wall-clock from start)
const NUDGE_LEAD_MS = 2 * 60 * 1000; // wrap-up nudge fires this long before the cap
const RECONNECT_BACKOFFS_MS = [500, 1500]; // delays between reconnect attempts (2 retries)
const WRAP_UP_CUE =
  '[director cue: about two minutes left — start guiding toward a natural stopping point and a quick recap of what you two figured out.]';
const MAX_SNAPSHOT_BYTES = 2_000_000; // ~2MB decoded; a 1024px q0.85 JPEG is far smaller
// 4 base64 chars per 3 decoded bytes — lets oversized payloads be rejected
// from the string length alone, before paying for the decode.
const MAX_SNAPSHOT_B64_CHARS = Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let systemInstruction = '';
  let reconnectCount = 0;
  let draining = false;
  let reconnecting = false;
  // Forward reference: assigned synchronously at the bottom of createRelay (before
  // any session goes live) so finish() can reference it without a definite-assignment
  // error. The no-op stub is replaced immediately.
  let drainHandle: Drainable = { shutdown: async () => {} };
  // True while a Pip turn is mid-stream (deltas still arriving); the leading
  // "Text " artifact is only stripped on the first delta of each turn.
  let pipTurnOpen = false;

  async function buildPrompt(subjectKind: SubjectKind, topic: string, notes?: string): Promise<string> {
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
      notes,
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
      onClose: () => { if (state === 'live') void reconnect(); },
      onError: () => sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip had trouble connecting.' }),
    };
  }

  function connectGemini(): Promise<GeminiLiveSession> {
    return connector({ systemInstruction, resumptionHandle }, events());
  }

  async function reconnect() {
    if (reconnecting) return; // never overlap reconnect attempts
    reconnecting = true;
    // Only the unexpected mid-session Gemini reset reaches here (onClose checks
    // state === 'live'). Mark 'resuming' so handleAudio drops mic input and the
    // client shows "one sec…".
    try {
      state = 'resuming';
      sink.sendControl({ type: 'status', state: 'resuming' });
      if (!resumptionHandle) {
        // No handle yet (sub-~1-min session) — context can't be restored; end cleanly.
        await finish('completed');
        return;
      }
      const backoffs = opts.reconnectBackoffsMs ?? RECONNECT_BACKOFFS_MS;
      for (let attempt = 0; ; attempt++) {
        try {
          const next = await connectGemini();
          // The cap or a child-end may have fired during the await.
          if ((state as State) === 'ended') { try { await next.close(); } catch { /* ignore */ } return; }
          session = next;
          state = 'live';
          reconnectCount += 1;
          sink.sendControl({ type: 'status', state: 'live' });
          return;
        } catch {
          if (attempt >= backoffs.length) break;
          await delay(backoffs[attempt]);
          if ((state as State) === 'ended') return;
        }
      }
      if ((state as State) === 'ended') return;
      reportSignal('reconnect-exhausted', { childId, sessionId: sessionRowId ?? undefined }, 'error');
      sink.sendControl({ type: 'error', code: 'connection-lost', message: 'Lost connection.' });
      await finish('completed');
    } finally {
      reconnecting = false;
    }
  }

  async function start(subjectKind: SubjectKind, topic: string, title: string, notes?: string) {
    if (state !== 'idle') return;
    state = 'connecting';
    meta = { subjectKind, topic };
    try {
      systemInstruction = await buildPrompt(subjectKind, topic, notes);
      session = await connectGemini();
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
      opts.registry?.register(drainHandle);
      const cap = opts.softCapMs ?? SOFT_CAP_MS;
      const lead = opts.nudgeLeadMs ?? NUDGE_LEAD_MS;
      capTimer = setTimeout(() => { void finish('completed'); }, cap);
      // Do not let the soft-cap timer keep the process alive on its own (matters in tests).
      capTimer.unref?.();
      // A couple minutes before the hard cap, privately nudge Pip to start wrapping up.
      // Best-effort: skipped if the session isn't live (e.g. mid-reconnect 'resuming' or
      // already ended). Math.max guards the rare lead >= cap case (fires immediately).
      nudgeTimer = setTimeout(() => {
        if (state === 'live') {
          try { session?.sendText(WRAP_UP_CUE); } catch { /* best-effort cue */ }
        }
      }, Math.max(0, cap - lead));
      nudgeTimer.unref?.();
    } catch (err) {
      reportError('voice-start', err, { childId });
      state = 'idle';
      sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip could not start.' });
    }
  }

  async function finish(finalState: 'completed' | 'abandoned') {
    if (state === 'ended') return;
    state = 'ended';
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
    try { await session?.close(); } catch { /* ignore */ }
    const turns = transcript.turns();
    // If a DB write below throws, the row stays in_progress (never surfaces as a
    // recap) and the child sees their previous completed recap — acceptable
    // degradation. The finally still emits 'ended' so the client always advances.
    try {
      if (sessionRowId) {
        if (finalState === 'completed') {
          const generator = draining ? null : (opts.recapGenerator ?? null);
          const recapResult = await generateRecap(
            {
              turns,
              childName,
              grade: childGrade,
              subjectKind: meta?.subjectKind ?? 'math',
              topic: meta?.topic ?? '',
            },
            generator,
          );
          await finalizeLiveSession(sessionRowId, 'completed', {
            transcript: turns,
            recap: recapResult.content,
            recapSource: recapResult.source,
            reconnectCount,
          });
          await commitLearningProfile(childId, signals.all());
        } else {
          await finalizeLiveSession(sessionRowId, 'abandoned', { transcript: turns, reconnectCount });
        }
      }
    } finally {
      // Always tell the client the session ended, even if a DB write failed —
      // the browser's wrapping-up screen waits for this to navigate to the recap.
      sink.sendControl({ type: 'status', state: 'ended' });
    }
    opts.registry?.unregister(drainHandle);
  }

  async function handleSnapshot(mime: string, data: string) {
    if (state !== 'live' || !session || !sessionRowId) return;
    if (mime !== 'image/jpeg' || data.length === 0 || data.length > MAX_SNAPSHOT_B64_CHARS) {
      sink.sendControl({ type: 'snapshot-ack', ok: false });
      return;
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_SNAPSHOT_BYTES) {
      sink.sendControl({ type: 'snapshot-ack', ok: false });
      return;
    }
    // Forward to Pip first (the conversational value); persistence is best-effort.
    try {
      session.sendImage(data);
    } catch {
      sink.sendControl({ type: 'snapshot-ack', ok: false });
      return;
    }
    try {
      await saveSnapshot(sessionRowId, childId, bytes, mime);
    } catch (e) {
      reportError('snapshot-save', e, { sessionId: sessionRowId, childId });
    }
    sink.sendControl({ type: 'snapshot-ack', ok: true });
  }

  async function shutdown(): Promise<void> {
    draining = true;
    await finish('completed');
  }
  drainHandle = { shutdown };

  return {
    async handleControl(msg: ClientControl) {
      switch (msg.type) {
        case 'start': await start(msg.subjectKind, msg.topic, msg.title, msg.notes); break;
        case 'mute':
          try { session?.audioStreamEnd(); }
          catch (e) { reportError('relay-send-control', e, { childId, sessionId: sessionRowId ?? undefined }); }
          break;
        case 'unmute': break;
        case 'snapshot': await handleSnapshot(msg.mime, msg.data); break;
        case 'end': await finish('completed'); break;
      }
    },
    handleAudio(pcm16k: Uint8Array) {
      if (state !== 'live') return;
      try { session?.sendAudio(pcm16k); }
      catch (e) { reportError('relay-send-audio', e, { childId, sessionId: sessionRowId ?? undefined }); }
    },
    async handleDisconnect() { await finish('abandoned'); },
    shutdown,
  };
}
