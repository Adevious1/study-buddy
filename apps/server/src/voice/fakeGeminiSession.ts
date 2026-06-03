import type {
  GeminiConnector, GeminiEvents, GeminiLiveSession, GeminiConnectOptions,
} from './geminiSession';

/** A scripted fake: tests grab the captured events object and push messages in. */
export interface FakeHandle {
  connector: GeminiConnector;
  /** Resolves once connect() has been called and events are wired. */
  events(): Promise<GeminiEvents>;
  lastOptions(): GeminiConnectOptions | null;
  sent: { audio: Uint8Array[]; images: string[]; text: string[]; acks: string[]; closed: boolean; audioEnded: boolean };
}

export function makeFakeGemini(): FakeHandle {
  let opts: GeminiConnectOptions | null = null;
  let resolveEvents: (e: GeminiEvents) => void;
  const eventsPromise = new Promise<GeminiEvents>((r) => { resolveEvents = r; });
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
    opts = o; resolveEvents(e);
    return session;
  };

  return {
    connector,
    events: () => eventsPromise,
    lastOptions: () => opts,
    sent,
  };
}
