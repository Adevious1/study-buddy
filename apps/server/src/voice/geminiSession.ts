import { GoogleGenAI, Modality } from '@google/genai';
import { noteLearningSignalDeclaration, offerCameraDeclaration } from './tools';

/** Events the relay reacts to. */
export interface GeminiEvents {
  onAudio: (pcm24k: Uint8Array) => void;
  onInputTranscript: (text: string, final: boolean) => void;
  onOutputTranscript: (text: string, final: boolean) => void;
  onInterrupted: () => void;
  onToolCall: (id: string, name: string, args: unknown) => void;
  onResumptionHandle: (handle: string) => void;
  onClose: (reason: string) => void;
  onError: (err: unknown) => void;
}

/** What the relay can do to a live session. */
export interface GeminiLiveSession {
  sendAudio(pcm16k: Uint8Array): void;
  sendImage(jpegBase64: string): void;
  sendText(text: string): void;
  ackTool(id: string, name: string): void;
  audioStreamEnd(): void;
  close(): Promise<void>;
}

export interface GeminiConnectOptions {
  systemInstruction: string;
  resumptionHandle?: string;
}

/** Injectable factory — real impl in prod, fake in tests. */
export type GeminiConnector = (
  opts: GeminiConnectOptions,
  events: GeminiEvents,
) => Promise<GeminiLiveSession>;

const MODEL = 'gemini-3.1-flash-live-preview';

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Production connector backed by @google/genai. */
export function makeGeminiConnector(apiKey: string): GeminiConnector {
  const ai = new GoogleGenAI({ apiKey });
  return async (opts, events) => {
    const session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        // Pin to English so the native-audio model doesn't auto-switch
        // languages on noisy/short input (the system prompt reinforces this).
        speechConfig: { languageCode: 'en-US' },
        systemInstruction: { parts: [{ text: opts.systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [noteLearningSignalDeclaration, offerCameraDeclaration] }],
        sessionResumption: opts.resumptionHandle
          ? { handle: opts.resumptionHandle }
          : {},
      },
      callbacks: {
        onopen: () => {},
        onmessage: (msg) => {
          const sc = msg.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData?.data) events.onAudio(fromBase64(part.inlineData.data));
            }
          }
          if (sc?.inputTranscription?.text) {
            events.onInputTranscript(sc.inputTranscription.text, !!sc.inputTranscription.finished);
          }
          if (sc?.outputTranscription?.text) {
            events.onOutputTranscript(sc.outputTranscription.text, !!sc.outputTranscription.finished);
          }
          if (sc?.interrupted) events.onInterrupted();
          if (msg.toolCall?.functionCalls) {
            for (const fc of msg.toolCall.functionCalls) {
              events.onToolCall(fc.id ?? '', fc.name ?? '', fc.args);
            }
          }
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
            events.onResumptionHandle(msg.sessionResumptionUpdate.newHandle);
          }
        },
        onerror: (e: ErrorEvent) => events.onError(e),
        onclose: (e: CloseEvent) => events.onClose(e.reason || 'closed'),
      },
    });

    return {
      sendAudio: (pcm) =>
        session.sendRealtimeInput({ audio: { data: toBase64(pcm), mimeType: 'audio/pcm;rate=16000' } }),
      sendImage: (b64) =>
        session.sendRealtimeInput({ video: { data: b64, mimeType: 'image/jpeg' } }),
      sendText: (text) => session.sendRealtimeInput({ text }),
      ackTool: (id, name) =>
        session.sendToolResponse({ functionResponses: [{ id, name, response: { ok: true } }] }),
      audioStreamEnd: () => session.sendRealtimeInput({ audioStreamEnd: true }),
      close: async () => { session.close(); },
    };
  };
}
