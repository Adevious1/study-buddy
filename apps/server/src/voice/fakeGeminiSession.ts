import type {
  GeminiConnector, GeminiEvents, GeminiLiveSession, GeminiConnectOptions,
} from './geminiSession';

/** A scripted fake: tests grab the captured events object and push messages in. */
export interface FakeHandle {
  connector: GeminiConnector;
  /** Resolves once the FIRST connect() has wired events (unchanged for existing tests). */
  events(): Promise<GeminiEvents>;
  /** The most recent connect()'s events — use after a reconnect to drive the new session. */
  latestEvents(): GeminiEvents | null;
  /** The most recent connect()'s options. */
  lastOptions(): GeminiConnectOptions | null;
  /** Every connect()'s options, in call order (index 1 is the first reconnect). */
  optionsLog(): GeminiConnectOptions[];
  /** How many times connect() has been called. */
  connectCount(): number;
  /** Sends accumulate across ALL connects (one shared session) — a reconnect does not
   *  reset these; assert on totals, not per-session deltas. */
  sent: { audio: Uint8Array[]; images: string[]; text: string[]; acks: string[]; closed: boolean; audioEnded: boolean };
}

export function makeFakeGemini(): FakeHandle {
  const optsLog: GeminiConnectOptions[] = [];
  const eventsLog: GeminiEvents[] = [];
  let resolveFirst: (e: GeminiEvents) => void;
  const firstEventsP = new Promise<GeminiEvents>((r) => { resolveFirst = r; });
  const sent = { audio: [] as Uint8Array[], images: [] as string[], text: [] as string[], acks: [] as string[], closed: false, audioEnded: false };

  const session: GeminiLiveSession = {
    sendAudio: (pcm) => sent.audio.push(pcm),
    sendImage: (b64) => sent.images.push(b64),
    sendText: (t) => sent.text.push(t),
    ackTool: (_id, name) => sent.acks.push(name),
    audioStreamEnd: () => { sent.audioEnded = true; },
    close: async () => { sent.closed = true; },
  };

  const connector: GeminiConnector = async (o, e) => {
    optsLog.push(o);
    eventsLog.push(e);
    if (eventsLog.length === 1) resolveFirst(e);
    return session;
  };

  return {
    connector,
    events: () => firstEventsP,
    latestEvents: () => eventsLog[eventsLog.length - 1] ?? null,
    lastOptions: () => optsLog[optsLog.length - 1] ?? null,
    optionsLog: () => optsLog,
    connectCount: () => optsLog.length,
    sent,
  };
}
