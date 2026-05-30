import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import type { ClientControl } from '@study-buddy/shared';
import { type ChildVariables } from '../lib/childContext';
import { createRelay } from './relay';
import { makeGeminiConnector } from './geminiSession';

const apiKey = process.env.GEMINI_API_KEY ?? '';
const connector = makeGeminiConnector(apiKey);

export const voiceWebsocket = websocket;

export const voiceRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/voice',
  upgradeWebSocket((c) => {
    const childId = c.req.param('childId') ?? '';
    let relay: ReturnType<typeof createRelay> | null = null;

    return {
      onOpen(_evt, ws) {
        relay = createRelay({
          childId,
          connector,
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
