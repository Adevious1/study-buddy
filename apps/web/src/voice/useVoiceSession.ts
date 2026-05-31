import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientControl, ServerControl, SubjectKind } from '@study-buddy/shared';
import { useActiveChild } from '../state/ChildProfileContext';
import { voiceReducer, initialVoiceState } from './voiceReducer';
import { startCapture, type Capture } from './audioCapture';
import { AudioPlayer } from './audioPlayback';

export interface StartArgs { subjectKind: SubjectKind; topic: string; title: string; }

const WS_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

// Safety net: if the relay never confirms the session ended (crash/network),
// stop waiting after this long so the child is never stuck "wrapping up".
const RECAP_REVEAL_TIMEOUT_MS = 20_000;

function wsUrl(childId: string): string {
  const httpBase = WS_BASE.startsWith('http')
    ? WS_BASE
    : `${location.origin}${WS_BASE}`;
  return `${httpBase.replace(/^http/, 'ws')}/children/${childId}/voice`;
}

export function useVoiceSession() {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const { activeChildId } = useActiveChild();
  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = (m: ClientControl) => wsRef.current?.send(JSON.stringify(m));

  const teardown = useCallback(() => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    captureRef.current?.stop();
    captureRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    const ws = wsRef.current;
    // Clear the ref BEFORE closing so the socket's own close/error events fail
    // the isCurrent() check below and are ignored (intentional teardown).
    wsRef.current = null;
    ws?.close();
  }, []);

  const start = useCallback(async (args: StartArgs) => {
    // No active child → nothing to connect to. The voice screen is gated behind a
    // selected profile, so this is defensive: it avoids opening a malformed
    // /api/children//voice socket if start() is ever called without one.
    if (!activeChildId) return;
    dispatch({ kind: 'connecting' });
    let player: AudioPlayer;
    try {
      player = new AudioPlayer();
      playerRef.current = player;
    } catch {
      dispatch({ kind: 'server', msg: { type: 'error', code: 'gemini-unavailable', message: 'Audio unavailable.' } });
      return;
    }

    const ws = new WebSocket(wsUrl(activeChildId));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    // Only react to events from the socket that is still the current one. Under
    // React StrictMode the start effect runs twice (open → teardown → open), so a
    // superseded socket's late close/error must not surface as an error/ended.
    const isCurrent = () => wsRef.current === ws;

    ws.onopen = () => { if (isCurrent()) send({ type: 'start', ...args }); };
    ws.onmessage = async (evt) => {
      if (!isCurrent()) return;
      if (typeof evt.data === 'string') {
        const msg = JSON.parse(evt.data) as ServerControl;
        if (msg.type === 'interrupted') playerRef.current?.clear();
        if (msg.type === 'ready') {
          try {
            captureRef.current = await startCapture((pcm16) => {
              if (!mutedRef.current && ws.readyState === WebSocket.OPEN) ws.send(pcm16.buffer as ArrayBuffer);
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
    ws.onerror = () => {
      if (isCurrent()) dispatch({ kind: 'server', msg: { type: 'error', code: 'connection-lost', message: 'Lost connection.' } });
    };
    ws.onclose = () => {
      if (isCurrent()) dispatch({ kind: 'server', msg: { type: 'status', state: 'ended' } });
    };
  }, [activeChildId]);

  const end = useCallback(() => {
    // Tell the relay to finish. KEEP the socket open so we receive its final
    // 'ended' status once the recap is generated, then navigate to the recap.
    send({ type: 'end' });
    // Stop the mic immediately (visual + privacy) without closing the socket.
    captureRef.current?.stop();
    captureRef.current = null;
    dispatch({ kind: 'ending' });
    if (!revealTimerRef.current) {
      revealTimerRef.current = setTimeout(() => {
        teardown();
        dispatch({ kind: 'server', msg: { type: 'status', state: 'ended' } });
      }, RECAP_REVEAL_TIMEOUT_MS);
    }
  }, [teardown]);

  const mute = useCallback(() => { mutedRef.current = true; send({ type: 'mute' }); }, []);
  const unmute = useCallback(() => { mutedRef.current = false; send({ type: 'unmute' }); }, []);

  useEffect(() => teardown, [teardown]);

  return { state, start, end, mute, unmute };
}
