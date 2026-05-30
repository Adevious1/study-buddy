import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { CURRENT_CHILD_ID } from '../data';
import { voiceReducer, initialVoiceState } from './voiceReducer';
import { startCapture, type Capture } from './audioCapture';
import { AudioPlayer } from './audioPlayback';

export interface StartArgs { subjectKind: SubjectKind; topic: string; title: string; }

const WS_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

function wsUrl(childId: string): string {
  const httpBase = WS_BASE.startsWith('http')
    ? WS_BASE
    : `${location.origin}${WS_BASE}`;
  return `${httpBase.replace(/^http/, 'ws')}/children/${childId}/voice`;
}

export function useVoiceSession() {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  const send = (m: ClientControl) => wsRef.current?.send(JSON.stringify(m));

  const start = useCallback(async (args: StartArgs) => {
    dispatch({ kind: 'connecting' });
    let player: AudioPlayer;
    try {
      player = new AudioPlayer();
      playerRef.current = player;
    } catch {
      dispatch({ kind: 'server', msg: { type: 'error', code: 'gemini-unavailable', message: 'Audio unavailable.' } });
      return;
    }

    const ws = new WebSocket(wsUrl(CURRENT_CHILD_ID));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => send({ type: 'start', ...args });
    ws.onmessage = async (evt) => {
      if (typeof evt.data === 'string') {
        const msg = JSON.parse(evt.data) as ServerControl;
        if (msg.type === 'interrupted') playerRef.current?.clear();
        if (msg.type === 'ready') {
          try {
            captureRef.current = await startCapture((pcm16) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(pcm16.buffer as ArrayBuffer);
            });
          } catch {
            dispatch({ kind: 'server', msg: { type: 'error', code: 'mic-denied', message: 'Mic permission denied.' } });
            send({ type: 'end' });
            return;
          }
        }
        dispatch({ kind: 'server', msg });
      } else {
        playerRef.current?.enqueue(new Uint8Array(evt.data as ArrayBuffer));
      }
    };
    ws.onerror = () => dispatch({ kind: 'server', msg: { type: 'error', code: 'connection-lost', message: 'Lost connection.' } });
    ws.onclose = () => dispatch({ kind: 'server', msg: { type: 'status', state: 'ended' } });
  }, []);

  const end = useCallback(() => {
    send({ type: 'end' });
    captureRef.current?.stop();
    playerRef.current?.close();
    wsRef.current?.close();
  }, []);

  const mute = useCallback(() => send({ type: 'mute' }), []);
  const unmute = useCallback(() => send({ type: 'unmute' }), []);

  useEffect(() => () => {
    captureRef.current?.stop();
    playerRef.current?.close();
    wsRef.current?.close();
  }, []);

  return { state, start, end, mute, unmute };
}
