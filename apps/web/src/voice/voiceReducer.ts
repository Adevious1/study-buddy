import type { ServerControl, VoiceErrorCode, VoiceStatus } from '@study-buddy/shared';

export interface Turn { role: 'pip' | 'child'; text: string; }
export interface VoiceState {
  status: 'idle' | 'connecting' | VoiceStatus;
  turns: Turn[];
  error: VoiceErrorCode | null;
}

export const initialVoiceState: VoiceState = { status: 'idle', turns: [], error: null };

export type VoiceAction =
  | { kind: 'server'; msg: ServerControl }
  | { kind: 'connecting' };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  if (action.kind === 'connecting') return { ...state, status: 'connecting', error: null };
  const msg = action.msg;
  switch (msg.type) {
    case 'ready':
      return { ...state, status: 'live', error: null };
    case 'status':
      return { ...state, status: msg.state };
    case 'error':
      return { ...state, error: msg.code };
    case 'interrupted':
      return state;
    case 'transcript': {
      const turns = [...state.turns];
      const last = turns[turns.length - 1];
      if (last && last.role === msg.role) {
        turns[turns.length - 1] = { role: msg.role, text: msg.text };
      } else {
        turns.push({ role: msg.role, text: msg.text });
      }
      // keep the rolling window small
      return { ...state, turns: turns.slice(-8) };
    }
    default:
      return state;
  }
}
