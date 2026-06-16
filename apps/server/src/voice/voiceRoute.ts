import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import type { ClientControl } from '@study-buddy/shared';
import { type ChildVariables } from '../lib/childContext';
import { requireEntitled } from '../lib/requireEntitled';
import { createRelay } from './relay';
import { makeGeminiConnector } from './geminiSession';
import { makeGeminiRecapGenerator } from '../recap/generateRecap';
import { relayRegistry } from './relayRegistry';

const apiKey = process.env.GEMINI_API_KEY ?? '';
// Fail at boot, not as a cryptic mid-session Gemini auth error. Dev/test keep
// the empty-string default so the server boots without voice credentials.
if (process.env.NODE_ENV === 'production' && !apiKey) {
  throw new Error('GEMINI_API_KEY is required in production');
}
const connector = makeGeminiConnector(apiKey);
const recapGenerator = makeGeminiRecapGenerator(apiKey);

export const voiceWebsocket = websocket;

export const voiceRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/voice',
  requireEntitled,
  upgradeWebSocket((c) => {
    const childId = c.req.param('childId') ?? '';
    let relay: ReturnType<typeof createRelay> | null = null;

    return {
      onOpen(_evt, ws) {
        if (relayRegistry.isDraining()) {
          try { ws.send(JSON.stringify({ type: 'error', code: 'server-draining', message: 'Server is restarting — please try again in a moment.' })); } catch { /* ignore */ }
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        relay = createRelay({
          childId,
          connector,
          recapGenerator,
          registry: relayRegistry,
          sink: {
            sendControl: (m) => ws.send(JSON.stringify(m)),
            sendBinary: (b) => ws.send(b as Uint8Array<ArrayBuffer>),
          },
        });
      },
      onMessage(evt, _ws) {
        const data = evt.data;
        if (typeof data === 'string') {
          let msg: ClientControl;
          try { msg = JSON.parse(data) as ClientControl; } catch { return; }
          void relay?.handleControl(msg);
        } else {
          // data is ArrayBufferLike (the .buffer of the Uint8Array/Buffer Bun passed in)
          const bytes = new Uint8Array(data as ArrayBufferLike);
          relay?.handleAudio(bytes);
        }
      },
      onClose() {
        void relay?.handleDisconnect();
      },
    };
  }),
);
